/**
 * runner-shells-issue.test.ts
 *
 * Testes do `scripts/runner-shells-issue.mjs` — o publicador que transforma o
 * DRIFT dos shells da imagem do runner numa ISSUE acionável (e a fecha quando a
 * medição volta a bater com o que o gate declara).
 *
 * O que precisa ser provado (um publicador pode abrir ticket do nada, ou pior:
 * fechar a dívida que ainda vive):
 *   1. a ASSINATURA é o conjunto ordenado dos avisos — estável na ordem, e
 *      diferente quando a divergência é outra (o dedup não vira ruído semanal
 *      nem esconde uma divergência nova);
 *   2. `actionable` é a DIVERGÊNCIA MEDIDA: `in-sync` e `unavailable` não abrem
 *      ticket (o alerta que sempre acende é ruído);
 *   3. a GUARDA DO FECHAMENTO recusa `unavailable`: "não medido" não é evidência
 *      de "resolvido", e fechar por ele apagaria a dívida sem medição;
 *   4. o CICLO contra um `gh` dublê: cria com o label e o marcador, comenta no
 *      título já aberto (dedup) e, em sincronia, COMENTA A PROVA ANTES DE
 *      FECHAR — e não toca em issue alheia;
 *   5. o corpo diz o DELTA (cada divergência com a direção do erro), a TABELA do
 *      declarado × medido, a PROVENIÊNCIA (digest e o comando re-executável) e o
 *      REMÉDIO (o arquivo único onde a declaração vive).
 *
 * Sem rede e sem docker: o relatório vem do comparador compartilhado com uma
 * medição sintética, e o backend é o `makeGithubBackend` do contrato com um `gh`
 * dublê. O caminho real de medição (docker + registry) é o do
 * `runner-shells.test.ts` e do job semanal.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { makeGithubBackend } from "../../../scripts/issue-publish.mjs"
import {
  RUNNER_IMAGE,
  RUNNER_SHELLS,
  RUNNER_SHELLS_MISSING,
  shellsDriftReport,
} from "../../../scripts/runner-shells.mjs"
import {
  ISSUE_LABEL,
  RUNNER_SHELLS_MARKER_ID,
  RUNNER_SHELLS_PUBLISHER,
  driftBody,
  driftTitle,
  isActionable,
  loadReport,
  resolutionComment,
  signatureOf,
} from "../../../scripts/runner-shells-issue.mjs"

const DECLARED = RUNNER_SHELLS as Record<string, string>
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rsi-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

/** Uma medição sintética do que a imagem do runner respondeu. */
function medicao(present: Record<string, string>, missing: string[], unparsed: string[] = []) {
  return {
    state: "measured" as const,
    image: "ghcr.io/org/ubuntu-bun:tag",
    digest: RUNNER_IMAGE.digest,
    present,
    missing,
    unparsed,
  }
}

const semPresente = (nome: string) =>
  Object.fromEntries(Object.entries(DECLARED).filter(([n]) => n !== nome))

/** O drift do caso mais perigoso: um shell declarado PRESENTE sumiu da imagem. */
const comRemocao = () =>
  shellsDriftReport({
    measurement: medicao(semPresente("python3"), [...RUNNER_SHELLS_MISSING, "python3"]),
  })

/** A medição em sincronia com a declaração (o desfecho que FECHA a dívida). */
const emSincronia = () =>
  shellsDriftReport({ measurement: medicao({ ...DECLARED }, [...RUNNER_SHELLS_MISSING]) })

/** A medição que não aconteceu (sem docker / imagem não puxável / sem ref). */
const naoMedido = () =>
  shellsDriftReport({
    measurement: {
      state: "unavailable",
      image: null,
      detail: "sem ref da imagem: defina BUN_VERSION",
    },
  })

// ── assinatura e actionable ──────────────────────────────────────────────

describe("a assinatura do drift", () => {
  it("é o conjunto ORDENADO dos avisos — a mesma divergência dá a mesma assinatura", () => {
    const a = signatureOf(comRemocao())
    const b = signatureOf({ warnings: [...comRemocao().warnings].reverse() })
    expect(a).toBe(b)
    expect(a).toContain("python3")
  })

  it("uma divergência DIFERENTE dá outra assinatura (comentar é o certo)", () => {
    const outra = shellsDriftReport({
      measurement: medicao(semPresente("perl"), [...RUNNER_SHELLS_MISSING, "perl"]),
    })
    expect(signatureOf(outra)).not.toBe(signatureOf(comRemocao()))
  })
})

describe("actionable — só a divergência MEDIDA abre ticket", () => {
  it("drift é acionável; em sincronia e não-medido não são", () => {
    expect(isActionable(comRemocao())).toBe(true)
    expect(isActionable(emSincronia())).toBe(false)
    expect(isActionable(naoMedido())).toBe(false)
  })
})

describe("a guarda do fechamento — 'não medido' não é evidência de resolvido", () => {
  it("só um `measured` SEM aviso fecha a dívida", () => {
    expect(RUNNER_SHELLS_PUBLISHER.resolution.when(emSincronia())).toBe(true)
    expect(RUNNER_SHELLS_PUBLISHER.resolution.when(comRemocao())).toBe(false)
    // O caso que apagaria a dívida sem medição nenhuma.
    expect(RUNNER_SHELLS_PUBLISHER.resolution.when(naoMedido())).toBe(false)
  })

  it("o motivo do fechamento é dito (o log não fica mudo)", () => {
    expect(RUNNER_SHELLS_PUBLISHER.resolution.reason).toContain("medição voltou a bater")
  })
})

// ── a prosa ──────────────────────────────────────────────────────────────

describe("o corpo da issue — o delta, a tabela, a proveniência e o remédio", () => {
  it("carrega o marcador do contrato (sem ele o fechamento automático não reconhece a dívida)", () => {
    const corpo = driftBody(comRemocao())
    expect(corpo).toContain(RUNNER_SHELLS_MARKER_ID)
    expect(corpo).toContain(`<!--`)
  })

  it("diz a DIREÇÃO do erro: declarado presente + medido ausente = o gate PASSARIA", () => {
    const corpo = driftBody(comRemocao())
    expect(corpo).toContain("PASSARIA")
    expect(corpo).toContain("command not found")
    expect(corpo).toContain("`python3`")
  })

  it("traz a tabela declarado × medido (a prova item por item)", () => {
    const corpo = driftBody(comRemocao())
    expect(corpo).toContain("| shell | declarado | medido agora | desfecho |")
    expect(corpo).toContain("| `python3` |")
    expect(corpo).toContain("**DIVERGE**")
    // E as linhas que NÃO divergiram também: o ticket é o conjunto, não só o delta.
    expect(corpo).toContain("| `bash` |")
  })

  it("traz a proveniência: a imagem, o digest, a data e o comando re-executável", () => {
    const corpo = driftBody(comRemocao())
    expect(corpo).toContain("ghcr.io/org/ubuntu-bun:tag")
    expect(corpo).toContain(RUNNER_IMAGE.digest)
    expect(corpo).toContain(RUNNER_IMAGE.measuredAt)
    expect(corpo).toContain("docker run --rm --entrypoint /bin/sh ghcr.io/org/ubuntu-bun:tag -c '")
  })

  it("o remédio aponta o arquivo ÚNICO da declaração e a re-medição", () => {
    const corpo = driftBody(comRemocao())
    expect(corpo).toContain("scripts/runner-shells.mjs")
    expect(corpo).toContain("node scripts/runner-shells.mjs --json")
    expect(corpo).toContain("RUNNER_IMAGE.digest")
  })

  it("o título é ESTÁVEL (não carrega a imagem nem o nome que divergiu)", () => {
    const titulo = driftTitle()
    expect(titulo).toContain("RUNNER_SHELLS")
    expect(titulo).not.toContain("python3")
    expect(titulo).not.toContain(RUNNER_IMAGE.digest)
  })

  it("o comentário do fechamento carrega a prova e o ESCOPO (vale para a ref medida)", () => {
    const comentario = resolutionComment(emSincronia())
    expect(comentario).toContain("Resolvido")
    expect(comentario).toContain("| shell | declarado | medido agora | desfecho |")
    expect(comentario).toContain(RUNNER_IMAGE.digest)
    expect(comentario).toContain("Escopo deste fechamento")
    expect(comentario).toContain("Fechada automaticamente")
  })
})

// ── o relatório ──────────────────────────────────────────────────────────

describe("loadReport — um relatório truncado não pode passar por medição", () => {
  it("arquivo inexistente e JSON sem `state` são erro de uso", () => {
    const dir = makeTmpDir()
    expect(() => loadReport({ report: join(dir, "nao-existe.json") })).toThrow(/não encontrado/)
    const torto = join(dir, "torto.json")
    writeFileSync(torto, JSON.stringify({ verdict: "in-sync", warnings: [] }))
    expect(() => loadReport({ report: torto })).toThrow(/state/)
  })

  it("lê o relatório gravado pelo medidor (o caminho do job)", () => {
    const dir = makeTmpDir()
    const p = join(dir, "runner-shells.json")
    writeFileSync(p, JSON.stringify(comRemocao()))
    const r = loadReport({ report: p })
    expect(r.state).toBe("measured")
    expect(signatureOf(r)).toBe(signatureOf(comRemocao()))
  })

  it("sem --report, MEDE com a régua compartilhada (e não mede sem ref)", () => {
    const r = loadReport({ report: null, image: null }, { env: {} as NodeJS.ProcessEnv })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("BUN_VERSION")
  })
})

// ── o ciclo contra um `gh` dublê ─────────────────────────────────────────

describe("runDebtPublisher — publicar, deduplicar e fechar", () => {
  function fakeGh(open: { number: number; title?: string; body?: string }[] = []) {
    const calls: string[][] = []
    const fn = (args: string[]) => {
      calls.push(args)
      if (args[0] === "issue" && args[1] === "list") {
        return { status: 0, stdout: JSON.stringify(open), stderr: "" }
      }
      return { status: 0, stdout: "", stderr: "" }
    }
    return { fn, calls }
  }

  const backend = (gh: { fn: (a: string[]) => unknown }) =>
    makeGithubBackend({
      gh: gh.fn as never,
      label: ISSUE_LABEL,
      color: RUNNER_SHELLS_PUBLISHER.labelColor,
      description: RUNNER_SHELLS_PUBLISHER.labelDescription,
    })

  const silencioso = () => {}

  it("abre a issue com o label, o título estável e o marcador no corpo", async () => {
    const gh = fakeGh()
    const { runDebtPublisher } = await import("../../../scripts/issue-publish.mjs")
    await runDebtPublisher({
      publisher: RUNNER_SHELLS_PUBLISHER,
      input: comRemocao(),
      backend: backend(gh),
      log: silencioso,
    })
    const create = gh.calls.find((c) => c[0] === "issue" && c[1] === "create")
    expect(create).toBeTruthy()
    const texto = create!.join(" ")
    expect(texto).toContain(ISSUE_LABEL)
    expect(texto).toContain(RUNNER_SHELLS_MARKER_ID)
    expect(texto).toContain("RUNNER_SHELLS")
  })

  it("a MESMA divergência não abre segunda issue (dedup pela assinatura)", async () => {
    const { runDebtPublisher, publisherBody } = await import("../../../scripts/issue-publish.mjs")
    const input = comRemocao()
    const gh = fakeGh([
      { number: 41, title: driftTitle(), body: publisherBody(RUNNER_SHELLS_PUBLISHER, input) },
    ])
    await runDebtPublisher({
      publisher: RUNNER_SHELLS_PUBLISHER,
      input,
      backend: backend(gh),
      log: silencioso,
    })
    expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "create")).toBe(false)
    expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment")).toBe(false)
  })

  it("em sincronia: COMENTA A PROVA ANTES DE FECHAR a issue que nós abrimos", async () => {
    const { runDebtPublisher, publisherBody } = await import("../../../scripts/issue-publish.mjs")
    const gh = fakeGh([
      {
        number: 42,
        title: driftTitle(),
        body: publisherBody(RUNNER_SHELLS_PUBLISHER, comRemocao()),
      },
    ])
    const res = await runDebtPublisher({
      publisher: RUNNER_SHELLS_PUBLISHER,
      input: emSincronia(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.closed).toEqual([42])
    const comentario = gh.calls.findIndex((c) => c[1] === "comment")
    const fechamento = gh.calls.findIndex((c) => c[1] === "close")
    expect(comentario).toBeGreaterThan(-1)
    expect(fechamento).toBeGreaterThan(comentario)
  })

  it("NÃO MEDIDO: não publica, não fecha e não toca em issue nenhuma", async () => {
    const { runDebtPublisher, publisherBody } = await import("../../../scripts/issue-publish.mjs")
    const gh = fakeGh([
      {
        number: 43,
        title: driftTitle(),
        body: publisherBody(RUNNER_SHELLS_PUBLISHER, comRemocao()),
      },
    ])
    const res = await runDebtPublisher({
      publisher: RUNNER_SHELLS_PUBLISHER,
      input: naoMedido(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.status).toBe("unmeasured")
    expect(gh.calls.some((c) => c[1] === "close")).toBe(false)
    expect(gh.calls.some((c) => c[1] === "comment")).toBe(false)
    expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "create")).toBe(false)
  })

  it("NÃO toca em issue alheia (label aplicado à mão, sem o marcador)", async () => {
    const { runDebtPublisher } = await import("../../../scripts/issue-publish.mjs")
    const gh = fakeGh([{ number: 44, title: "outra coisa", body: "sem marcador" }])
    const res = await runDebtPublisher({
      publisher: RUNNER_SHELLS_PUBLISHER,
      input: emSincronia(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.closed).toEqual([])
    expect(gh.calls.some((c) => c[1] === "close")).toBe(false)
  })
})
