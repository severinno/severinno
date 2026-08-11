/**
 * guard-gates-exclusivity.test.ts - DERIVES the exclusivity relations of the
 * scan-guard-gates rules (which signals can NEVER co-occur in a single scan)
 * from the guard's own emission code and VALIDATES the documented matrix of
 * sec 8.14 (gates-proofs.md): rule 1 bot rule 2 (WORKFLOW MISSING bot PATHS
 * FILTER) e rule 4 bot rule 5 (FRAGILE GUARD JOB MISSING bot FRAGILE GUARD
 * NEEDS).
 *
 * WHY: sec 8.14 documents those two exclusivities em PROSA ("mutuamente
 * exclusivo por construcao") como a razao de a Prova 17 precisar de DOIS
 * runs. Esta suite transforma a prosa em CONTRATO DERIVADO: ela enumera o
 * espaco ALCANCAVEL de resultados do scan (um modelo documentado das
 * invariantes estruturais do scanGuardGates - cada restricao citada ao
 * codigo), roda a MESMA funcao de emissao que o CLI usa (emittedSignals,
 * refatorado em 2026-08 para ser o single source) e deriva o conjunto
 * exclusivo (pares que nunca co-emitem). A matriz documentada e VALIDADA
 * contra esse conjunto - e o refinamento honesto tambem (a exclusividade do
 * rule 1 bot rule 2 e POR-ALVO: WORKFLOW MISSING@guard-gates.yml bot PATHS
 * FILTER, mas WORKFLOW MISSING@pr-check.yml COEXISTE com PATHS FILTER).
 *
 * REFINAMENTO derivado (a prosa da sec 8.14 nao diz): as exclusividades sao
 * (key, target)-scoped, nao globais. rule 1 bot rule 2 vale apenas quando o
 * workflow ausente E o push net (o scan de paths so roda se o arquivo
 * existe); a forma global (qualquer WORKFLOW MISSING) NAO vale.
 *
 * O modelo (reachableResults + resultOf) espelha a agregacao do
 * scanGuardGates com as invariantes documentadas; os REAL anchors no fim
 * provam o modelo contra o scan real em fixtures de disco (o padrao hermetic
 * + REAL da rede). Nao spawna subprocesso (scanGuardGates + emittedSignals
 * rodam in-process) - os timeouts explicitos sao so por consistencia.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { emittedSignals, scanGuardGates } from "../scan-guard-gates.mjs"
import { ENCODING_CI_NET, GUARD_PR_TWIN, GUARD_PUSH_NET, cleanupTempDirs, createTempDir, writeGuardGatesWorkflow } from "./golden-copy-utils"

const PUSH = GUARD_PUSH_NET
const TWIN = GUARD_PR_TWIN
const CI = ENCODING_CI_NET
const CTX = { prWorkflow: TWIN, pushNet: PUSH }
const sigId = (s: { key: string; target: string }): string => `${s.key}@${s.target}`

/** Sorted pair identity - derive() stores pairs as `a|b` with a < b. */
const pairOf = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

function writeFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

// ---------------------------------------------------------------------------
// The reachable-result MODEL: the structural invariants of scanGuardGates,
// each documented with the code it mirrors. The derivation below consumes
// resultOf() -> emittedSignals() (the SAME emission function the CLI runs).
// ---------------------------------------------------------------------------

type Job = "absent" | "plain" | "needs"
type Enc = "ok" | "job" | "step" | "needs"

interface Dims {
  pushExists: boolean
  pushPaths: boolean
  // pushFileStep: the push net FILE contains the test:guard step - the
  // FILE-level TEST_GUARD_STEP_RE check. The real guard has NO job-level
  // fallback on the push side (the prGuardJob stepPresent fallback is
  // twin-only), so missingStep@push depends on the file, not on the
  // guard-gates job existing.
  pushFileStep: boolean
  pushJob: Job
  twinExists: boolean
  fragile: Job
  fragileStep: boolean
  fuzz: Job
  fuzzStep: boolean
  bench: Job
  benchStep: boolean
  twinEnc: Enc
  ciExists: boolean
  ciEnc: Enc
  pkgSuite: boolean
}

/**
 * resultOf(d) - the scanGuardGates result for the given file-level dims.
 * Invariants mirrored (with the scan-guard-gates.mjs source each one comes
 * from):
 * - missingWorkflow = FIRST missing in guardNet order (push before twin) -
 *   so push missing suppresses the twin's missing-value and vice versa.
 * - pathsFilter only scans when the push net EXISTS (the fs.existsSync
 *   guard around the PATHS_FILTER_RE loop) - hence WORKFLOW MISSING@push
 *   bot PATHS FILTER by construction (rule 1 bot rule 2, precise form).
 * - missingStep = first EXISTING net workflow without the FILE-level step
 *   (the loop skips missing files). On the PUSH side this is purely
 *   file-level: pushFileStep (the guard-gates JOB existing is irrelevant to
 *   missingStep@push - the prGuardJob stepPresent fallback is twin-only, so
 *   a push file with the step in another job, or no guard-gates job at
 *   all, still satisfies missingStep). On the TWIN side the file-level
 *   check + the fragile-guard job-level fallback collapse to the same
 *   condition (in every real shape the step lives inside the fragile-guard
 *   job), so twinStep = fragile present + fragileStep subsumes both.
 * - prGuardJob returns null when the file is missing -> no JOB/NEEDS
 *   signals for a missing workflow (WORKFLOW MISSING@X bot all X-job
 *   signals).
 * - needs/stepPresent are only set INSIDE a present job block -> needs
 *   implies present, stepPresent implies present (rule 4 bot rule 5 and the
 *   fuzz/benchmark MISSING bot {NEEDS, STEP} family).
 * - encodingBad carries exactly ONE kind per rel (workflow/job/step/needs)
 *   - the loop continues after the first kind - so the four encoding
 *   signals are pairwise exclusive per rel, but coexist across rels.
 */
function resultOf(d: Dims) {
  const pushStep = d.pushExists && d.pushFileStep
  const twinStep = d.twinExists && d.fragile !== "absent" && d.fragileStep
  const missingWorkflow = !d.pushExists ? PUSH : !d.twinExists ? TWIN : null
  const pathsFilter = d.pushExists && d.pushPaths ? [{ file: PUSH, line: 1, text: "paths:" }] : []
  let missingStep = null
  if (d.pushExists && !pushStep) missingStep = PUSH
  else if (d.twinExists && !twinStep) missingStep = TWIN
  const missingSuite = d.pkgSuite ? null : "package.json"
  const job = (j: Job, step: boolean) =>
    j === "absent"
      ? { present: false, stepPresent: false, needs: null, jobLine: null }
      : { present: true, stepPresent: step, needs: j === "needs" ? "needs: check" : null, jobLine: 8 }
  const prJob = d.twinExists ? job(d.fragile, d.fragileStep) : null
  const pushNetJob = d.pushExists ? job(d.pushJob, d.pushFileStep) : null
  const fuzzJob = d.twinExists ? job(d.fuzz, d.fuzzStep) : null
  const benchmarkJob = d.twinExists ? job(d.bench, d.benchStep) : null
  const encodingBad: { rel: string; kind: string; needs?: string }[] = []
  const encKind = (exists: boolean, e: Enc, rel: string) => {
    if (!exists) encodingBad.push({ rel, kind: "workflow" })
    else if (e === "job") encodingBad.push({ rel, kind: "job" })
    else if (e === "step") encodingBad.push({ rel, kind: "step" })
    else if (e === "needs") encodingBad.push({ rel, kind: "needs", needs: "needs: lint" })
  }
  encKind(d.ciExists, d.ciEnc, CI)
  encKind(d.twinExists, d.twinEnc, TWIN)
  return { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob, pushNetJob, fuzzJob, encodingBad, benchmarkJob }
}

const JOBS: Job[] = ["absent", "plain", "needs"]
const ENCS: Enc[] = ["ok", "job", "step", "needs"]

/** All structurally-reachable scan results (the model's state space). */
function* reachableResults() {
  const pushSides: { pushExists: boolean; pushPaths: boolean; pushFileStep: boolean; pushJob: Job }[] = [
    { pushExists: false, pushPaths: false, pushFileStep: false, pushJob: "absent" },
  ]
  for (const pushPaths of [true, false])
    for (const pushFileStep of [true, false])
      for (const pushJob of JOBS)
        pushSides.push({ pushExists: true, pushPaths, pushFileStep, pushJob })

  const twinSides: { twinExists: boolean; fragile: Job; fragileStep: boolean; fuzz: Job; fuzzStep: boolean; bench: Job; benchStep: boolean; twinEnc: Enc }[] = [
    { twinExists: false, fragile: "absent", fragileStep: false, fuzz: "absent", fuzzStep: false, bench: "absent", benchStep: false, twinEnc: "ok" },
  ]
  for (const fragile of JOBS)
    for (const fragileStep of [true, false])
      for (const fuzz of JOBS)
        for (const fuzzStep of [true, false])
          for (const bench of JOBS)
            for (const benchStep of [true, false])
              for (const twinEnc of ENCS)
                twinSides.push({ twinExists: true, fragile, fragileStep, fuzz, fuzzStep, bench, benchStep, twinEnc })

  const ciSides: { ciExists: boolean; ciEnc: Enc }[] = [{ ciExists: false, ciEnc: "ok" }]
  for (const ciEnc of ENCS) ciSides.push({ ciExists: true, ciEnc })

  for (const p of pushSides)
    for (const t of twinSides)
      for (const c of ciSides)
        for (const pkgSuite of [true, false])
          yield resultOf({ ...p, ...t, ...c, pkgSuite })
}

// ---------------------------------------------------------------------------
// The DERIVATION: co-occurrence over the reachable space -> the exclusive set
// (pairs that never co-emit). Computed ONCE (lazy) - 112k reachable states.
// ---------------------------------------------------------------------------

let derivedCache: { reachable: Set<string>; exclusive: Set<string> } | null = null

function derive() {
  if (derivedCache) return derivedCache
  const reachable = new Set<string>()
  const coOccur = new Set<string>()
  for (const r of reachableResults()) {
    const ids = emittedSignals(r, CTX).map(sigId)
    for (const id of ids) reachable.add(id)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        coOccur.add(a < b ? `${a}|${b}` : `${b}|${a}`)
      }
    }
  }
  const exclusive = new Set<string>()
  const all = [...reachable].sort()
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      const pair = a < b ? `${a}|${b}` : `${b}|${a}`
      if (!coOccur.has(pair)) exclusive.add(pair)
    }
  }
  derivedCache = { reachable, exclusive }
  return derivedCache
}

// ---------------------------------------------------------------------------
// REAL fixtures for the anchors (small synthetic repos, CRLF-agnostic LF).
// ---------------------------------------------------------------------------

function writeTwin(dir: string, opts: { fragile?: boolean; fuzzNeeds?: boolean; fuzzStep?: boolean; bench?: boolean } = {}) {
  const lines = [
    "name: PR Check",
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "jobs:",
    "  utf8-check:",
    "    uses: ./.github/workflows/utf8-check.yml",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Unit tests",
    "        run: bun run test:unit",
  ]
  if (opts.bench) {
    lines.push("  benchmark:", "    name: Geo Benchmark", "    runs-on: ubuntu-latest", "    steps:", "      - name: Run geo benchmark", "        run: |", "          node scripts/run-benchmark.mjs --type geo --json")
  }
  if (opts.fuzzNeeds || opts.fuzzStep) {
    lines.push("  fuzz:", "    name: Fuzz Tests")
    if (opts.fuzzNeeds) lines.push("    needs: check")
    lines.push("    runs-on: ubuntu-latest", "    steps:")
    if (opts.fuzzStep !== false) lines.push("      - name: Run fuzz tests", "        run: bun run fuzz:ci > fuzz-results.json")
    else lines.push("      - name: Unit tests", "        run: bun run test:unit")
  }
  if (opts.fragile) {
    lines.push("  fragile-guard:", "    name: Fragile Range Guard", "    runs-on: ubuntu-latest", "    steps:", "      - name: Run guard vitest suites", "        run: bun run test:guard")
  }
  lines.push("")
  writeFile(dir, TWIN, lines.join("\n"))
}

function writeCi(dir: string, opts: { enc?: boolean } = {}) {
  const lines = ["name: CI", "on:", "  push:", "    branches: [main, develop]", "jobs:", "  lint:", "    runs-on: ubuntu-latest", "    steps:", "      - run: bun run lint"]
  if (opts.enc) lines.push("  utf8-check:", "    uses: ./.github/workflows/utf8-check.yml")
  lines.push("")
  writeFile(dir, CI, lines.join("\n"))
}

function writePkg(dir: string, suite: boolean) {
  writeFile(
    dir,
    "package.json",
    JSON.stringify({ name: "synthetic", scripts: { "test:guard": suite ? "vitest run scripts/__tests__/scan-push-full-suite.test.ts --config vitest.config.unit.ts" : "vitest run scripts/__tests__/fragile-range-guard.test.ts --config vitest.config.unit.ts" } }, null, 2),
  )
}

describe("scan-guard-gates exclusivity - derivacao do espaco alcancavel (sec 8.14)", () => {
  afterEach(cleanupTempDirs)

  it("sanity: as 24 signals esperadas sao alcancaveis no espaco do modelo (membros - nao exaustivo)", () => {
    const { reachable } = derive()
    const expected = [
      `WORKFLOW MISSING@${PUSH}`,
      `WORKFLOW MISSING@${TWIN}`,
      `PATHS FILTER@${PUSH}`,
      `TEST GUARD STEP MISSING@${PUSH}`,
      `TEST GUARD STEP MISSING@${TWIN}`,
      `FRAGILE GUARD JOB MISSING@${TWIN}`,
      `FRAGILE GUARD NEEDS@${TWIN}`,
      `GUARD GATES JOB MISSING@${PUSH}`,
      `GUARD GATES JOB NEEDS@${PUSH}`,
      `GUARD SUITE MISSING@package.json`,
      `FUZZ JOB MISSING@${TWIN}`,
      `FUZZ JOB NEEDS@${TWIN}`,
      `FUZZ STEP MISSING@${TWIN}`,
      `BENCHMARK JOB MISSING@${TWIN}`,
      `BENCHMARK JOB NEEDS@${TWIN}`,
      `BENCHMARK STEP MISSING@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${CI}`,
      `ENCODING CALL SITE MISSING@${CI}`,
      `ENCODING CALL SITE STEP MISSING@${CI}`,
      `ENCODING CALL SITE NEEDS@${CI}`,
      `ENCODING CALL SITE MISSING@${TWIN}`,
      `ENCODING CALL SITE STEP MISSING@${TWIN}`,
      `ENCODING CALL SITE NEEDS@${TWIN}`,
      // O 24o sinal alcancavel: ENCODING WORKFLOW MISSING@TWIN (twin ausente
      // -> kind 'workflow' no encodingBad + WORKFLOW MISSING@TWIN co-emitem).
      `ENCODING WORKFLOW MISSING@${TWIN}`,
    ]
    for (const id of expected) expect(reachable.has(id), id).toBe(true)
  }, 120000)

  it("VALIDACAO rule 4 bot rule 5 (sec 8.14): FRAGILE GUARD JOB MISSING e FRAGILE GUARD NEEDS NUNCA coexistem (needs implica present - o prGuardJob so seta needs dentro do bloco do job)", () => {
    const { exclusive } = derive()
    expect(exclusive.has(pairOf(`FRAGILE GUARD JOB MISSING@${TWIN}`, `FRAGILE GUARD NEEDS@${TWIN}`))).toBe(true)
  }, 120000)

  it("VALIDACAO rule 1 bot rule 2 (sec 8.14), forma PRECISA por-alvo: WORKFLOW MISSING@guard-gates.yml nunca coexiste com PATHS FILTER (o scan de paths so roda se o push net existe)", () => {
    const { exclusive } = derive()
    expect(exclusive.has(pairOf(`WORKFLOW MISSING@${PUSH}`, `PATHS FILTER@${PUSH}`))).toBe(true)
  }, 120000)

  it("REFINAMENTO derivado: a forma GLOBAL do rule 1 bot rule 2 NAO vale - WORKFLOW MISSING@pr-check.yml COEXISTE com PATHS FILTER (deletar o twin nao remove o scan de paths do push net)", () => {
    const { exclusive } = derive()
    // O par (key,target)-global NUNCA co-emite para o push net, mas o par
    // com o twin ausente co-emite (a prosa da sec 8.14 nao distingue).
    expect(exclusive.has(pairOf(`WORKFLOW MISSING@${PUSH}`, `PATHS FILTER@${PUSH}`))).toBe(true)
    expect(exclusive.has(pairOf(`WORKFLOW MISSING@${TWIN}`, `PATHS FILTER@${PUSH}`))).toBe(false)
    // Prova de coexistencia NO MODELO: um estado com o twin ausente + paths
    // no push net emite os DOIS sinais num unico scan.
    let sawCoexist = false
    for (const r of reachableResults()) {
      const ids = new Set(emittedSignals(r, CTX).map(sigId))
      if (ids.has(`WORKFLOW MISSING@${TWIN}`) && ids.has(`PATHS FILTER@${PUSH}`)) {
        sawCoexist = true
        break
      }
    }
    expect(sawCoexist).toBe(true)
  }, 120000)

  it("DERIVADO: WORKFLOW MISSING@X suprime TODOS os sinais do proprio arquivo (jobs, step, paths) - 12 exclusividades do push net + twin", () => {
    const { exclusive } = derive()
    const pairs = [
      pairOf(`WORKFLOW MISSING@${PUSH}`, `GUARD GATES JOB MISSING@${PUSH}`),
      pairOf(`WORKFLOW MISSING@${PUSH}`, `GUARD GATES JOB NEEDS@${PUSH}`),
      pairOf(`WORKFLOW MISSING@${PUSH}`, `TEST GUARD STEP MISSING@${PUSH}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `FRAGILE GUARD JOB MISSING@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `FRAGILE GUARD NEEDS@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `FUZZ JOB MISSING@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `FUZZ JOB NEEDS@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `FUZZ STEP MISSING@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `BENCHMARK JOB MISSING@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `BENCHMARK JOB NEEDS@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `BENCHMARK STEP MISSING@${TWIN}`),
      pairOf(`WORKFLOW MISSING@${TWIN}`, `TEST GUARD STEP MISSING@${TWIN}`),
    ]
    for (const p of pairs) expect(exclusive.has(p), p).toBe(true)
  }, 120000)

  it("DERIVADO: a familia MISSING bot {NEEDS, STEP} vale para guard-gates/fuzz/benchmark (o mesmo invariante do rule 4 bot rule 5)", () => {
    const { exclusive } = derive()
    const pairs = [
      pairOf(`GUARD GATES JOB MISSING@${PUSH}`, `GUARD GATES JOB NEEDS@${PUSH}`),
      pairOf(`FUZZ JOB MISSING@${TWIN}`, `FUZZ JOB NEEDS@${TWIN}`),
      pairOf(`FUZZ JOB MISSING@${TWIN}`, `FUZZ STEP MISSING@${TWIN}`),
      pairOf(`BENCHMARK JOB MISSING@${TWIN}`, `BENCHMARK JOB NEEDS@${TWIN}`),
      pairOf(`BENCHMARK JOB MISSING@${TWIN}`, `BENCHMARK STEP MISSING@${TWIN}`),
    ]
    for (const p of pairs) expect(exclusive.has(p), p).toBe(true)
  }, 120000)

  it("DERIVADO: FUZZ JOB NEEDS COEXISTE com FUZZ STEP MISSING (a MUTATION COMBINADA do scan-guard-gates.test.ts - o par que a exclusividade MISSING/NEEDS nao cobre)", () => {
    const { exclusive } = derive()
    expect(exclusive.has(pairOf(`FUZZ JOB NEEDS@${TWIN}`, `FUZZ STEP MISSING@${TWIN}`))).toBe(false)
    let sawCoexist = false
    for (const r of reachableResults()) {
      const ids = new Set(emittedSignals(r, CTX).map(sigId))
      if (ids.has(`FUZZ JOB NEEDS@${TWIN}`) && ids.has(`FUZZ STEP MISSING@${TWIN}`)) {
        sawCoexist = true
        break
      }
    }
    expect(sawCoexist).toBe(true)
  }, 120000)

  it("DERIVADO: missingStep e single-valued (TEST GUARD STEP MISSING@push bot TEST GUARD STEP MISSING@twin - o primeiro existente sem o step)", () => {
    const { exclusive } = derive()
    expect(exclusive.has(pairOf(`TEST GUARD STEP MISSING@${PUSH}`, `TEST GUARD STEP MISSING@${TWIN}`))).toBe(true)
  }, 120000)

  it("DERIVADO: as 4 signals de encoding sao pairwise-exclusivas POR-REL (workflow/job/step/needs = um unico kind por rel) mas coexistem ACROSS rels", () => {
    const { exclusive } = derive()
    const enc = ["WORKFLOW MISSING", "CALL SITE MISSING", "CALL SITE STEP MISSING", "CALL SITE NEEDS"]
    for (const rel of [CI, TWIN]) {
      for (let i = 0; i < enc.length; i++) {
        for (let j = i + 1; j < enc.length; j++) {
          const a = `ENCODING ${enc[i]}@${rel}`
          const b = `ENCODING ${enc[j]}@${rel}`
          expect(exclusive.has(pairOf(a, b)), `${a}|${b}`).toBe(true)
        }
      }
    }
    // Across rels: o call site do ci e o do twin coexistem.
    expect(exclusive.has(pairOf(`ENCODING CALL SITE MISSING@${CI}`, `ENCODING CALL SITE MISSING@${TWIN}`))).toBe(false)
  }, 120000)

  it("SNAPSHOT: o conjunto exclusivo completo derivado (pin - qualquer rule change que altere uma exclusividade quebra aqui)", () => {
    const { exclusive } = derive()
    // SNAPSHOT regenerado da derivacao REAL do modelo (2026-08): 45 pares
    // exclusivos. Regra: se o modelo derivar um conjunto diferente, este pin
    // quebra - regenere do modelo, nunca ajuste a mao para casar a doc.
    const snapshot = [
      `BENCHMARK JOB MISSING@${TWIN}|BENCHMARK JOB NEEDS@${TWIN}`,
      `BENCHMARK JOB MISSING@${TWIN}|BENCHMARK STEP MISSING@${TWIN}`,
      `BENCHMARK JOB MISSING@${TWIN}|ENCODING WORKFLOW MISSING@${TWIN}`,
      `BENCHMARK JOB MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `BENCHMARK JOB NEEDS@${TWIN}|ENCODING WORKFLOW MISSING@${TWIN}`,
      `BENCHMARK JOB NEEDS@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `BENCHMARK STEP MISSING@${TWIN}|ENCODING WORKFLOW MISSING@${TWIN}`,
      `BENCHMARK STEP MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `ENCODING CALL SITE MISSING@${CI}|ENCODING CALL SITE NEEDS@${CI}`,
      `ENCODING CALL SITE MISSING@${CI}|ENCODING CALL SITE STEP MISSING@${CI}`,
      `ENCODING CALL SITE MISSING@${CI}|ENCODING WORKFLOW MISSING@${CI}`,
      `ENCODING CALL SITE MISSING@${TWIN}|ENCODING CALL SITE NEEDS@${TWIN}`,
      `ENCODING CALL SITE MISSING@${TWIN}|ENCODING CALL SITE STEP MISSING@${TWIN}`,
      `ENCODING CALL SITE MISSING@${TWIN}|ENCODING WORKFLOW MISSING@${TWIN}`,
      `ENCODING CALL SITE MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `ENCODING CALL SITE NEEDS@${CI}|ENCODING CALL SITE STEP MISSING@${CI}`,
      `ENCODING CALL SITE NEEDS@${CI}|ENCODING WORKFLOW MISSING@${CI}`,
      `ENCODING CALL SITE NEEDS@${TWIN}|ENCODING CALL SITE STEP MISSING@${TWIN}`,
      `ENCODING CALL SITE NEEDS@${TWIN}|ENCODING WORKFLOW MISSING@${TWIN}`,
      `ENCODING CALL SITE NEEDS@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `ENCODING CALL SITE STEP MISSING@${CI}|ENCODING WORKFLOW MISSING@${CI}`,
      `ENCODING CALL SITE STEP MISSING@${TWIN}|ENCODING WORKFLOW MISSING@${TWIN}`,
      `ENCODING CALL SITE STEP MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${TWIN}|FRAGILE GUARD JOB MISSING@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${TWIN}|FRAGILE GUARD NEEDS@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${TWIN}|FUZZ JOB MISSING@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${TWIN}|FUZZ JOB NEEDS@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${TWIN}|FUZZ STEP MISSING@${TWIN}`,
      `ENCODING WORKFLOW MISSING@${TWIN}|TEST GUARD STEP MISSING@${TWIN}`,
      `FRAGILE GUARD JOB MISSING@${TWIN}|FRAGILE GUARD NEEDS@${TWIN}`,
      `FRAGILE GUARD JOB MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `FRAGILE GUARD NEEDS@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `FUZZ JOB MISSING@${TWIN}|FUZZ JOB NEEDS@${TWIN}`,
      `FUZZ JOB MISSING@${TWIN}|FUZZ STEP MISSING@${TWIN}`,
      `FUZZ JOB MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `FUZZ JOB NEEDS@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `FUZZ STEP MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `GUARD GATES JOB MISSING@${PUSH}|GUARD GATES JOB NEEDS@${PUSH}`,
      `GUARD GATES JOB MISSING@${PUSH}|WORKFLOW MISSING@${PUSH}`,
      `GUARD GATES JOB NEEDS@${PUSH}|WORKFLOW MISSING@${PUSH}`,
      `PATHS FILTER@${PUSH}|WORKFLOW MISSING@${PUSH}`,
      `TEST GUARD STEP MISSING@${PUSH}|TEST GUARD STEP MISSING@${TWIN}`,
      `TEST GUARD STEP MISSING@${PUSH}|WORKFLOW MISSING@${PUSH}`,
      `TEST GUARD STEP MISSING@${TWIN}|WORKFLOW MISSING@${TWIN}`,
      `WORKFLOW MISSING@${PUSH}|WORKFLOW MISSING@${TWIN}`,
    ].sort()
    expect([...exclusive].sort()).toEqual(snapshot)
  }, 120000)
})

describe("scan-guard-gates exclusivity - REAL anchors (modelo vs codigo real)", () => {
  afterEach(cleanupTempDirs)

  it("MODEL ANCHOR: um repo sintetico real produz EXATAMENTE o que resultOf preve para os mesmos dims (fuzz needs + step errado -> NEEDS + STEP MISSING juntos)", () => {
    const dir = createTempDir("guard-gates-excl-")
    writeGuardGatesWorkflow(dir, { runsOn: true, extra: "        paths:\n          - 'scripts/**'\n" })
    writeTwin(dir, { fragile: true, fuzzNeeds: true, fuzzStep: false })
    writeCi(dir, { enc: true })
    writePkg(dir, true)
    const real = emittedSignals(scanGuardGates(dir), CTX).map(sigId).sort()
    // resultOf para os mesmos dims do fixture: o twin NAO tem job benchmark
    // (writeTwin sem bench) -> bench absent; o push tem o step no arquivo
    // (file-level) -> pushFileStep true.
    const model = emittedSignals(
      resultOf({ pushExists: true, pushPaths: true, pushFileStep: true, pushJob: "plain", twinExists: true, fragile: "plain", fragileStep: true, fuzz: "needs", fuzzStep: false, bench: "absent", benchStep: false, twinEnc: "ok", ciExists: true, ciEnc: "ok", pkgSuite: true }),
      CTX,
    )
      .map(sigId)
      .sort()
    expect(real).toEqual(model)
    expect(real).toContain(`FUZZ JOB NEEDS@${TWIN}`)
    expect(real).toContain(`FUZZ STEP MISSING@${TWIN}`)
  }, 30000)

  it("REAL ANCHOR rule 4 bot rule 5: job fragile-guard com needs -> so FRAGILE GUARD NEEDS, nunca JOB MISSING (o CLI real)", () => {
    const dir = createTempDir("guard-gates-excl-")
    writeGuardGatesWorkflow(dir, { runsOn: true })
    writeFile(
      dir,
      TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  fragile-guard:",
        "    needs: check",
        "    name: Fragile Range Guard",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run guard vitest suites",
        "        run: bun run test:guard",
        "",
      ].join("\n"),
    )
    writeCi(dir, { enc: true })
    writePkg(dir, true)
    const real = new Set(emittedSignals(scanGuardGates(dir), CTX).map(sigId))
    expect(real.has(`FRAGILE GUARD NEEDS@${TWIN}`)).toBe(true)
    expect(real.has(`FRAGILE GUARD JOB MISSING@${TWIN}`)).toBe(false)
  }, 30000)

  it("REAL ANCHOR rule 1 bot rule 2 (precise): push net DELETADO -> WORKFLOW MISSING@push SEM PATHS FILTER (o scan de paths nao roda em arquivo ausente)", () => {
    const dir = createTempDir("guard-gates-excl-")
    writeTwin(dir, { fragile: true })
    writeCi(dir, { enc: true })
    writePkg(dir, true)
    const real = new Set(emittedSignals(scanGuardGates(dir), CTX).map(sigId))
    expect(real.has(`WORKFLOW MISSING@${PUSH}`)).toBe(true)
    expect(real.has(`PATHS FILTER@${PUSH}`)).toBe(false)
  }, 30000)

  it("REAL ANCHOR coexistencia (refinamento): twin DELETADO + paths no push net -> WORKFLOW MISSING@twin E PATHS FILTER no MESMO scan (a forma global do rule 1 bot 2 nao vale)", () => {
    const dir = createTempDir("guard-gates-excl-")
    writeGuardGatesWorkflow(dir, { runsOn: true, extra: "        paths:\n          - 'scripts/**'\n" })
    writeCi(dir, { enc: true })
    writePkg(dir, true)
    const real = new Set(emittedSignals(scanGuardGates(dir), CTX).map(sigId))
    expect(real.has(`WORKFLOW MISSING@${TWIN}`)).toBe(true)
    expect(real.has(`PATHS FILTER@${PUSH}`)).toBe(true)
  }, 30000)

  it("REAL-REPO CONTRACT: o repo real deriva o conjunto VAZIO (a matriz documentada se sustenta no estado atual - regressao futura falha aqui)", () => {
    const real = emittedSignals(scanGuardGates(process.cwd()), CTX)
    expect(real).toEqual([])
  }, 30000)
})
