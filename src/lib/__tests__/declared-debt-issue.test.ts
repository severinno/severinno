/**
 * declared-debt-issue.test.ts
 *
 * Testes do scripts/declared-debt-issue.mjs — o publicador da dívida DECLARADA
 * que VENCEU a janela de revisão (as isenções com `addedAt` e o baseline do
 * SIGPIPE), transformando o run vermelho do cron em ISSUE acionável.
 *
 * O que precisa ser provado (um publicador pode abrir a issue errada, ou pior:
 * fechar a dívida que ainda vive):
 *   1. a ASSINATURA identifica o vencimento do momento e é estável na ordem (o
 *      dedup não pode virar ruído semanal, nem esconder uma lista que venceu
 *      depois);
 *   2. `actionable` é o VENCIMENTO — lista vazia, lista ilegível e "nada
 *      declarado" não abrem ticket (o alerta que sempre acende é ruído);
 *   3. a GUARDA DO FECHAMENTO (`shouldReconcile`) recusa uma medição
 *      INCOMPLETA: "não medido" não é evidência de "reafirmado";
 *   4. o CICLO contra um `gh` dublê: cria com o label e o marcador, comenta no
 *      título já aberto (dedup) e, quando nada está vencido, COMENTA A PROVA
 *      ANTES DE FECHAR — e não toca em issue alheia;
 *   5. o corpo diz QUAL lista, QUAL entrada, há quanto tempo, a JANELA e o
 *      REMÉDIO do dono da lista.
 *
 * Sem rede: o backend do GitHub é o `makeGithubBackend` do contrato, com um `gh`
 * dublê — o caminho real (CLI + API) é o do `issue-publish.mjs`, exercitado pelas
 * suítes dele e dos outros publicadores.
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { makeGithubBackend } from "../../../scripts/issue-publish.mjs"
import {
  DECLARED_DEBT_MARKER_ID,
  DECLARED_DEBT_PUBLISHER,
  ISSUE_LABEL,
  inSyncProse,
  isActionable,
  parseArgs,
  readReportFile,
  resolutionComment,
  reviewProse,
  reviewTitle,
  shouldReconcile,
  signatureOf,
} from "../../../scripts/declared-debt-issue.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/declared-debt-issue.mjs")
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ddi-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Uma fonte vencida sintética (a forma que o `declared-debt.mjs` publica). */
function fonteVencida(over: object = {}): object {
  const aged = [
    { id: "scripts/x.mjs", addedAt: "2026-01-01", days: 257, limit: 180 },
    { id: "scripts/y.mjs", addedAt: "2026-02-01", days: 226, limit: 180 },
  ]
  return {
    id: "out-of-scope",
    listName: "OUT_OF_SCOPE_ALLOWLIST",
    owner: "scripts/check-registry-source.mjs",
    kind: "entries",
    remedy: "reafirme a exceção atualizando `addedAt`, ou tire o arquivo do escopo",
    reviewDays: 180,
    state: "aged",
    total: 2,
    oldest: aged[0],
    aged,
    invalid: [],
    detail: "2 decisões",
    ...over,
  }
}

/** O fato DO VENCIMENTO (aged) — o caso que abre a issue. */
function fatoVencido(): object {
  const fonte = fonteVencida()
  return {
    state: "aged",
    sources: [fonte],
    aged: (fonte as { aged: object[] }).aged.map((e) => ({ ...e, source: fonte })),
    invalid: [],
    unread: [],
    total: 2,
  }
}

/** O fato MEDIDO E LIMPO — o caso que fecha a dívida. */
function fatoLimpo(): object {
  const fonte = fonteVencida({
    state: "proven",
    aged: [],
    oldest: { id: "scripts/x.mjs", addedAt: "2026-09-01", days: 14 },
  })
  return { state: "proven", sources: [fonte], aged: [], invalid: [], unread: [], total: 2 }
}

/** O fato com uma lista ILEGÍVEL — a recusa fail-closed. */
function fatoIlegivel(): object {
  const fonte = fonteVencida({
    id: "sigpipe",
    listName: "docs/quality/pipefail-sigpipe-baseline.json",
    state: "unread",
    aged: [],
    detail: "JSON inválido",
  })
  return {
    state: "unread",
    sources: [fonte],
    aged: [],
    invalid: [],
    unread: [fonte],
    total: 0,
  }
}

// ── a assinatura e a decisão de publicar ──────────────────────────────────

describe("signatureOf — o vencimento do momento, estável na ordem", () => {
  it("muda quando uma lista vence DEPOIS (estado novo, não o mesmo ticket)", () => {
    const completo = fatoVencido()
    const parcial = {
      ...completo,
      aged: (completo as { aged: object[] }).aged.slice(0, 1),
    }
    expect(signatureOf(completo)).not.toBe(signatureOf(parcial))
  })

  it("não depende da ORDEM das entradas (duas runs iguais não duplicam)", () => {
    const completo = fatoVencido() as { aged: object[] }
    const invertido = { ...completo, aged: [...completo.aged].reverse() }
    expect(signatureOf(invertido)).toBe(signatureOf(completo))
  })

  it("nomeia a lista e a data da decisão (a assinatura é auditável)", () => {
    expect(signatureOf(fatoVencido())).toContain("out-of-scope:scripts/x.mjs:2026-01-01")
  })
})

describe("isActionable — só o VENCIMENTO abre ticket", () => {
  it("vencido é actionable; medido e limpo não é", () => {
    expect(isActionable(fatoVencido())).toBe(true)
    expect(isActionable(fatoLimpo())).toBe(false)
  })

  it("lista ILEGÍVEL não é actionable (o alerta que sempre acende é ruído)", () => {
    expect(isActionable(fatoIlegivel())).toBe(false)
  })
})

describe("shouldReconcile — 'não medido' não é evidência de 'reafirmado'", () => {
  it("medido e limpo: fecha", () => {
    expect(shouldReconcile(fatoLimpo())).toBe(true)
  })

  it("com lista ilegível: NÃO fecha", () => {
    expect(shouldReconcile(fatoIlegivel())).toBe(false)
  })
})

// ── o corpo e a prova ────────────────────────────────────────────────────

describe("reviewProse — o corpo diz o que fazer, com o remédio DO DONO da lista", () => {
  it("nomeia a lista, o dono, a entrada mais antiga, a idade e a janela", () => {
    const corpo = reviewProse(fatoVencido() as never)
    expect(corpo).toContain("OUT_OF_SCOPE_ALLOWLIST")
    expect(corpo).toContain("scripts/check-registry-source.mjs")
    expect(corpo).toContain("janela de 180 dia(s)")
    expect(corpo).toContain("`scripts/x.mjs`")
    expect(corpo).toContain("257 dia(s)")
    expect(corpo).toContain("reafirme a exceção atualizando `addedAt`")
  })

  it("traz a reprodução da MESMA medição (o fato, o veredito e a janela compartilhada)", () => {
    const corpo = reviewProse(fatoVencido() as never)
    expect(corpo).toContain("node scripts/declared-debt.mjs")
    expect(corpo).toContain("bun run doctor")
    expect(corpo).toContain("allowlist-review.mjs")
  })
})

describe("resolutionComment — a prova do fechamento", () => {
  it("tabela por lista com a decisão mais antiga e a janela (não só 'resolvido')", () => {
    const comentario = resolutionComment(fatoLimpo() as never)
    expect(comentario).toContain("Resolvido")
    expect(comentario).toContain("OUT_OF_SCOPE_ALLOWLIST")
    expect(comentario).toContain("2026-09-01")
    expect(comentario).toContain("janela de 180 dia(s)")
    expect(comentario).toContain("node scripts/declared-debt.mjs")
  })

  it("a prosa do 'nada vencido' diz o TOTAL medido (verde com número, não com fé)", () => {
    expect(inSyncProse(fatoLimpo() as never)).toContain("2 decisão(ões)")
  })
})

// ── o ciclo contra um `gh` dublê ─────────────────────────────────────────

describe("runDebtPublisher — criar, deduplicar e fechar", () => {
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
      color: DECLARED_DEBT_PUBLISHER.labelColor,
      description: DECLARED_DEBT_PUBLISHER.labelDescription,
    })

  const silencioso = () => {}

  it("abre a issue com o label, o título estável e o marcador no corpo", async () => {
    const gh = fakeGh()
    const { runDebtPublisher } = await import("../../../scripts/issue-publish.mjs")
    await runDebtPublisher({
      publisher: DECLARED_DEBT_PUBLISHER,
      input: fatoVencido(),
      backend: backend(gh),
      log: silencioso,
    })
    // `gh label create` também tem 'create' na segunda posição: o alvo é a ISSUE.
    const create = gh.calls.find((c) => c[0] === "issue" && c[1] === "create")
    expect(create).toBeTruthy()
    const texto = create!.join(" ")
    expect(texto).toContain(ISSUE_LABEL)
    expect(texto).toContain("Dívida declarada sem revisão")
    expect(texto).toContain(DECLARED_DEBT_MARKER_ID)
  })

  it("o MESMO vencimento não abre segunda issue (dedup pela assinatura)", async () => {
    const gh = fakeGh()
    const { runDebtPublisher, publisherBody } = await import("../../../scripts/issue-publish.mjs")
    const input = fatoVencido()
    const corpo = publisherBody(DECLARED_DEBT_PUBLISHER, input)
    gh.calls.length = 0
    // A issue já ABERTA carrega a assinatura do momento: a run seguinte comenta
    // nela em vez de abrir outra.
    const aberta = [{ number: 11, title: reviewTitle(), body: corpo }]
    const gh2 = fakeGh(aberta)
    await runDebtPublisher({
      publisher: DECLARED_DEBT_PUBLISHER,
      input,
      backend: backend(gh2),
      log: silencioso,
    })
    expect(gh2.calls.some((c) => c[0] === "issue" && c[1] === "create")).toBe(false)
    expect(gh2.calls.some((c) => c[0] === "issue" && c[1] === "comment")).toBe(false)
  })

  it("nada vencido: COMENTA A PROVA ANTES DE FECHAR a issue que nós abrimos", async () => {
    const { runDebtPublisher, publisherBody } = await import("../../../scripts/issue-publish.mjs")
    const aberta = [
      {
        number: 12,
        title: reviewTitle(),
        body: publisherBody(DECLARED_DEBT_PUBLISHER, fatoVencido()),
      },
    ]
    const gh = fakeGh(aberta)
    const res = await runDebtPublisher({
      publisher: DECLARED_DEBT_PUBLISHER,
      input: fatoLimpo(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.closed).toEqual([12])
    const comentario = gh.calls.findIndex((c) => c[1] === "comment")
    const fechamento = gh.calls.findIndex((c) => c[1] === "close")
    expect(comentario).toBeGreaterThan(-1)
    expect(fechamento).toBeGreaterThan(comentario)
  })

  it("NÃO toca em issue alheia (label aplicado à mão, sem o marcador)", async () => {
    const { runDebtPublisher } = await import("../../../scripts/issue-publish.mjs")
    const gh = fakeGh([{ number: 13, title: "outra coisa", body: "sem marcador" }])
    const res = await runDebtPublisher({
      publisher: DECLARED_DEBT_PUBLISHER,
      input: fatoLimpo(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.closed).toEqual([])
    expect(gh.calls.some((c) => c[1] === "close")).toBe(false)
  })
})

// ── a CLI ────────────────────────────────────────────────────────────────

describe("readReportFile — um relatório inválido não vira 'nada vencido'", () => {
  it("arquivo ausente", () => {
    expect(() => readReportFile("/nao/existe.json")).toThrow(/não encontrado/)
  })

  it("sem `state`", () => {
    const dir = makeTmpDir()
    const path = join(dir, "r.json")
    writeFileSync(path, JSON.stringify({ aged: [], invalid: [], sources: [] }))
    expect(() => readReportFile(path)).toThrow(/state/)
  })

  it("`aged` que não é array", () => {
    const dir = makeTmpDir()
    const path = join(dir, "r.json")
    writeFileSync(path, JSON.stringify({ state: "proven", aged: null, invalid: [], sources: [] }))
    expect(() => readReportFile(path)).toThrow(/arrays/)
  })

  it("relatório válido passa", () => {
    const dir = makeTmpDir()
    const path = join(dir, "r.json")
    writeFileSync(path, JSON.stringify(fatoVencido()))
    expect(readReportFile(path).state).toBe("aged")
  })
})

describe("parseArgs — o uso é fail-closed", () => {
  it("recusa argumento desconhecido", () => {
    expect(() => parseArgs(["--nao-existe"])).toThrow(/desconhecido/)
  })

  it("recusa backend fora de github|gitea", () => {
    expect(() => parseArgs(["--backend", "gitlab"])).toThrow(/github\|gitea/)
  })

  it("lê as opções do caminho do cron", () => {
    expect(parseArgs(["--report", "x.json", "--backend", "gitea", "--dry-run"])).toMatchObject({
      report: "x.json",
      backend: "gitea",
      dryRun: true,
    })
  })
})

describe("a CLI end-to-end (sem rede)", () => {
  it("nada vencido no checkout: exit 0 e a prosa do ciclo", () => {
    const r = spawnSync("node", [SCRIPT, "--dry-run", "--no-reconcile"], { encoding: "utf8" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Nenhuma decisão declarada fora da janela")
  })

  it("com isenção VENCIDA (--report): dry-run imprime a issue, sem chamar backend", () => {
    const dir = makeTmpDir()
    const path = join(dir, "vencido.json")
    writeFileSync(path, JSON.stringify(fatoVencido()))
    const r = spawnSync("node", [SCRIPT, "--report", path, "--dry-run"], { encoding: "utf8" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("VENCIDA")
    expect(r.stdout).toContain("OUT_OF_SCOPE_ALLOWLIST")
    expect(r.stdout).toContain("dry-run")
  })

  it("lista ILEGÍVEL: recusa (exit 1) — não medido não é reafirmado", () => {
    const dir = makeTmpDir()
    const path = join(dir, "ilegivel.json")
    writeFileSync(path, JSON.stringify(fatoIlegivel()))
    const r = spawnSync("node", [SCRIPT, "--report", path, "--dry-run"], { encoding: "utf8" })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("não pôde ser MEDIDA")
    expect(r.stderr).toContain("NADA foi publicado nem fechado")
  })
})
