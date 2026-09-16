/**
 * guard-timing-issue.test.ts
 *
 * Testes do `scripts/guard-timing-issue.mjs` — o publicador que transforma a
 * REGRESSÃO DE TEMPO do `bench-guard-timing` em ISSUE acionável, no job semanal
 * `guard-timing-alert` do benchmark-weekly.yml.
 *
 * O QUE PRECISA SER PROVADO (o publicador pode "parecer" certo e não alertar):
 *   1. a RÉGUA é a MESMA do relatório (`compareTimings`) — inclusive o PISO de
 *      ruído: um guard barato que oscila 40ms → 60ms (+50%) NÃO é regressão, e
 *      é isso que impede o canal semanal de abrir dívida por ruído de medição;
 *   2. `não medido ≠ resolvido`: forma sem número ou comando que não terminou
 *      (ok: false) deixa a comparação `measured: false` — não publica como
 *      regressão E não fecha a dívida;
 *   3. a assinatura é ESTÁVEL por faixa (o mesmo grau não comenta de novo) e
 *      muda quando a severidade muda de ordem;
 *   4. o corpo é ACIONÁVEL: nomeia o guard, o DELTA (segundos e %) e a baseline;
 *   5. o ciclo completo (criar, dedup, comentar na piora, COMENTAR a prova e
 *      FECHAR ao voltar ao limiar) roda contra um `gh` dublê;
 *   6. o workflow REAL invoca o script e o `ci/periodic-alerts.json` classifica
 *      o job com o canal `issue` (senão o cron volta a ser alerta mudo).
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DEFAULT_BASELINE,
  DEFAULT_REPORT,
  GUARD_TIMING_PUBLISHER,
  ISSUE_LABEL,
  bandOf,
  inputOf,
  isActionable,
  loadReport,
  parseArgs,
  regressionsOf,
  resolutionComment,
  signatureOf,
  timingBody,
  timingTitle,
} from "../../../scripts/guard-timing-issue.mjs"
import { bodyHasSignature, publisherSignatures } from "../../../scripts/issue-publish.mjs"
import {
  REGRESSION_MIN_DELTA_MS,
  REGRESSION_THRESHOLD_PCT,
  compareTimings,
} from "../../../scripts/bench-guard-timing.mjs"
import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"
import { getJob, getSteps, loadWorkflow, readWorkflowContent } from "./helpers/workflow-execution"

const ROOT = process.cwd()
const SCRIPT = join(ROOT, "scripts", "guard-timing-issue.mjs")
const WF = ".github/workflows/benchmark-weekly.yml"
const JOB = "guard-timing-alert"

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Um relatório do `runBenchmark` reduzido ao que a comparação lê. Os valores são
 * em MILISSEGUNDOS: é assim que o benchmark mede (o `toFixed(1)` em segundos é
 * só da impressão), e testar em segundos esconderia justamente o piso de ruído.
 */
function reportOf(
  guards: Record<string, number>,
  {
    doctorMs = 300,
    ok = true,
    commit = "aaaa1111",
  }: { doctorMs?: number; ok?: boolean; commit?: string } = {},
) {
  const list = Object.entries(guards).map(([label, ms]) => ({
    label,
    cmd: `node scripts/${label}.mjs`,
    ms,
    exit: ok ? 0 : 1,
    ok,
  }))
  const guardsTotalMs = list.reduce((acc, guard) => acc + guard.ms, 0)
  return {
    meta: {
      tool: "bench-guard-timing",
      version: 2,
      commit,
      timestamp: "2026-09-16T00:00:00.000Z",
    },
    summary: {
      guardsCount: list.length,
      guardsTotalMs,
      doctorMs,
      doctorExit: 0,
      totalMs: guardsTotalMs + doctorMs,
    },
    guards: list,
    doctor: {
      label: "doctor --ci",
      cmd: "node scripts/forge-doctor.mjs --ci",
      ms: doctorMs,
      exit: 0,
      ok,
    },
    lint: null,
  }
}

/**
 * A baseline de referência dos testes: um guard barato (onde o PISO de ruído
 * morde), DOIS guards caros (para provar que a faixa do dedup não depende de
 * QUAL forma piorou) e o doctor.
 */
const BASELINE = reportOf(
  { "check:barato": 40, "check:caro": 1000, "check:lento": 1000 },
  { doctorMs: 300 },
)

/**
 * O relatório de uma rodada `--merge`: a bateria (guards + doctor) veio de OUTRA
 * rodada e por isso está em `meta.reused` com a procedência. `summary.totalMs`
 * continua preenchido — e é exatamente esse número, de ontem, que a régua não
 * pode julgar como "a medição de agora".
 */
const comBateriaHerdada = (report: object, commit = "aaaa1111") => ({
  ...report,
  meta: {
    ...(report as { meta: object }).meta,
    reused: { battery: { commit, timestamp: "2026-09-15T22:00:00.000Z" } },
  },
})

// ── 1. A régua compartilhada (e o piso de ruído) ──────────────────────────

/**
 * A forma de uma linha da comparação e da comparação inteira, como o
 * `compareTimings` (JS com JSDoc) as devolve — o `forms: object[]` do JSDoc não
 * dá acesso a `.regression`, e o teste precisa ler campo por campo.
 */
type Form = {
  kind: string
  label: string
  currentMs: number | null
  baselineMs: number | null
  deltaMs: number | null
  pct: number | null
  isNew: boolean
  unmeasured: boolean
  regression: boolean
}
type Comparison = {
  measured: boolean
  reason: string | null
  thresholdPct: number
  minDeltaMs: number
  forms: Form[]
  regressions: Form[]
  total: Form | null
}

/** A régua tipada: o mesmo `compareTimings` que o relatório e o publicador usam. */
const compare = (current: object, baseline: object | null): Comparison =>
  compareTimings(current as never, baseline as never) as unknown as Comparison

describe("compareTimings — a MESMA régua do relatório e do publicador", () => {
  it("sem baseline não há veredito: measured=false com o motivo nomeado", () => {
    const cmp = compare(reportOf({ "check:caro": 1000 }), null)
    expect(cmp.measured).toBe(false)
    expect(cmp.reason).toBe("sem baseline para comparar")
    expect(cmp.regressions).toEqual([])
  })

  it("REGRESSÃO: percentual acima do limiar E piora absoluta acima do piso", () => {
    const cmp = compare(reportOf({ "check:caro": 1600 }), BASELINE)
    const form = cmp.forms.find((f) => f.label === "check:caro")!
    expect(form.pct).toBeCloseTo(0.6, 5)
    expect(form.deltaMs).toBe(600)
    expect(form.regression).toBe(true)
    expect(cmp.regressions.map((f) => f.label)).toContain("check:caro")
    expect(cmp.measured).toBe(true)
    expect(cmp.reason).toBeNull()
  })

  it("PISO DE RUÍDO: +50% num guard de 40ms (+20ms) NÃO é regressão", () => {
    // É a borda que mais importa: sem o piso, o canal semanal abriria issue para
    // "check:barato +50%" (40ms → 60ms) toda semana — ruído de escalonamento, não
    // regressão. A amostra é UMA por guard, então o piso é do tamanho do ruído.
    const cmp = compare(reportOf({ "check:barato": 60, "check:caro": 1000 }), BASELINE)
    const ruido = cmp.forms.find((f) => f.label === "check:barato")!
    expect(ruido.pct).toBeCloseTo(0.5, 5)
    expect(ruido.deltaMs).toBe(20)
    expect(ruido.pct).toBeGreaterThan(REGRESSION_THRESHOLD_PCT) // passa do %…
    expect(ruido.regression).toBe(false) // …e NÃO é regressão, pelo piso
    expect(cmp.regressions).toEqual([])
    expect(cmp.measured).toBe(true)
    expect(REGRESSION_MIN_DELTA_MS).toBe(50)
  })

  it("um guard que NÃO terminou (ok: false) não é medido — e nunca é 'melhoria'", () => {
    const cmp = compare(reportOf({ "check:caro": 200 }, { ok: false }), BASELINE)
    const form = cmp.forms.find((f) => f.label === "check:caro")!
    expect(form.unmeasured).toBe(true)
    expect(form.regression).toBe(false)
    expect(cmp.measured).toBe(false)
    expect(cmp.reason).toContain("check:caro")
    // O TOTAL é DERIVADO: ele soma as formas, e uma bateria com um guard que não
    // terminou não é uma medição — julgar o agregado contra a baseline daria
    // "melhoria no total" com regressão nas partes, duas leituras do mesmo run.
    expect(cmp.total!.unmeasured).toBe(true)
    // …e o motivo NOMEIA a forma julgável que faltou, não o agregado (senão o
    // motivo repetiria a bateria inteira em vez de apontar quem não mediu).
    expect(cmp.reason).not.toContain("TOTAL")
  })

  it("forma NOVA (sem baseline) é anotada como nova, nunca como regressão", () => {
    const withLint = { ...reportOf({ "check:caro": 1000 }), lint: { addedPerFanOutMs: 80_000 } }
    const cmp = compare(withLint, BASELINE)
    const lint = cmp.forms.find((f) => f.kind === "lint")!
    expect(lint.isNew).toBe(true)
    expect(lint.baselineMs).toBeNull()
    expect(lint.regression).toBe(false)
    expect(cmp.measured).toBe(true)
  })

  it("um guard que NÃO terminou nunca é regressão, nem com o ms acima do limiar", () => {
    // O `ok: false` é o caso que a própria doc promete cobrir ("forma não medida
    // nunca é regressão"): o guard MORREU no meio e o ms dele é o do pedaço que
    // rodou. Chamar isso de "o gate ficou mais lento" publica uma dívida que
    // ninguém consegue fechar — o número não se reproduz.
    const cmp = compare(reportOf({ "check:caro": 3000 }, { ok: false }), BASELINE)
    const form = cmp.forms.find((f) => f.label === "check:caro")!
    expect(form.pct).toBeGreaterThan(REGRESSION_THRESHOLD_PCT) // o número passou do limiar…
    expect(form.unmeasured).toBe(true)
    expect(form.regression).toBe(false) // …e nem por isso entra no veredito
    expect(cmp.regressions).toEqual([])
    expect(cmp.measured).toBe(false)
  })

  it("bateria HERDADA (`--merge`): o TOTAL não é julgado com o número de ontem", () => {
    // `summary.totalMs` é a soma de guards + doctor. Herdada a bateria, esse
    // total é de OUTRA rodada: julgá-lo como "o total de agora" era o defeito —
    // a issue abria com um delta em segundos que nenhuma medição deste run
    // produziu. Aqui a bateria herdada está ~40% acima da baseline.
    const cmp = compare(comBateriaHerdada(reportOf({ "check:caro": 3000 })), BASELINE)
    expect(cmp.forms.map((f) => f.kind)).not.toContain("guard")
    expect(cmp.total!.unmeasured).toBe(true)
    expect(cmp.total!.regression).toBe(false)
    expect(cmp.regressions).toEqual([])
    expect(cmp.measured).toBe(false)
    // …e o motivo NOMEIA a família herdada: "medição incompleta" sem o nome
    // transfere a investigação para quem lê a issue.
    expect(cmp.reason).toContain("bateria")
    expect(cmp.reason).toContain("herdada")
  })

  it("família que a BASELINE tem e esta rodada não mediu deixa o veredito parcial", () => {
    // `--no-lint`/`--only` pulam famílias: sem isto, um run que não mediu o lint
    // poderia FECHAR uma dívida de lint (a dívida pode ser justamente sobre a
    // família que ficou de fora).
    const comLint = { ...BASELINE, lint: { addedPerSiteMs: 20_000, addedPerFanOutMs: 80_000 } }
    const semLint = reportOf({ "check:caro": 1000 })
    const parcial = compare(semLint, comLint)
    expect(parcial.forms.map((f) => f.kind)).not.toContain("lint")
    expect(parcial.measured).toBe(false)
    expect(parcial.reason).toContain("lint")
    expect(parcial.reason).toContain("não medida nesta rodada")
    // Controle: o MESMO run com o lint medido é completo — a parcialidade é da
    // cobertura, não uma régua mais dura para todo mundo.
    const completo = compare({ ...semLint, lint: { addedPerFanOutMs: 80_000 } }, comLint)
    expect(completo.measured).toBe(true)
    expect(completo.reason).toBeNull()
  })
})

// ── 2. As guardas do contrato ─────────────────────────────────────────────

describe("GUARD_TIMING_PUBLISHER — as guardas do contrato", () => {
  const PUB = GUARD_TIMING_PUBLISHER as unknown as {
    actionable: (input: unknown) => boolean
    scope: { kind: string }
    resolution: { when: (input: unknown) => boolean }
  }

  it("acionável SÓ com regressão medida (o piso de ruído não abre dívida)", () => {
    const caro = inputOf(reportOf({ "check:caro": 1600 }), BASELINE)
    const igual = inputOf(reportOf({ "check:caro": 1000 }), BASELINE)
    // +50% num guard de 40ms: passa do percentual, não passa do piso.
    const ruido = inputOf(reportOf({ "check:barato": 60 }), BASELINE)
    expect([isActionable(caro), isActionable(igual), isActionable(ruido)]).toEqual([
      true,
      false,
      false,
    ])
    // …e o `actionable` DECLARADO no contrato é a MESMA função (sem segunda régua).
    expect([PUB.actionable(caro), PUB.actionable(igual), PUB.actionable(ruido)]).toEqual([
      true,
      false,
      false,
    ])
  })

  it("resolution.when NÃO fecha sem medição completa", () => {
    expect(PUB.resolution.when(inputOf(reportOf({ "check:caro": 1000 }), BASELINE))).toBe(true)
    // Medição quebrada (ok: false) e baseline ausente: não é evidência de resolvido.
    expect(
      PUB.resolution.when(inputOf(reportOf({ "check:caro": 900 }, { ok: false }), BASELINE)),
    ).toBe(false)
    expect(PUB.resolution.when(inputOf(reportOf({ "check:caro": 900 }), null))).toBe(false)
  })

  it("o escopo é SINGLE (a regressão de tempo é UM estado do bench)", () => {
    expect(PUB.scope.kind).toBe("single")
  })
})

// ── 3. A assinatura (dedup sem ruído) ─────────────────────────────────────

describe("signatureOf — faixa estável, não o número exato", () => {
  it("o MESMO grau produz a MESMA assinatura (duas runs não comentam duas vezes)", () => {
    const a = inputOf(reportOf({ "check:caro": 1600 }), BASELINE)
    const b = inputOf(reportOf({ "check:caro": 1610 }), BASELINE)
    expect(bandOf(a)).toBe(bandOf(b))
    expect(signatureOf(a)).toBe(signatureOf(b))
    expect(signatureOf(a)).toContain("band=")
  })

  it("uma piora de ORDEM muda a assinatura (a dívida mudou: comentar é o certo)", () => {
    const leve = inputOf(reportOf({ "check:caro": 1600 }), BASELINE) // +60% → faixa 6
    const grave = inputOf(reportOf({ "check:caro": 4000 }), BASELINE) // +300% → faixa 30
    expect(signatureOf(grave)).not.toBe(signatureOf(leve))
  })

  it("a MESMA faixa em OUTRA forma não muda a assinatura (o corpo diz qual)", () => {
    // O dedup é por SEVERIDADE: se a lista de formas entrasse na assinatura, o
    // rodízio de guard lento comentaria toda semana sem que a dívida mudasse.
    const umGuard = inputOf(reportOf({ "check:caro": 1600 }), BASELINE)
    const outroGuard = inputOf(reportOf({ "check:lento": 1600 }), BASELINE)
    expect(signatureOf(umGuard)).toContain("band=6")
    expect(bandOf(outroGuard)).toBe(bandOf(umGuard))
    expect(signatureOf(outroGuard)).toBe(signatureOf(umGuard))
    // …e o corpo de cada uma nomeia a forma que PIOROU (o "qual" não some).
    expect(timingBody(umGuard)).toContain("`check:caro`")
    expect(timingBody(outroGuard)).toContain("`check:lento`")
    expect(timingBody(outroGuard)).not.toContain("`check:caro`")
  })

  it("a assinatura é VAZIA quando não há regressão (nada a deduplicar)", () => {
    expect(regressionsOf(inputOf(reportOf({ "check:caro": 1000 }), BASELINE))).toEqual([])
    expect(bandOf(inputOf(reportOf({ "check:caro": 1000 }), BASELINE))).toBe(0)
  })
})

// ── 4. A prosa é acionável ────────────────────────────────────────────────

describe("timingProse / resolutionComment — a issue diz o que fazer", () => {
  const comRegressao = inputOf(reportOf({ "check:caro": 1600, "check:barato": 40 }), BASELINE)

  it("o corpo nomeia o guard, o DELTA (segundos e %) e a baseline", () => {
    const body = timingBody(comRegressao)
    expect(body).toContain("`check:caro`")
    expect(body).toContain("+0.6s (+60%)")
    expect(body).toContain("baseline 1.0s → agora 1.6s")
    expect(body).toContain("20%") // o limiar
    expect(body).toContain("50ms") // o piso de ruído, explicado
    expect(body).toContain("bench:guard-timing:baseline") // o remédio deliberado
    expect(body).toContain(REGRESSION_MIN_DELTA_MS.toString())
  })

  it("o corpo COMPLETO (com marcador) é o que a issue carrega", () => {
    const body = timingBody(comRegressao)
    expect(bodyHasSignature(GUARD_TIMING_PUBLISHER, body, signatureOf(comRegressao))).toBe(true)
    expect(publisherSignatures({ body, comments: [] }, GUARD_TIMING_PUBLISHER)).toContain(
      signatureOf(comRegressao),
    )
  })

  it("o comentário de resolução é a PROVA do estado dentro do limiar", () => {
    const dentro = inputOf(reportOf({ "check:caro": 1010 }), BASELINE)
    const comment = resolutionComment(dentro)
    expect(comment).toContain("Resolvido")
    expect(comment).toContain("`check:caro`")
    expect(comment).toContain("1.0s")
    expect(comment).toContain("1.0s".length > 0 ? "baseline" : "")
    expect(comment).not.toContain("REGRESS")
  })

  it("o título é ESTÁVEL (não leva número nem duração)", () => {
    expect(timingTitle()).not.toMatch(/\d+s|\d+%/)
    expect(timingTitle()).toBe(timingTitle())
  })
})

// ── 5. O ciclo completo contra um `gh` dublê ──────────────────────────────

type FakeIssue = {
  number: number
  title: string
  body: string
  labels: string[]
  state: string
  comments: { body: string }[]
}

function makeFakeGh(initial: FakeIssue[] = []) {
  const binDir = mkdtempSync(join(tmpdir(), "gh-fake-guard-timing-"))
  tmpDirs.push(binDir)
  const statePath = join(binDir, "issues.json")
  writeFileSync(statePath, JSON.stringify(initial), "utf8")

  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
const STATE = ${JSON.stringify(statePath)}
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(STATE, "utf8"))
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2))
const fail = (msg) => { process.stderr.write("gh fake: " + msg + "\\n"); process.exit(1) }
if (args[0] === "label" && args[1] === "create") process.exit(0)
if (args[0] !== "issue") fail("subcomando nao modelado: " + args.join(" "))
if (args[1] === "list") {
  const label = flag("--label")
  const want = flag("--state") ?? "open"
  const out = state
    .filter((i) => i.state === want && (!label || i.labels.includes(label)))
    .map(({ number, title, body, comments }) => ({ number, title, body, comments }))
  process.stdout.write(JSON.stringify(out))
  process.exit(0)
}
if (args[1] === "create") {
  const number = state.reduce((max, i) => Math.max(max, i.number), 0) + 1
  state.push({ number, title: flag("--title") ?? "", body: flag("--body") ?? "", labels: [flag("--label")], state: "open", comments: [] })
  save()
  process.stdout.write("https://github.com/severinno/severinno/issues/" + number + "\\n")
  process.exit(0)
}
if (args[1] === "comment" || args[1] === "close") {
  const issue = state.find((i) => String(i.number) === args[2])
  if (!issue) fail("issue #" + args[2] + " nao existe")
  if (args[1] === "comment") issue.comments.push({ body: flag("--body") ?? "" })
  else issue.state = "closed"
  save()
  process.exit(0)
}
fail("comando nao modelado: " + args.join(" "))
`,
    { mode: 0o755 },
  )

  return {
    binDir,
    open: (): FakeIssue[] =>
      (JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[]).filter(
        (i) => i.state === "open",
      ),
    issues: (): FakeIssue[] => JSON.parse(readFileSync(statePath, "utf8")) as FakeIssue[],
  }
}

describe("CLI + gh dublê — o ciclo abrir/comentar/fechar", () => {
  /** Escreve os dois relatórios e roda o publisher REAL contra o `gh` fake. */
  function run(fake: { binDir: string }, current: object, baseline: object | null = BASELINE) {
    const dir = mkdtempSync(join(tmpdir(), "guard-timing-report-"))
    tmpDirs.push(dir)
    const reportPath = join(dir, "latest.json")
    const baselinePath = join(dir, "baseline.json")
    writeFileSync(reportPath, JSON.stringify(current, null, 2), "utf8")
    writeFileSync(baselinePath, JSON.stringify(baseline ?? BASELINE, null, 2), "utf8")
    return spawnSync(
      process.execPath,
      [SCRIPT, "--report", reportPath, "--baseline", baselinePath],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
      },
    )
  }

  it("run 1 com regressão → CRIA uma issue com o label do publicador", () => {
    const fake = makeFakeGh()
    const res = run(fake, reportOf({ "check:caro": 1600 }))
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Issue criada")
    expect(fake.open()).toHaveLength(1)
    expect(fake.open()[0].labels).toContain(ISSUE_LABEL)
    expect(fake.open()[0].body).toContain("`check:caro`")
  })

  it("run 2 com o MESMO grau → NÃO cria e NÃO comenta (o cron não vira ruído)", () => {
    const fake = makeFakeGh()
    expect(run(fake, reportOf({ "check:caro": 1600 })).status).toBe(0)
    const second = run(fake, reportOf({ "check:caro": 1605 }))
    expect(second.stdout).toContain("já reportada na issue #1")
    expect(fake.open()).toHaveLength(1)
    expect(fake.issues()[0].comments).toHaveLength(0)
  })

  it("piora de ORDEM → comenta UMA vez; repetir não comenta de novo", () => {
    const fake = makeFakeGh()
    run(fake, reportOf({ "check:caro": 1600 }))
    const pior = run(fake, reportOf({ "check:caro": 4000 }))
    expect(pior.stdout).toContain("Comentário adicionado à issue #1")
    expect(fake.issues()[0].comments).toHaveLength(1)
    run(fake, reportOf({ "check:caro": 4010 }))
    expect(fake.issues()[0].comments).toHaveLength(1)
  })

  it("de volta ao LIMIAR → comenta a PROVA e FECHA o que abrimos", () => {
    const fake = makeFakeGh()
    run(fake, reportOf({ "check:caro": 1600 }))
    const limpo = run(fake, reportOf({ "check:caro": 1010 }))
    expect(limpo.stdout).toContain("Reconciliado")
    expect(fake.open()).toHaveLength(0)
    expect(fake.issues()[0].state).toBe("closed")
    expect(fake.issues()[0].comments.some((c) => c.body.includes("Resolvido"))).toBe(true)
  })

  it("medição QUEBRADA dentro do limiar → NÃO fecha (não medido ≠ resolvido)", () => {
    const fake = makeFakeGh()
    run(fake, reportOf({ "check:caro": 1600 }))
    const quebrado = run(fake, reportOf({ "check:caro": 1010 }, { ok: false }))
    expect(quebrado.status).toBe(0)
    expect(quebrado.stdout).toContain("NÃO reconciliando")
    expect(fake.open()).toHaveLength(1)
    expect(fake.issues()[0].comments).toHaveLength(0)
  })

  it("bateria HERDADA → NÃO fecha a dívida (herdar não é medir agora)", () => {
    // A rodada anterior mediu de verdade e abriu a issue; esta mediu outra coisa
    // e herdou a bateria por `--merge`. O número da bateria é de ontem, então ele
    // não é evidência de que o tempo voltou — nem de que piorou.
    const fake = makeFakeGh()
    run(fake, reportOf({ "check:caro": 1600 }))
    expect(fake.open()).toHaveLength(1)

    const herdado = comBateriaHerdada(reportOf({ "check:caro": 3000 }))
    const res = run(fake, herdado)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("NÃO reconciliando")
    expect(res.stdout).toContain("bateria") // o log diz QUAL família faltou
    expect(fake.open()).toHaveLength(1)
    expect(fake.issues()[0].comments).toHaveLength(0)
  })

  it("relatório ou baseline AUSENTE é erro (exit 1), nunca 'nada a fazer'", () => {
    const fake = makeFakeGh()
    const dir = mkdtempSync(join(tmpdir(), "guard-timing-missing-"))
    tmpDirs.push(dir)
    const missing = spawnSync(
      process.execPath,
      [SCRIPT, "--report", join(dir, "nao-existe.json"), "--baseline", join(dir, "nao.json")],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fake.binDir}:${process.env.PATH ?? ""}` },
      },
    )
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("não existe")
    expect(fake.issues()).toHaveLength(0)
  })
})

// ── 6. O caminho da CLI e a colocação no cron ─────────────────────────────

describe("CLI e o job periódico", () => {
  it("os defaults apontam para os arquivos VERSIONADOS do bench", () => {
    expect(DEFAULT_REPORT).toBe(join("docs", "benchmarks", "guard-timing-latest.json"))
    expect(DEFAULT_BASELINE).toBe(join("docs", "benchmarks", "guard-timing-baseline.json"))
    expect(parseArgs([]).report).toBe(DEFAULT_REPORT)
    expect(parseArgs([]).baseline).toBe(DEFAULT_BASELINE)
    expect(parseArgs(["--no-reconcile"]).reconcile).toBe(false)
  })

  it("loadReport recusa arquivo ausente (fail-closed)", () => {
    expect(() => loadReport("/nao/existe.json")).toThrow(/não existe/)
  })

  it("o job real MEDE o bench e roda o publicador", () => {
    const wf = loadWorkflow(WF)
    const job = getJob(wf, JOB)!
    expect(job).toBeTruthy()
    const runs = getSteps(job).flatMap((step) => (step.run ? [step.run] : []))
    const texto = runs.join("\n")
    expect(texto).toContain("bench-guard-timing.mjs --json")
    expect(texto).toContain("scripts/guard-timing-issue.mjs")
    // O veredito NÃO pode vir do `--compare` (exit 1): o canal é a issue, e o
    // run do cron fica verde de propósito (tempo não é corretude).
    expect(texto).not.toContain("--compare")
  })

  it("o manifesto dos jobs periódicos classifica o job com o canal `issue`", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"))
    const entry = manifest.forges.github.find(
      (item: { workflow: string; job: string }) => item.workflow === WF && item.job === JOB,
    )
    expect(entry).toBeTruthy()
    expect(entry.channel).toBe("issue")
    // A evidência declarada tem de estar DENTRO do bloco do job.
    expect(jobBlock(readWorkflowContent(WF), JOB)).toContain(entry.evidence)
  })
})
