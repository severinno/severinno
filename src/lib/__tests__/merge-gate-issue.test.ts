/**
 * merge-gate-issue.test.ts
 *
 * Testes do `scripts/merge-gate-issue.mjs` — o publicador que transforma o
 * veredito do `merge-gate:prove` numa ISSUE acionável (e a fecha quando o
 * registro da proteção volta a bater com o manifesto).
 *
 * O que precisa ser provado (um publicador pode abrir ticket do nada, ou pior:
 * fechar a dívida que ainda vive):
 *   1. o TÍTULO e a ASSINATURA são por NATUREZA — o registro divergente e a
 *      matriz que não morde são dívidas com remédios diferentes, e não podem
 *      colidir no dedup (uma falha de matriz que chegasse com a dívida de
 *      registro aberta viraria comentário nela, e o leitor concluiria que o
 *      defeito é o outro);
 *   2. a assinatura é estável na ORDEM do delta, e diferente quando o delta é
 *      outro (o cron não vira ruído semanal nem esconde uma divergência nova);
 *   3. `actionable` é a VIOLAÇÃO: `proven` e `unavailable` não abrem ticket;
 *   4. a GUARDA DO FECHAMENTO exige um `proven` EXPLÍCITO — `unavailable` NÃO
 *      fecha: \"não medido\" não é evidência de \"resolvido\";
 *   5. o CICLO contra um `gh` dublê: cria com o label e o marcador, deduplica
 *      pela assinatura, COMENTA A PROVA ANTES DE FECHAR, e não toca em issue
 *      alheia;
 *   6. o CORPO diz o CONTEXTO (os contextos exigidos), o DELTA na direção do
 *      erro (faltam = o gate passaria; sobram = o PR travaria para sempre;
 *      contagem = o nome muda quando a matriz cresce), a MATRIZ com o desfecho
 *      de cada caso e os LIMITES da prova — que vêm do MESMO relatório que a CLI
 *      produz (`gateResult`), e não de uma segunda lista aqui.
 *
 * Sem docker e sem rede: o relatório é montado com as funções PURAS da própria
 * prova (`gateResult`/`registrationDelta`/`casesPlan`) e o backend é o
 * `makeGithubBackend` do contrato com um `gh` dublê. O caminho real (Gitea
 * efêmero + matriz contra a API) é o do `prove-gitea-merge-gate.test.ts` e o do
 * cron semanal.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  makeGithubBackend,
  publisherBody,
  runDebtPublisher,
} from "../../../scripts/issue-publish.mjs"
import {
  PROOF_LIMITS,
  casesPlan,
  gateResult,
  registrationDelta,
} from "../../../scripts/prove-gitea-merge-gate.mjs"
import {
  ISSUE_LABEL,
  MATRIZ_TITLE,
  MERGE_GATE_MARKER_ID,
  MERGE_GATE_PUBLISHER,
  NATURE,
  REGISTRO_TITLE,
  deltaOf,
  isActionable,
  loadReport,
  mergeGateSignature,
  natureOf,
  readReportFile,
  registrationDiverges,
  resolutionComment,
  shouldReconcile,
} from "../../../scripts/merge-gate-issue.mjs"

/** Os contextos que o manifesto exige (a lista REAL do ensaio, reduzida). */
const CONTEXTOS = ["Lint", "Repo Guards", "Tests", "TypeCheck"]

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mgi-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

/** A matriz com os desfechos certos (cada caso com o que ele espera). */
function matrizCerta() {
  return casesPlan(CONTEXTOS).map((testCase: any) => ({
    ...testCase,
    outcome: {
      state: testCase.expect,
      http: testCase.expect === "merged" ? 201 : 405,
      reason: testCase.expect === "merged" ? null : "the PR is not mergeable",
      detail: "",
    },
  }))
}

/** A matriz que MERGEOU onde devia recusar (a exigência não morde). */
function matrizFrouxa() {
  return matrizCerta().map((testCase: any) =>
    testCase.expect === "blocked"
      ? {
          ...testCase,
          outcome: {
            state: "merged",
            http: 201,
            reason: null,
            detail: "mergeou com o gate vermelho",
          },
        }
      : testCase,
  )
}

const applierOk = () => ({ applied: true, checkInSync: true, checkSeesDisabled: true })

/** O veredito PROVADO: registro batendo e matriz verde. */
const provado = () =>
  gateResult({
    verdict: "proven",
    detail: "a matriz de merge bate com o contrato",
    contexts: CONTEXTOS,
    cases: matrizCerta(),
    enforcement: { enabled: true, contexts: CONTEXTOS },
    registration: registrationDelta({ expected: CONTEXTOS, registered: CONTEXTOS }),
    applier: applierOk(),
  })

/**
 * O caso mais perigoso do REGISTRO: o applier registra menos do que o manifesto
 * exige — o job roda e o merge passa com ele vermelho.
 */
const registroFaltando = () =>
  gateResult({
    verdict: "violated",
    detail: "a protecao registrada nao bate com o manifesto",
    contexts: CONTEXTOS,
    cases: matrizCerta(),
    enforcement: { enabled: true, contexts: CONTEXTOS.slice(0, 2) },
    registration: registrationDelta({
      expected: CONTEXTOS,
      registered: CONTEXTOS.slice(0, 2),
    }),
    applier: applierOk(),
  })

/**
 * O outro lado: sobra contexto na proteção — o PR trava para sempre esperando
 * um check que nunca roda.
 */
const registroSobrando = () =>
  gateResult({
    verdict: "violated",
    detail: "a protecao exige check que o manifesto nao declara",
    contexts: CONTEXTOS,
    cases: matrizCerta(),
    enforcement: { enabled: true, contexts: [...CONTEXTOS, "Lint (antigo)"] },
    registration: registrationDelta({
      expected: CONTEXTOS,
      registered: [...CONTEXTOS, "Lint (antigo)"],
    }),
    applier: applierOk(),
  })

/** Contagem no nome de um contexto: o nome muda quando a matriz cresce. */
const registroComContagem = () =>
  gateResult({
    verdict: "violated",
    detail: "um contexto carrega contagem",
    contexts: CONTEXTOS,
    cases: matrizCerta(),
    enforcement: {
      enabled: true,
      contexts: [...CONTEXTOS.slice(0, 3), "Mutation guards (27 tests)"],
    },
    registration: registrationDelta({
      expected: CONTEXTOS,
      registered: [...CONTEXTOS.slice(0, 3), "Mutation guards (27 tests)"],
    }),
    applier: applierOk(),
  })

/** A dívida da MATRIZ (o registro bate; o que não morde é o bloqueio). */
const matrizQuebrada = () =>
  gateResult({
    verdict: "violated",
    detail: "a matriz de merge nao bate com o contrato",
    contexts: CONTEXTOS,
    cases: matrizFrouxa(),
    enforcement: { enabled: true, contexts: CONTEXTOS },
    registration: registrationDelta({ expected: CONTEXTOS, registered: CONTEXTOS }),
    applier: applierOk(),
  })

/** A medição que NÃO aconteceu (sem docker, imagem não puxável, API fora). */
const naoMedido = () =>
  gateResult({
    verdict: "unavailable",
    detail: "o container nao subiu",
    blockers: ["docker: command not found"],
  })

// ── a natureza: duas dívidas, dois remédios ──────────────────────────────

describe("a NATUREZA da falha — registro e matriz não podem colidir no dedup", () => {
  it("o registro divergente é `registro`; o resto é `matriz`", () => {
    expect(natureOf(registroFaltando())).toBe(NATURE.REGISTRO)
    expect(natureOf(registroSobrando())).toBe(NATURE.REGISTRO)
    expect(natureOf(matrizQuebrada())).toBe(NATURE.MATRIZ)
    // Sem registro lido não há como acusar o applier: o que sobrou é a matriz.
    expect(natureOf(gateResult({ verdict: "violated", cases: matrizFrouxa() }))).toBe(NATURE.MATRIZ)
  })

  it("só um `ok: false` do registro conta como divergência", () => {
    expect(registrationDiverges(registroFaltando())).toBe(true)
    expect(registrationDiverges(provado())).toBe(false)
    // `registration: null` (relatório antigo) NÃO é divergência — é ausência.
    expect(registrationDiverges(naoMedido())).toBe(false)
  })

  it("o TÍTULO é estável por natureza, e não carrega o delta do momento", () => {
    const tituloRegistro = MERGE_GATE_PUBLISHER.title(registroFaltando())
    expect(tituloRegistro).toBe(REGISTRO_TITLE)
    expect(MERGE_GATE_PUBLISHER.title(matrizQuebrada())).toBe(MATRIZ_TITLE)
    expect(tituloRegistro).not.toContain("Tests")
    expect(tituloRegistro).not.toContain("faltam")
  })
})

// ── assinatura e actionable ──────────────────────────────────────────────

describe("a assinatura do veredito", () => {
  it("é estável na ORDEM do delta — a mesma divergência dá a mesma assinatura", () => {
    const a = mergeGateSignature(registroFaltando())
    const invertido = deltaOf(registroFaltando())
    const b = mergeGateSignature({
      ...registroFaltando(),
      registration: {
        ok: false,
        missing: [...invertido.missing].reverse(),
        extra: [],
        withCount: [],
      },
    })
    expect(a).toBe(b)
    // O delta é por CONTEXTO FALTANTE (o manifesto exige, o registro não tem).
    expect(a).toContain(`faltam:${CONTEXTOS[2]}`)
  })

  it("um delta DIFERENTE dá outra assinatura (comentar é o certo)", () => {
    expect(mergeGateSignature(registroSobrando())).not.toBe(mergeGateSignature(registroFaltando()))
  })

  it("assinaturas de naturezas diferentes NÃO colidem (o prefixo é o que as separa)", () => {
    const registro = mergeGateSignature(registroFaltando())
    const matriz = mergeGateSignature(matrizQuebrada())
    expect(registro.startsWith(`veredito:violated\nnatureza:${NATURE.REGISTRO}`)).toBe(true)
    expect(matriz.startsWith(`veredito:violated\nnatureza:${NATURE.MATRIZ}`)).toBe(true)
  })

  it("a assinatura da matriz é feita dos CASOS que saíram fora do esperado", () => {
    const assinatura = mergeGateSignature(matrizQuebrada())
    expect(assinatura).toContain("caso:gate-vermelho=merged")
    // E o caso que fez o que devia não entra: a assinatura é o DEFEITO.
    expect(assinatura).not.toContain("caso:controle-verde")
  })

  it("uma contagem no contexto entra na assinatura com o TRECHO acusado", () => {
    // O campo `count` é o trecho que a régua compartilhada (`countInContext`)
    // acusou — não o número solto: é ele que diz ONDE a contagem está no nome.
    expect(mergeGateSignature(registroComContagem())).toContain(
      "contagem:Mutation guards (27 tests)=(27 tests)",
    )
  })
})

describe("actionable — só a VIOLAÇÃO abre ticket", () => {
  it("violado é acionável; provado e não-medido não são", () => {
    expect(isActionable(registroFaltando())).toBe(true)
    expect(isActionable(matrizQuebrada())).toBe(true)
    expect(isActionable(provado())).toBe(false)
    expect(isActionable(naoMedido())).toBe(false)
  })
})

// ── a guarda do fechamento ───────────────────────────────────────────────

describe("a guarda do fechamento — 'não medido' não é evidência de resolvido", () => {
  it("só um `proven` EXPLÍCITO fecha a dívida", () => {
    expect(MERGE_GATE_PUBLISHER.resolution.when(provado())).toBe(true)
    expect(MERGE_GATE_PUBLISHER.resolution.when(registroFaltando())).toBe(false)
    // O caso que apagaria a dívida com base numa medição que não aconteceu.
    expect(MERGE_GATE_PUBLISHER.resolution.when(naoMedido())).toBe(false)
    expect(shouldReconcile(naoMedido())).toBe(false)
  })

  it("o motivo do fechamento é dito (o log não fica mudo)", () => {
    expect(MERGE_GATE_PUBLISHER.resolution.reason).toContain("PROVADO")
  })
})

// ── a prosa ──────────────────────────────────────────────────────────────

describe("o corpo da issue — o contexto, o delta, a matriz e os limites", () => {
  it("carrega o marcador do contrato (sem ele o fechamento não reconhece a dívida)", () => {
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, registroFaltando())
    expect(corpo).toContain(MERGE_GATE_MARKER_ID)
    expect(corpo).toContain("<!--")
  })

  it("diz o CONTEXTO exigido — a lista inteira, não só o que falta", () => {
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, registroFaltando())
    expect(corpo).toContain("**Contexto exigido pelo manifesto (4):**")
    for (const contexto of CONTEXTOS) expect(corpo).toContain(`- \`${contexto}\``)
  })

  it("diz a DIREÇÃO do erro de cada lado do delta", () => {
    const faltando = publisherBody(MERGE_GATE_PUBLISHER, registroFaltando())
    expect(faltando).toContain("**faltam 2**")
    expect(faltando).toContain("o merge passa com ele vermelho")

    const sobrando = publisherBody(MERGE_GATE_PUBLISHER, registroSobrando())
    expect(sobrando).toContain("**sobram 1**")
    expect(sobrando).toContain("trava esperando para sempre")

    const contagem = publisherBody(MERGE_GATE_PUBLISHER, registroComContagem())
    expect(contagem).toContain("**com CONTAGEM 1**")
    expect(contagem).toContain("`Mutation guards (27 tests)` → `(27 tests)`")
    expect(contagem).toContain("check:mutation-count")
  })

  it("traz a MATRIZ de merge com o desfecho de cada caso (a prova, não o resumo)", () => {
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, matrizQuebrada())
    expect(corpo).toContain("| caso | esperado | obtido | HTTP | motivo |")
    expect(corpo).toContain("`gate-vermelho`")
    expect(corpo).toContain("NÃO mergeia")
    expect(corpo).toContain("❌")
    // O remédio do caso mais grave: a exigência está SEM efeito.
    expect(corpo).toContain("enable_status_check")
  })

  it("traz o que o APLIADOR fez, incluindo o `--check` com a exigência desligada", () => {
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, registroFaltando())
    expect(corpo).toContain("O que o applier fez neste ensaio")
    expect(corpo).toContain("com a exigência desligada à mão: vê o drift = `true`")
    expect(corpo).toContain("um detector")
  })

  it("uma verificação que a prova NÃO chegou a medir é DITA — `undefined` não é valor", () => {
    // Medido no caminho real: com o registro divergente a prova aborta ANTES de
    // rodar os dois `--check`, e os campos chegam ausentes. Renderizá-los como
    // `undefined` no corpo da issue é pior que a ausência: parece um valor.
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, {
      ...registroFaltando(),
      applier: { applied: true },
    })
    expect(corpo).not.toContain("undefined")
    expect(corpo).toContain("em sincronia = não medido (a prova parou antes deste ponto)")
    expect(corpo).toContain("vê o drift = não medido (a prova parou antes deste ponto)")
  })

  it("os LIMITES vêm do RELATÓRIO (a issue e a CLI não podem discordar)", () => {
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, registroFaltando())
    expect(corpo).toContain("O que esta prova NÃO cobre (por desenho)")
    for (const limite of PROOF_LIMITS) expect(corpo).toContain(limite)
  })

  it("o remédio é nomeado: o applier reaplica, e a contagem tem guard próprio", () => {
    const corpo = publisherBody(MERGE_GATE_PUBLISHER, registroFaltando())
    expect(corpo).toContain("bun run ci:required-checks -- --apply")
    expect(corpo).toContain("bun run merge-gate:prove")
  })

  it("o comentário do fechamento carrega a PROVA do momento (não só 'resolvido')", () => {
    const comentario = resolutionComment(provado())
    expect(comentario).toContain("Resolvido")
    expect(comentario).toContain("registro")
    expect(comentario).toContain("matriz de merge: 4 caso(s)")
    expect(comentario).toContain("Fechada automaticamente")
  })
})

// ── o relatório ──────────────────────────────────────────────────────────

describe("loadReport — um relatório truncado não pode passar por 'sem dívida'", () => {
  it("arquivo inexistente, JSON sem `verdict` e `contexts` não-array são erro de uso", () => {
    const dir = makeTmpDir()
    expect(() => loadReport({ report: join(dir, "nao-existe.json") })).toThrow(/não encontrado/)

    const semVeredito = join(dir, "sem-veredito.json")
    writeFileSync(semVeredito, JSON.stringify({ contexts: [] }))
    expect(() => loadReport({ report: semVeredito })).toThrow(/verdict/)

    const semContextos = join(dir, "sem-contextos.json")
    writeFileSync(semContextos, JSON.stringify({ verdict: "proven", contexts: null }))
    expect(() => loadReport({ report: semContextos })).toThrow(/contexts/)
  })

  it("lê o relatório gravado pela prova (o caminho do cron)", () => {
    const dir = makeTmpDir()
    const p = join(dir, "merge-gate.json")
    writeFileSync(p, JSON.stringify(registroFaltando()))
    const relatorio = readReportFile(p)
    expect(relatorio.verdict).toBe("violated")
    expect(mergeGateSignature(relatorio)).toBe(mergeGateSignature(registroFaltando()))
  })

  it("o shape do `gateResult` é o MESMO que o publicador lê (fonte única)", () => {
    // O que a CLI imprime em `--json` é o `gateResult` — e é ele que o
    // publicador consome. Se a prova deixar de emitir `limits`, o corpo da
    // issue perde o aviso do que não foi coberto, e este teste cai.
    const shape = gateResult({ contexts: CONTEXTOS, cases: matrizCerta() })
    expect(shape.limits).toEqual(PROOF_LIMITS)
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["verdict", "contexts", "cases", "registration", "limits"]),
    )
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
      color: MERGE_GATE_PUBLISHER.labelColor,
      description: MERGE_GATE_PUBLISHER.labelDescription,
    })

  const silencioso = () => {}

  it("abre a issue com o label, o título da natureza e o marcador no corpo", async () => {
    const gh = fakeGh()
    await runDebtPublisher({
      publisher: MERGE_GATE_PUBLISHER,
      input: registroFaltando(),
      backend: backend(gh),
      log: silencioso,
    })
    const create = gh.calls.find((c) => c[0] === "issue" && c[1] === "create")
    expect(create).toBeTruthy()
    const texto = create!.join(" ")
    expect(texto).toContain(ISSUE_LABEL)
    expect(texto).toContain(MERGE_GATE_MARKER_ID)
    expect(texto).toContain("REGISTRADA")
  })

  it("o MESMO delta não abre segunda issue (dedup pela assinatura)", async () => {
    const input = registroFaltando()
    const gh = fakeGh([
      {
        number: 51,
        title: MERGE_GATE_PUBLISHER.title(input),
        body: publisherBody(MERGE_GATE_PUBLISHER, input),
      },
    ])
    await runDebtPublisher({
      publisher: MERGE_GATE_PUBLISHER,
      input,
      backend: backend(gh),
      log: silencioso,
    })
    expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "create")).toBe(false)
    expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment")).toBe(false)
  })

  it("um delta NOVO comenta na issue certa — e não na de outra natureza", async () => {
    const gh = fakeGh([
      {
        number: 52,
        title: REGISTRO_TITLE,
        body: publisherBody(MERGE_GATE_PUBLISHER, registroFaltando()),
      },
      {
        number: 53,
        title: MATRIZ_TITLE,
        body: publisherBody(MERGE_GATE_PUBLISHER, matrizQuebrada()),
      },
    ])
    await runDebtPublisher({
      publisher: MERGE_GATE_PUBLISHER,
      input: registroSobrando(),
      backend: backend(gh),
      log: silencioso,
    })
    const comentarios = gh.calls.filter((c) => c[0] === "issue" && c[1] === "comment")
    expect(comentarios).toHaveLength(1)
    expect(comentarios[0]).toContain("52")
    expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "create")).toBe(false)
  })

  it("PROVADO: COMENTA A PROVA ANTES DE FECHAR a issue que nós abrimos", async () => {
    const gh = fakeGh([
      {
        number: 54,
        title: REGISTRO_TITLE,
        body: publisherBody(MERGE_GATE_PUBLISHER, registroFaltando()),
      },
    ])
    const res = await runDebtPublisher({
      publisher: MERGE_GATE_PUBLISHER,
      input: provado(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.closed).toEqual([54])
    const comentario = gh.calls.findIndex((c) => c[1] === "comment")
    const fechamento = gh.calls.findIndex((c) => c[1] === "close")
    expect(comentario).toBeGreaterThan(-1)
    expect(fechamento).toBeGreaterThan(comentario)
  })

  it("NÃO MEDIDO: não publica, não fecha e não toca em issue nenhuma", async () => {
    const gh = fakeGh([
      {
        number: 55,
        title: REGISTRO_TITLE,
        body: publisherBody(MERGE_GATE_PUBLISHER, registroFaltando()),
      },
    ])
    const res = await runDebtPublisher({
      publisher: MERGE_GATE_PUBLISHER,
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
    const gh = fakeGh([{ number: 56, title: "outra coisa", body: "sem marcador" }])
    const res = await runDebtPublisher({
      publisher: MERGE_GATE_PUBLISHER,
      input: provado(),
      backend: backend(gh),
      log: silencioso,
    })
    expect(res.closed).toEqual([])
    expect(gh.calls.some((c) => c[1] === "close")).toBe(false)
  })
})
