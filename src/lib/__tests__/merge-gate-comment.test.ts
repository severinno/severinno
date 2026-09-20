/**
 * merge-gate-comment.test.ts
 *
 * Trava o `scripts/merge-gate-comment.mjs` — a OUTRA PONTA do veredito do
 * `merge-gate:prove`: o mesmo relatório do cron, entregue como COMENTÁRIO
 * RECONCILIADO no PR que mudou o applier (onde o autor lê), em vez de esperar a
 * segunda-feira seguinte.
 *
 * O que precisa ser provado (um canal assim pode publicar no PR errado, abrir
 * ruído a cada run, ou — o pior — RETIRAR o aviso com base numa medição que não
 * aconteceu):
 *   1. a DECISÃO por veredito: `violated` publica, `proven` retira, `unavailable`
 *      e veredito desconhecido NÃO tocam em nada ("não medido" não é evidência de
 *      "resolvido");
 *   2. o CORPO carrega o que o autor precisa para consertar — o contexto exigido,
 *      o delta nas três direções, a matriz caso a caso, os bloqueadores e os
 *      LIMITES, todos do MESMO relatório da issue (uma segunda leitura do JSON
 *      divergiria no dia em que o campo fosse renomeado);
 *   3. o corpo é ESTÁVEL (sem data/URL do run): duas medições com o mesmo delta
 *      produzem o mesmo texto, e é isso que faz a reconciliação virar `noop` em
 *      vez de reescrever o comentário toda semana;
 *   4. o CICLO de reconciliação (API dublê): cria na 1ª, `noop` na 2ª, atualiza na
 *      3ª e RETIRA na 4ª — e os comentários de OUTRO canal (o remédio do
 *      pre-commit pode viver no mesmo PR) ficam intactos;
 *   5. a CLI: `--dry-run` imprime o corpo sem tocar a API, e um veredito
 *      `unavailable` NÃO fala com a API (o canal é pulado, tudo o que ele faz é
 *      avisar que o comentário anterior fica de pé);
 *   6. o CONTRATO do workflow: o trigger de PR filtrado pelos caminhos que a prova
 *      mede, o passo do comentário com `always()`, a ISSUE restrita ao cron, o
 *      `unavailable` como AVISO no PR (e falha no cron) e o relatório num
 *      diretório do job (o cron e o canal de PR podem rodar juntos).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { afterAll, describe, expect, it } from "vitest"
import yaml from "js-yaml"

import {
  COMMENT_MARKER,
  EXIT,
  bodyOf,
  decisionOf,
  mergeGateCommentBody,
  parseArgs,
} from "../../../scripts/merge-gate-comment.mjs"
import { MARKER as REMEDY_MARKER } from "../../../scripts/pr-remedy-comment.mjs"
import {
  ChannelDenied,
  decideComment,
  reconcileComment,
} from "../../../scripts/pr-comment-channel.mjs"
import {
  casesPlan,
  gateResult,
  registrationDelta,
} from "../../../scripts/prove-gitea-merge-gate.mjs"

const CWD = process.cwd()
const SCRIPT = join(CWD, "scripts", "merge-gate-comment.mjs")
const WF_PATH = ".github/workflows/merge-gate-proof.yml"

/** Os contextos que o manifesto exige (a lista REAL do ensaio, reduzida). */
const CONTEXTOS = ["Lint", "Repo Guards", "Tests", "TypeCheck"]

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mgc-"))
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

const applierOk = () => ({ applied: true, checkInSync: true, checkSeesDisabled: true })

/** O veredito VIOLADO pelo REGISTRO — o delta é o que o autor precisa ver. */
const registroFaltando = (missing = ["TypeCheck"], withCount: any[] = []) =>
  gateResult({
    verdict: "violated",
    detail: "a proteção registrada não bate com o manifesto",
    contexts: CONTEXTOS,
    cases: matrizCerta(),
    enforcement: { enabled: true, contexts: CONTEXTOS.slice(0, 2) },
    registration: {
      ...registrationDelta({
        expected: CONTEXTOS,
        registered: CONTEXTOS.filter((c) => !missing.includes(c)),
      }),
      withCount,
    },
    applier: applierOk(),
    blockers: ["a exigência (enable_status_check) está desligada"],
  })

/** O veredito PROVADO: o registro bate e a matriz morde. */
const provado = () =>
  gateResult({
    verdict: "proven",
    detail: "a proteção registrada é exatamente o manifesto",
    contexts: CONTEXTOS,
    cases: matrizCerta(),
    enforcement: { enabled: true, contexts: CONTEXTOS },
    registration: registrationDelta({ expected: CONTEXTOS, registered: CONTEXTOS }),
    applier: applierOk(),
  })

const naoMedido = () =>
  gateResult({
    verdict: "unavailable",
    detail: "sem docker: o container do ensaio não subiu",
    contexts: [],
    cases: [],
  })

// ── a DECISÃO por veredito ──────────────────────────────────────────────

describe("a decisão (pura)", () => {
  it("violated publica, proven retira, unavailable NÃO toca em nada", () => {
    expect(decisionOf(registroFaltando())).toBe("publicar")
    expect(decisionOf(provado())).toBe("retirar")
    expect(decisionOf(naoMedido())).toBe("nao-medido")
  })

  it("um veredito DESCONHECIDO não vira publicação nem retirada", () => {
    // A seta aponta para o lado seguro: sem veredito reconhecido não há o que
    // publicar — e retirar seria pior, porque apagaria um aviso com base em algo
    // que ninguém leu.
    expect(decisionOf({ verdict: "algo-novo", contexts: [] })).toBe("nao-medido")
    expect(decisionOf({ contexts: [] })).toBe("nao-medido")
  })

  it("o corpo é `null` quando não há o que publicar (o sinal de RETIRAR)", () => {
    expect(bodyOf(registroFaltando())).toContain(COMMENT_MARKER)
    expect(bodyOf(provado())).toBeNull()
    expect(bodyOf(naoMedido())).toBeNull()
  })
})

// ── o CORPO ─────────────────────────────────────────────────────────────

describe("o corpo do comentário", () => {
  it("diz o CONTEXTO exigido e o DELTA nas três direções", () => {
    // DOIS contextos que o manifesto exige e o registro não tem ("Tests" e
    // "TypeCheck"): `missing` só conta o que está no MANIFESTO — pedir um nome
    // que não existe ali não engorda o delta, e um teste que o fizesse mediria a
    // contagem errada.
    const body = mergeGateCommentBody(
      registroFaltando(["Tests", "TypeCheck"], [{ context: "Mutation guards master", count: 15 }]),
    )

    // O CONTEXTO (o que o manifesto exige) — a lista inteira, não só o delta.
    for (const context of CONTEXTOS) expect(body).toContain(`\`${context}\``)
    // O DELTA: o que falta é o caso em que o merge PASSA com o gate vermelho.
    expect(body).toContain("faltam 2")
    expect(body).toContain("o job roda e o merge passa com ele vermelho")
    // A CONTAGEM: o nome muda quando a matriz cresce.
    expect(body).toContain("com CONTAGEM 1")
    expect(body).toContain("Mutation guards master")
    // A MATRIZ, caso a caso, e os bloqueadores que a prova nomeia.
    expect(body).toContain("A MATRIZ de merge")
    for (const testCase of matrizCerta()) expect(body).toContain(`\`${testCase.id}\``)
    expect(body).toContain("enable_status_check")
    // O remédio na MUDANÇA (é o que o autor faz com isto).
    expect(body).toContain("ci:required-checks -- --apply")
  })

  it("carrega os LIMITES do MESMO relatório (não de uma segunda lista)", () => {
    const body = mergeGateCommentBody(registroFaltando())
    const limites = registroFaltando().limits ?? []
    expect(limites.length).toBeGreaterThan(0)
    for (const limit of limites) expect(body).toContain(limit)
  })

  it("é ESTÁVEL: duas leituras do mesmo relatório dão o mesmo texto (a reconciliação vira noop)", () => {
    // Sem data e sem URL do run: um rodapé com timestamp faria o comentário ser
    // reescrito a cada run, e o canal nunca ficaria quieto com o delta igual.
    const report = registroFaltando()
    expect(mergeGateCommentBody(report)).toBe(mergeGateCommentBody(report))
    expect(mergeGateCommentBody(report)).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it("o marcador é PRÓPRIO — os dois canais podem viver no mesmo PR", () => {
    expect(COMMENT_MARKER).not.toBe(REMEDY_MARKER)
    expect(bodyOf(registroFaltando())).toContain(COMMENT_MARKER)
    expect(bodyOf(registroFaltando())).not.toContain(REMEDY_MARKER)
  })
})

// ── o CICLO de reconciliação (API dublê) ────────────────────────────────

/** Uma API de comentários em memória, com o mesmo contrato dos dois backends. */
function fakeApi({ deny = false, fail = null as string | null } = {}) {
  const comments: { id: number; body: string }[] = []
  let nextId = 1
  const calls: { method: string; path: string }[] = []
  const request = async (_config: any, method: string, path: string, body?: any) => {
    calls.push({ method, path })
    if (fail && method === fail) return { status: 500, data: null, text: "boom" }
    if (deny) return { status: 403, data: null, text: "forbidden" }
    const listMatch = /^\/issues\/\d+\/comments/.exec(path)
    if (method === "GET" && listMatch) return { status: 200, data: comments, text: "" }
    if (method === "POST") {
      const created = { id: nextId++, body: body.body }
      comments.push(created)
      return { status: 201, data: created, text: "" }
    }
    const idMatch = /^\/issues\/comments\/(\d+)$/.exec(path)
    if (method === "PATCH" && idMatch) {
      const alvo = comments.find((c) => c.id === Number(idMatch[1]))
      if (alvo) alvo.body = body.body
      return { status: 200, data: alvo, text: "" }
    }
    if (method === "DELETE" && idMatch) {
      const i = comments.findIndex((c) => c.id === Number(idMatch[1]))
      if (i >= 0) comments.splice(i, 1)
      return { status: 204, data: null, text: "" }
    }
    return { status: 200, data: [], text: "" }
  }
  return { comments, calls, request }
}

const base = (api: any) => ({ request: api.request, config: {}, kind: "github", pr: 7 })

describe("o ciclo de reconciliação (API dublê)", () => {
  it("cria na 1ª, não repete na 2ª, atualiza na 3ª e RETIRA na 4ª", async () => {
    const api = fakeApi()
    const corpo = bodyOf(registroFaltando()) as string

    const r1 = await reconcileComment({ ...base(api), body: corpo, marker: COMMENT_MARKER })
    expect(r1.action).toBe("created")
    expect(api.comments).toHaveLength(1)

    const r2 = await reconcileComment({ ...base(api), body: corpo, marker: COMMENT_MARKER })
    expect(r2.action).toBe("noop")
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(1)

    const corpoNovo = bodyOf(registroFaltando(["Repo Guards", "TypeCheck"])) as string
    const r3 = await reconcileComment({ ...base(api), body: corpoNovo, marker: COMMENT_MARKER })
    expect(r3.action).toBe("updated")
    expect(api.comments).toHaveLength(1)

    // `proven` = o delta sumiu: o comentário é RETIRADO, não deixado aberto.
    const r4 = await reconcileComment({ ...base(api), body: null, marker: COMMENT_MARKER })
    expect(r4.action).toBe("removed")
    expect(api.comments).toHaveLength(0)

    const r5 = await reconcileComment({ ...base(api), body: null, marker: COMMENT_MARKER })
    expect(r5.action).toBe("noop")
  })

  it("o comentário de OUTRO canal no mesmo PR fica INTACTO", async () => {
    const api = fakeApi()
    api.comments.push({ id: 90, body: `${REMEDY_MARKER}\nremendo do pre-commit` })

    const out = await reconcileComment({
      ...base(api),
      body: bodyOf(registroFaltando()) as string,
      marker: COMMENT_MARKER,
    })
    expect(out.action).toBe("created")
    // Dois comentários (o alheio e o nosso), e o alheio segue no lugar.
    expect(api.comments).toHaveLength(2)
    expect(api.comments.some((c) => c.body.includes(REMEDY_MARKER))).toBe(true)

    // E a RETIRADA do nosso não leva o do outro junto.
    await reconcileComment({ ...base(api), body: null, marker: COMMENT_MARKER })
    expect(api.comments.map((c) => c.id)).toEqual([90])
  })

  it("duas cópias nossas (runs concorrentes): o resíduo é retirado", async () => {
    const api = fakeApi()
    api.comments.push(
      { id: 91, body: `${COMMENT_MARKER}\nvelho` },
      { id: 92, body: `${COMMENT_MARKER}\nmais velho` },
    )
    const out = await reconcileComment({
      ...base(api),
      body: bodyOf(registroFaltando()) as string,
      marker: COMMENT_MARKER,
    })
    expect(out.action).toBe("updated")
    expect(api.comments.map((c) => c.id)).toEqual([91])
  })

  it("o canal que EXISTE e recusa é erro; o 403 é canal SEM ESCRITA (aviso)", async () => {
    const quebrado = fakeApi({ fail: "GET" })
    await expect(
      reconcileComment({
        ...base(quebrado),
        body: bodyOf(registroFaltando()) as string,
        marker: COMMENT_MARKER,
      }),
    ).rejects.toThrow(/HTTP 500/)

    const semEscrita = fakeApi({ deny: true })
    await expect(
      reconcileComment({
        ...base(semEscrita),
        body: bodyOf(registroFaltando()) as string,
        marker: COMMENT_MARKER,
      }),
    ).rejects.toBeInstanceOf(ChannelDenied)
  })

  it("FALHA ALTO sem marcador (o canal é identificado por ele)", async () => {
    const api = fakeApi()
    await expect(reconcileComment({ ...base(api), body: "x", marker: "" } as any)).rejects.toThrow(
      /marcador/,
    )
  })

  it("a decisão pura cobre as quatro respostas (a do canal, não a do remédio)", () => {
    expect(decideComment({ hasPrevious: false, body: "x" })).toBe("create")
    expect(decideComment({ hasPrevious: true, previousBody: "x", body: "y" })).toBe("update")
    expect(decideComment({ hasPrevious: true, previousBody: "x", body: "x" })).toBe("noop")
    expect(decideComment({ hasPrevious: true, previousBody: "x", body: null })).toBe("remove")
  })
})

// ── a CLI ───────────────────────────────────────────────────────────────

/** Escreve um relatório num arquivo temporário e devolve o caminho. */
function writeReport(report: unknown): string {
  const path = join(makeTmpDir(), "merge-gate.json")
  writeFileSync(path, JSON.stringify(report), "utf8")
  return path
}

/** Roda a CLI com um ambiente controlado (o canal aponta para uma porta morta). */
function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: CWD,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      // A porta 9 (discard) está fechada: se a CLI FALAR com a API, o `fetch`
      // recusa e o processo sai 2. É assim que "não tocou a API" vira MEDIDO.
      GH_TOKEN: "x",
      GH_REPOSITORY: "owner/repo",
      PR_NUMBER: "42",
      GH_API_URL: "http://127.0.0.1:9",
      ...env,
    },
  })
}

describe("a CLI", () => {
  it("`--dry-run` imprime o corpo e NÃO fala com a API", () => {
    const r = runCli(["--report", writeReport(registroFaltando()), "--dry-run"])
    expect(r.status).toBe(EXIT.OK)
    expect(r.stdout).toContain(COMMENT_MARKER)
    expect(r.stdout).toContain("falta")
    expect(r.stderr).toContain("NADA foi gravado")
  })

  it("`unavailable` NÃO fala com a API e NÃO retira o comentário anterior", () => {
    // O canal ESTÁ configurado (token + repo + PR): se o publicador não pulasse o
    // caminho do `unavailable`, ele tentaria listar os comentários na porta morta
    // e sairia 2 (publicação quebrada). Sair 0 com o aviso é a prova executada de
    // que "não medido" não vira publicação NEM retirada.
    const r = runCli(["--report", writeReport(naoMedido()), "--backend", "github"])
    expect(r.status).toBe(EXIT.OK)
    expect(r.stderr).toContain("NÃO mediu")
    expect(r.stderr).toContain("NÃO é retirado")
    expect(r.stderr).not.toContain("::error::")
  })

  it("`violated` FALA com a API (a porta morta denuncia o canal quebrado: exit 2)", () => {
    // A contraprova do teste acima: com um veredito que PUBLICA, a CLI chega até
    // a API — e uma API inalcançável é publicação QUEBRADA (exit 2), não silêncio.
    const r = runCli(["--report", writeReport(registroFaltando()), "--backend", "github"])
    expect(r.status).toBe(EXIT.UNPUBLISHED)
    expect(r.stderr).toContain("::error::")
  })

  it("sem canal: aviso nomeado e exit 0 (o cron segue sendo o canal)", () => {
    const r = runCli(["--report", writeReport(registroFaltando()), "--backend", "gitea"], {
      GITEA_TOKEN: "",
      GITEA_URL: "",
      GITEA_REPOSITORY: "owner/repo",
    })
    expect(r.status).toBe(EXIT.OK)
    expect(r.stderr).toContain("::notice::")
    expect(r.stderr).toContain("NÃO foi publicado")
  })

  it("uso inválido (`--backend` desconhecido) sai 3 e não publica nada", () => {
    const r = runCli(["--report", writeReport(registroFaltando()), "--backend", "tgz"])
    expect(r.status).toBe(EXIT.USAGE)
    expect(r.stdout).not.toContain(COMMENT_MARKER)
  })

  it("o parser aceita o contrato do workflow (--report/--backend) sem inventar opção", () => {
    expect(parseArgs(["--report", "/tmp/x.json", "--backend", "github"])).toMatchObject({
      report: "/tmp/x.json",
      backend: "github",
    })
    expect(() => parseArgs(["--nao-existe"])).toThrow(/desconhecido/)
    expect(() => parseArgs(["--backend", "outra"])).toThrow(/github\|gitea/)
  })
})

// ── o CONTRATO do workflow ──────────────────────────────────────────────

type Step = { name?: string; env?: Record<string, string>; run?: string; if?: string }
type Workflow = {
  on: Record<string, unknown>
  permissions?: Record<string, string>
  jobs: Record<string, { steps: Step[] }>
}

const wf = () => yaml.load(readFileSync(join(CWD, WF_PATH), "utf8")) as Workflow
const steps = () => wf().jobs["merge-gate-proof"]?.steps ?? []
const stepWith = (frag: string): Step => {
  const step = steps().find((s) => (s.run ?? "").includes(frag))
  expect(step, `o passo que roda '${frag}' sumiu de ${WF_PATH}`).toBeTruthy()
  return step as Step
}

describe("o contrato do workflow (a outra ponta)", () => {
  it("roda no PR, filtrado pelos CAMINHOS que a prova mede", () => {
    const paths = (wf().on as any).pull_request?.paths as string[]
    expect(Array.isArray(paths)).toBe(true)
    // O SUJEITO da prova (o applier), o manifesto e o próprio publicador.
    expect(paths).toContain("scripts/apply-required-checks.mjs")
    expect(paths).toContain("ci/required-checks.json")
    expect(paths).toContain("scripts/merge-gate-comment.mjs")
    // E o cron continua agendado (o canal da issue não foi substituído).
    expect(Array.isArray((wf().on as any).schedule)).toBe(true)
  })

  it("o comentário vai ao PR com `always()`, o relatório do job e o canal do GitHub", () => {
    const step = stepWith("merge-gate-comment.mjs")
    expect(step.if).toContain("always()")
    expect(step.if).toContain("github.event_name == 'pull_request'")
    expect(step.run).toContain("--report")
    expect(step.run).toContain("--backend github")
    // NUNCA `--dry-run`: o modo não toca o backend e a retirada sumiria.
    expect(step.run).not.toContain("--dry-run")
    // O relatório vive no diretório do JOB: o cron e o canal de PR podem rodar ao
    // mesmo tempo, e um caminho fixo em `/tmp` faria um sobrescrever o outro.
    expect(step.env?.REPORT).toContain("runner.temp")
    expect((wf().permissions as any)["pull-requests"]).toBe("write")
  })

  it("a ISSUE é do CRON: num PR ela não publica nem fecha", () => {
    const step = stepWith("merge-gate-issue.mjs")
    expect(step.if).toContain("always()")
    expect(step.if).toContain("github.event_name != 'pull_request'")
    expect(step.env?.REPORT).toContain("runner.temp")
  })

  it("no PR, `unavailable` é AVISO; no cron, FALHA (um cron que não mediu não pode ser verde)", () => {
    const aviso = steps().find((s) => (s.name ?? "").includes("não pôde ser MEDIDA"))
    expect(aviso, "o aviso do PR não medido sumiu").toBeTruthy()
    expect(aviso?.if).toContain("github.event_name == 'pull_request'")
    expect(aviso?.if).toContain("!= 'violated'")

    const fail = steps().find((s) => (s.name ?? "").startsWith("Fail on violation"))
    expect(fail?.if).toContain("steps.prove.outputs.exit_code != '0'")
    // A falha por NÃO MEDIR é do cron: no PR ela só acontece por VIOLAÇÃO.
    expect(fail?.if).toContain(
      "github.event_name != 'pull_request' || steps.prove.outputs.verdict == 'violated'",
    )
  })
})
