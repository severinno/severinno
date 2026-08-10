#!/usr/bin/env node
/**
 * scan-guard-gates.mjs - guard do CONTRATO do push net guard-gates.yml
 * (2026-08): a rede de gates que valida a premissa da secao 8.4.
 *
 * WHY: a decisao da 8.4 (Gate 3 MAPEADO do pre-push, 18s vs 178s ~10x) e o
 * fuzz mapeado (11.11) dependem de o CI rodar a suite completa em checkout
 * fresco como AUTORIDADE. O push net guard-gates.yml e essa rede: um job
 * standalone (sem dependencia de lint) que roda `bun run test:guard` em
 * TODO push a main/develop. Se o workflow ganhar um filtro paths: ou perder
 * o scan-push-full-suite de test:guard, a premissa da recalibracao morre
 * silenciosamente (um push docs-only pularia a rede; um guard removido da
 * suite deixaria a 8.4 orfa). Este guard trava as DUAS regressoes.
 *
 * CONTRATO BIDIRECIONAL (mesmo padrao do scan-push-full-suite), aplicado aos
 * DOIS workflows da rede - o push net (guard-gates.yml) e o twin do lado PR
 * (pr-check.yml, job fragile-guard):
 * 1. WORKFLOW PRESENTE (POSITIVO): o arquivo .github/workflows/guard-gates.yml
 *    DEVE existir - deletar/renomear a rede = push sem net = falha
 *    'WORKFLOW MISSING' (a classe de orfao que este guard existe para fechar;
 *    so o READ do REAL-REPO CONTRACT no teste pegaria, o CLI nao).
 * 2. NO PATHS FILTER (NEGATIVO): o workflow NAO pode ter `paths:` /
 *    `paths-ignore:` em `on.push` - a decisao "NO paths filter BY DESIGN"
 *    documentada no header do proprio workflow (a surface escaneada e
 *    DERIVADA dos TARGET_DIRS; um filtro criaria um drift point novo, a
 *    classe que o SPREAD CONTRACT elimina). Linhas de comentario sao
 *    ignoradas (o header explica o POR QUE em prosa).
 * 3. TEST:GUARD STEP (POSITIVO): AMBOS os workflows DEVEM conter o step
 *    `run: bun run test:guard` - o push net (guard-gates.yml) e o lado PR
 *    (pr-check.yml, job fragile-guard). Remover/trocar o step em qualquer um
 *    = rede sem guard = falha 'TEST GUARD STEP MISSING' com o arquivo.
 * 4. FRAGILE-GUARD JOB (POSITIVO, lado PR): o pr-check.yml DEVE ter o job
 *    `fragile-guard:` no nivel raiz de jobs (2 espacos) - deletar/renomear
 *    o job = o guard vitest para de rodar no PR = falha 'FRAGILE GUARD JOB
 *    MISSING'. A IMMUNITY a skip vem de duas frentes: o reorder do check job
 *    (test:unit antes do lint) e este job standalone sem `needs:`.
 * 5. NO NEEDS: (NEGATIVO, AMBOS os lados da rede): o job fragile-guard
 *    (PR) E o job guard-gates (push net) NAO podem ter `needs:` - um needs
 *    tornaria o job dependente de um job que pode falhar no lint ANTES dos
 *    testes (o skip da classe que o job standalone existe para fechar). No
 *    push net, um needs: e ainda pior: o guard-gates.yml tem UM unico job,
 *    entao um needs: para um job inexistente INVALIDA o workflow inteiro no
 *    GitHub (o BASELINE nem chega a rodar - orfao total). = falha
 *    'FRAGILE GUARD NEEDS' (PR) / 'GUARD GATES JOB NEEDS' (push net).
 *    PROVA 19 (2026-08-10): o par fechado nos DOIS lados - a Prova 16
 *    provou o lado PR via CI real (needs: check no fragile-guard); esta
 *    prova injeta needs: check no job guard-gates do guard-gates.yml e
 *    dispara via push real a develop, fechando o irmao do push net.
 * 6. SCAN-PUSH-FULL-SUITE EM test:guard (POSITIVO): o script `test:guard`
 *    do package.json DEVE incluir `scan-push-full-suite.test.ts` (o
 *    REAL-REPO CONTRACT que trava a 8.4) - remover a suite da lista = a
 *    rede deixa de rodar o guard = falha 'GUARD SUITE MISSING'.
 * 7. FUZZ JOB STANDALONE (POSITIVO + NEGATIVO, lado PR): o pr-check.yml
 *    DEVE ter o job `fuzz:` no nivel raiz de jobs (2 espacos), SEM `needs:`
 *    e com o step `run: bun run fuzz:ci` - a autoridade fuzz:ci batchado
 *    (11.11/11.12) roda em QUALQUER PR independente do job check. AVALIADO
 *    2026-08 (o job check falha por divida de lint pre-existente): um job
 *    CI-only dedicado para o fuzz:ci (ex.: dentro do guard-gates.yml) foi
 *    RECUSADO - adicionaria ~26s de fuzz:ci batchado em TODO push a
 *    main/develop (o custo do fuzz completo) sem ganho estrutural, pois o
 *    job fuzz do pr-check JA e standalone (roda em paralelo ao check,
 *    sem needs:) e uma prova de CI so precisa ler o resultado do job fuzz,
 *    nao do workflow inteiro. O contrato abaixo custa ZERO CI e garante a
 *    mesma imunidade: deletar o job, dar um needs: check, ou trocar o step
 *    fuzz:ci por outro = falha 'FUZZ JOB MISSING' / 'FUZZ JOB NEEDS' /
 *    'FUZZ STEP MISSING' com o caminho exato. O job key deriva do
 *    workflow-contracts manifest (FUZZ_JOB) - uma renomeacao de job deve
 *    atualizar o manifest, nao este guard.
 * 8. ENCODING CALL SITES STANDALONE (POSITIVO + NEGATIVO, caminho de
 *    merge): os workflows do ENCODING_NET (ci.yml + pr-check.yml - os DOIS
 *    call sites do gate de encoding utf8-check.yml no caminho de merge,
 *    derivados do workflow-contracts manifest) DEVEM ter o call site `job
 *    key: uses: ./.github/workflows/utf8-check.yml` SEM `needs:` - a mesma
 *    imunidade standalone do fragile-guard aplicada ao gate de encoding.
 *    AUDITORIA 2026-08 (ci.yml + quality-gate.yml): ambos os call sites
 *    hoje estao SEM needs (imunes), mas NADA pina essa imunidade - um
 *    `needs: lint` futuro criaria silenciosamente o skip vector (lint
 *    falhando = gate de encoding nunca roda = corrupcao de encoding passa
 *    no merge). O contrato fecha a classe: deletar o call site ou dar um
 *    needs: = falha 'ENCODING CALL SITE MISSING' / 'ENCODING CALL SITE
 *    NEEDS' com o caminho exato. AVALIADO: o budget job do ci.yml tem
 *    needs: [lint, ...] MAS roda um BUILD pesado (o gate de JS e um step
 *    dentro do job) - INTENCIONAL (build de 30min so vale com lint verde;
 *    nao e um call site de gate standalone) e fora da surface da regra 8;
 *    o quality-gate.yml e workflow_call-only com jobs internos paralelos
 *    SEM needs (limpo por design, header dele).
 * 9. BENCHMARK JOB STANDALONE (POSITIVO + NEGATIVO, lado PR): o pr-check.yml
 *    DEVE ter o job `benchmark:` no nivel raiz de jobs (2 espacos), SEM
 *    `needs:` e com o step `node scripts/run-benchmark.mjs` - a rede de
 *    gates do PR travada de forma UNIFORME. AUDITORIA 2026-08 dos jobs do
 *    pr-check: fuzz (regra 7), fragile-guard (regras 4/5) e utf8-check
 *    (regra 8) ja eram contratados; o `benchmark:` era o unico gate
 *    bloqueante do merge path (falha o PR em regressao geo >threshold)
 *    imune hoje (sem needs) mas SEM pin - renomear/deletar o job ou dar um
 *    needs: passaria em silencio (o benchmark simplesmente pararia de
 *    rodar). O contrato fecha a classe: deletar o job, dar um needs:, ou
 *    trocar o step run-benchmark = falha 'BENCHMARK JOB MISSING' /
 *    'BENCHMARK JOB NEEDS' / 'BENCHMARK STEP MISSING' com o caminho exato.
 *    AVALIADO como FORA da surface (nao contratados): docs-encoding e
 *    INFORMACIONAL (continue-on-error + exit 0 - um skip e inofensivo),
 *    security-headers faz curl numa URL de PRODUCAO (nao e gate de repo) e
 *    check e o job principal (a perda dele e visivel como required check
 *    ausente no PR, nao silenciosa). O job key deriva do workflow-contracts
 *    manifest (BENCHMARK_JOB) - uma renomeacao de job deve atualizar o
 *    manifest, nao este guard.
 *
 * Env override GUARD_GATES_SCAN_ROOT (repo sintetico p/ o vitest - espelha
 * o PUSH_SUITE_SCAN_ROOT do scan-push-full-suite). Saida ASCII pura (gate
 * file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { BENCHMARK_JOB, ENCODING_JOB, ENCODING_NET, FUZZ_JOB, GUARD_NET, GUARD_NET_JOB, GUARD_NET_PUSH_JOB } from "./workflow-contracts.mjs"

const ROOT = path.resolve(process.env.GUARD_GATES_SCAN_ROOT || process.cwd())
// POSIX rel paths (the repo convention for reported paths - the same as the
// FILES array of scan-push-full-suite): path.join would emit backslashes on
// Windows in the CLI output, breaking the pinned file:line asserts.
// The workflow NAMES + the PR job key are derived from the workflow-contracts
// manifest (the single source of truth for which workflows carry the guard-net
// contract) - a workflow renamed/added to the net must update the manifest,
// not this guard. The WORKFLOW_CONTRACTS_MODULE env override (the
// FRAGILE_MODULE / ENCODING_SURFACE_MODULE pattern) lets tests point the
// guard at a temp manifest copy; the DEFAULT contract below is what the
// CLI and the unit tests use.
const PKG = "package.json"

/** The test:guard script MUST keep the 8.4 contract suite (the 8.4/11.11 premise). */
const REQUIRED_GUARD_SUITE_RE = /scan-push-full-suite\.test\.ts/

/**
 * The guard-net step MUST invoke test:guard. Line-anchored on the `run:`
 * key so a prose mention of test:guard in a COMMENT (the pr-check.yml header
 * explains the mirror in prose) or in a step NAME cannot false-positive -
 * only an actual execution step matches. The `m` flag makes ^/$ match at
 * LINE boundaries (the whole workflow text is scanned, not split per line).
 */
const TEST_GUARD_STEP_RE = /^\s+run:\s+bun run test:guard\s*$/m

/**
 * The fuzz job's step MUST invoke the batched fuzz:ci authority. NOT
 * line-anchored at the end: the real step is `bun run fuzz:ci >
 * fuzz-results.json` (output redirected for the artifact), so the regex
 * matches the command prefix + word boundary. A comment mentioning
 * fuzz:ci in prose is excluded by the `run:` key anchor (same as
 * TEST_GUARD_STEP_RE).
 */
const FUZZ_STEP_RE = /^\s+run:\s+bun run fuzz:ci\b/m

/** The pr-check.yml job key at the root of jobs (2-space indent). */
const JOB_KEY_RE = /^  [A-Za-z0-9_-]+:$/

/**
 * The encoding-gate call site step: `uses: ./.github/workflows/utf8-check.yml`.
 * Line-anchored on the `uses:` key (a prose mention of utf8-check.yml in a
 * COMMENT - e.g. the ci.yml header retelling the pipeline - cannot match).
 * Used as the stepRe for prGuardJob over the ENCODING_NET workflows.
 */
const ENCODING_STEP_RE = /^\s+uses:\s+\.\/\.github\/workflows\/utf8-check\.yml\s*$/

/**
 * The benchmark job's step: `node scripts/run-benchmark.mjs`. The optional
 * `run:` prefix tolerates BOTH step shapes - the real multi-line `run: |`
 * block (command on its own line) AND a future inline `run: node ...`
 * refactor (a single-line form must not false-positive as a missing step
 * when the benchmark still runs). The `--type geo --json` suffix is
 * ignored (the authority is the benchmark RUN, not its flags). A COMMENT
 * line can never match (a comment starts with `#`, never `node`).
 */
const BENCHMARK_STEP_RE = /^\s+(?:run:\s+)?node scripts\/run-benchmark\.mjs\b/

/** A `needs:` key (job-level dependency - a skip vector for the guard job). */
const NEEDS_RE = /^\s*needs:/

/** A paths/paths-ignore filter under on.push (the no-filter BY DESIGN decision). */
const PATHS_FILTER_RE = /^\s*paths(?:-ignore)?:\s*/

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * The PR-side JOB state inside the pr-check.yml twin. Returns null when the
 * workflow file is absent; otherwise { present, stepPresent, needs } where
 * present is false when no job with the given key exists, stepPresent is
 * false when the job block carries no step matching stepRe, and needs is
 * the `needs:` value text (trimmed) when the job declares one. Used for
 * BOTH the guard job (GUARD_NET_JOB + TEST_GUARD_STEP_RE) and the fuzz job
 * (FUZZ_JOB + FUZZ_STEP_RE) - the SAME standalone-immunity contract: the
 * fuzz:ci authority must run in any PR regardless of the check job. The
 * default stepRe keeps the guard-job call site unchanged. Exported for
 * unit tests.
 */
export function prGuardJob(root, prWorkflow, job, stepRe = TEST_GUARD_STEP_RE) {
  const abs = path.join(root, prWorkflow)
  if (!fs.existsSync(abs)) return null
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
  let inJob = false
  let jobLine = null
  let stepPresent = false
  let needs = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inJob) {
      if (NEEDS_RE.test(line)) {
        needs = line.trim()
        continue
      }
      if (stepRe.test(line)) {
        stepPresent = true
        continue
      }
      // A root-level JOB KEY (2-space indent, `name:` shape) ends the block.
      // A job property like `name:`/`runs-on:` (4-space indent) must NOT end
      // it, or a `needs:` right after the job key (before the properties)
      // would be missed. Falls through WITHOUT continue so the same line is
      // re-checked by the key branch below (re-entry: a second fragile-guard
      // block right after the first must start on the SAME line).
      if (!JOB_KEY_RE.test(line)) continue
      inJob = false
    }
    if (line === `  ${job}:`) {
      inJob = true
      jobLine = i + 1
    }
  }
  return { present: jobLine !== null, jobLine, stepPresent, needs }
}

/**
 * The guard-net contract facts (workflow pair + PR job key). Defaults to the
 * workflow-contracts manifest exports; tests pass an override (patched
 * manifest) to prove the guard derives from the manifest.
 */
function defaultContract() {
  return {
    guardNet: GUARD_NET,
    prJobKey: GUARD_NET_JOB,
    pushNetJobKey: GUARD_NET_PUSH_JOB,
    encodingNet: ENCODING_NET,
    encodingJob: ENCODING_JOB,
    benchmarkJob: BENCHMARK_JOB,
  }
}

/**
 * Scan the guard-net contract across ALL workflows of the net. Returns
 * { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob, fuzzJob }
 * where missingWorkflow is the FIRST net workflow rel-path absent (null when
 * all present), pathsFilter is [{ file, line, text }] of paths: filters in
 * guard-gates.yml, missingStep is the rel-path of the FIRST workflow missing
 * the test:guard step (null when all present), missingSuite is the pkg
 * rel-path when the 8.4 guard suite is missing from test:guard (null when
 * present), prJob is the prGuardJob() result of the PR twin (guard job) and
 * fuzzJob is the prGuardJob() result for the fuzz:ci authority job. All
 * clean = clean. Exported for unit tests.
 */
export function scanGuardGates(root = ROOT, contract = defaultContract()) {
  const { guardNet, prJobKey, pushNetJobKey, encodingNet, encodingJob, benchmarkJob } = contract
  const prWorkflow = guardNet[guardNet.length - 1] // the PR-side twin (last)

  // Every net workflow must EXIST (a manifest entry without a real file is
  // a broken net - the growth direction: adding a workflow to GUARD_NET
  // without creating the file fails here).
  let missingWorkflow = null
  for (const rel of guardNet) {
    if (!fs.existsSync(path.join(root, rel))) {
      missingWorkflow = rel
      break
    }
  }

  const pushNet = guardNet[0] // the push net (guard-gates.yml)
  const pathsFilter = []
  if (fs.existsSync(path.join(root, pushNet))) {
    const lines = fs.readFileSync(path.join(root, pushNet), "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isComment(line)) return
      if (PATHS_FILTER_RE.test(line)) {
        pathsFilter.push({ file: pushNet, line: i + 1, text: line.trim() })
      }
    })
  }

  let missingStep = null
  for (const rel of guardNet) {
    const abs = path.join(root, rel)
    if (fs.existsSync(abs) && !TEST_GUARD_STEP_RE.test(fs.readFileSync(abs, "utf8"))) {
      missingStep = rel
      break
    }
  }
  const prJob = prGuardJob(root, prWorkflow, prJobKey)
  const pushNetJob = prGuardJob(root, guardNet[0], pushNetJobKey)
  const fuzzJob = prGuardJob(root, prWorkflow, FUZZ_JOB, FUZZ_STEP_RE)
  const benchmarkJobInfo = prGuardJob(root, prWorkflow, benchmarkJob, BENCHMARK_STEP_RE)
  if (missingStep === null && prJob && !prJob.stepPresent) {
    missingStep = prWorkflow
  }

  let missingSuite = null
  const pkgAbs = path.join(root, PKG)
  if (fs.existsSync(pkgAbs)) {
    let pkg
    try {
      pkg = JSON.parse(fs.readFileSync(pkgAbs, "utf8"))
    } catch {
      pkg = {}
    }
    const tg = pkg.scripts && pkg.scripts["test:guard"]
    if (typeof tg !== "string" || !REQUIRED_GUARD_SUITE_RE.test(tg)) {
      missingSuite = PKG
    }
  }

  // Rule 8 - the ENCODING call sites (merge path) must exist WITHOUT needs:
  // the same standalone-immunity contract as the guard/fuzz jobs, applied to
  // the encoding-gate callers. encodingBad = [{ rel, kind, needs }] where
  // kind is 'workflow' (file absent - the caller vanished), 'job' (no call
  // site job), 'step' (call site without the uses: line) or 'needs' (the
  // call site carries a needs: - the lint skip vector).
  const encodingBad = []
  for (const rel of encodingNet) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) {
      encodingBad.push({ rel, kind: "workflow" })
      continue
    }
    const site = prGuardJob(root, rel, encodingJob, ENCODING_STEP_RE)
    if (!site.present) {
      encodingBad.push({ rel, kind: "job" })
      continue
    }
    if (!site.stepPresent) {
      encodingBad.push({ rel, kind: "step" })
      continue
    }
    if (site.needs !== null) {
      encodingBad.push({ rel, kind: "needs", needs: site.needs })
    }
  }

  return { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob, pushNetJob, fuzzJob, encodingBad, benchmarkJob: benchmarkJobInfo }
}

export async function main() {
  // WORKFLOW_CONTRACTS_MODULE override (the FRAGILE_MODULE pattern): point
  // the guard at a temp manifest copy to prove derivation. Default: the
  // static workflow-contracts import.
  // pathToFileURL: on Windows a bare `import("C:\\...")` rejects with
  // ERR_UNSUPPORTED_ESM_URL_SCHEME (the ESM loader only accepts file://
  // URLs for absolute paths) - the same fix fragile-range-patterns.mjs
  // applies to its entry-point guard. The temp manifest copies the GROWTH
  // test writes live under os.tmpdir(), so this must resolve on Windows.
  const mod = process.env.WORKFLOW_CONTRACTS_MODULE
    ? await import(pathToFileURL(path.resolve(process.env.WORKFLOW_CONTRACTS_MODULE)).href)
    : null
  const contract = mod
    ? {
        guardNet: mod.GUARD_NET,
        prJobKey: mod.GUARD_NET_JOB,
        pushNetJobKey: mod.GUARD_NET_PUSH_JOB,
        encodingNet: mod.ENCODING_NET,
        encodingJob: mod.ENCODING_JOB,
        benchmarkJob: mod.BENCHMARK_JOB,
      }
    : defaultContract()
  const prWorkflow = contract.guardNet[contract.guardNet.length - 1]
  const pushNet = contract.guardNet[0]
  const { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob, pushNetJob, fuzzJob, encodingBad, benchmarkJob } = scanGuardGates(ROOT, contract)
  const prBad = prJob !== null && (!prJob.present || prJob.needs !== null)
  const pushNetBad = pushNetJob !== null && (!pushNetJob.present || pushNetJob.needs !== null)
  // The fuzz:ci authority must be a standalone PR job (the check job may
  // fail on pre-existing lint debt - the fuzz result must stay readable).
  const fuzzBad = fuzzJob !== null && (!fuzzJob.present || fuzzJob.needs !== null || !fuzzJob.stepPresent)
  const benchmarkBad = benchmarkJob !== null && (!benchmarkJob.present || benchmarkJob.needs !== null || !benchmarkJob.stepPresent)
  if (
    missingWorkflow === null &&
    pathsFilter.length === 0 &&
    missingStep === null &&
    missingSuite === null &&
    !prBad &&
    !pushNetBad &&
    !fuzzBad &&
    !benchmarkBad &&
    encodingBad.length === 0
  ) {
    console.log(
      "guard-gates: clean (workflow present, no paths filter, test:guard step in BOTH workflows, fragile-guard job present without needs:, guard-gates job present without needs:, scan-push-full-suite in test:guard, fuzz job standalone com fuzz:ci, benchmark job standalone, encoding call sites sem needs: - sec 8.4/11.11 premise locked)",
    )
    return 0
  }
  if (missingWorkflow !== null) {
    console.log(
      `guard-gates: WORKFLOW MISSING - ${missingWorkflow} nao existe (a guard net, sec 8.4/11.11)`,
    )
  }
  for (const o of pathsFilter) {
    console.log(`guard-gates: PATHS FILTER in ${o.file}:${o.line}: ${o.text}`)
  }
  if (missingStep !== null) {
    console.log(
      `guard-gates: TEST GUARD STEP MISSING in ${missingStep} (run: bun run test:guard required - the guard net, sec 8.4/11.11)`,
    )
  }
  if (prJob !== null && !prJob.present) {
    console.log(
      `guard-gates: FRAGILE GUARD JOB MISSING in ${prWorkflow}:${prJob.jobLine ?? "?"} (job ${contract.prJobKey}: required - o twin PR do push net, sec 8.4/11.11)`,
    )
  }
  if (prJob !== null && prJob.needs !== null) {
    console.log(
      `guard-gates: FRAGILE GUARD NEEDS in ${prWorkflow} (${prJob.needs} - o job standalone nao pode depender de outro; um needs: cria o skip vector da classe que o job existe para fechar)`,
    )
  }
  if (pushNetJob !== null && !pushNetJob.present) {
    console.log(
      `guard-gates: GUARD GATES JOB MISSING in ${pushNet} (job ${contract.pushNetJobKey}: required - o job standalone do push net, sec 8.4/11.11)`,
    )
  }
  if (pushNetJob !== null && pushNetJob.needs !== null) {
    console.log(
      `guard-gates: GUARD GATES JOB NEEDS in ${pushNet} (${pushNetJob.needs} - o job standalone do push net nao pode depender de outro; um needs: para um job inexistente INVALIDA o workflow (guard-gates.yml tem UM job) e o BASELINE nem roda - Prova 19 fecha o par nos dois lados da rede)`,
    )
  }
  if (missingSuite !== null) {
    console.log(
      "guard-gates: GUARD SUITE MISSING in package.json test:guard (scan-push-full-suite.test.ts required - the 8.4 REAL-REPO CONTRACT lock)",
    )
  }
  if (fuzzJob !== null && !fuzzJob.present) {
    console.log(
      `guard-gates: FUZZ JOB MISSING in ${prWorkflow} (job ${FUZZ_JOB}: required - a autoridade fuzz:ci batchado, sec 11.11/11.12, standalone em qualquer PR)`,
    )
  }
  if (fuzzJob !== null && fuzzJob.needs !== null) {
    console.log(
      `guard-gates: FUZZ JOB NEEDS in ${prWorkflow} (${fuzzJob.needs} - o job fuzz standalone nao pode depender de outro; um needs: tornaria o resultado do fuzz dependente do job check)`,
    )
  }
  if (fuzzJob !== null && fuzzJob.present && !fuzzJob.stepPresent) {
    console.log(
      `guard-gates: FUZZ STEP MISSING in ${prWorkflow} (run: bun run fuzz:ci required - a autoridade fuzz:ci batchado, sec 11.11/11.12)`,
    )
  }
  if (benchmarkJob !== null && !benchmarkJob.present) {
    console.log(
      `guard-gates: BENCHMARK JOB MISSING in ${prWorkflow} (job ${contract.benchmarkJob}: required - o gate geo do merge path, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
    )
  }
  if (benchmarkJob !== null && benchmarkJob.needs !== null) {
    console.log(
      `guard-gates: BENCHMARK JOB NEEDS in ${prWorkflow} (${benchmarkJob.needs} - o job benchmark standalone nao pode depender de outro; um needs: tornaria o gate geo skippable por lint)`,
    )
  }
  if (benchmarkJob !== null && benchmarkJob.present && !benchmarkJob.stepPresent) {
    console.log(
      `guard-gates: BENCHMARK STEP MISSING in ${prWorkflow} (node scripts/run-benchmark.mjs required - o gate geo do merge path, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
    )
  }
  for (const e of encodingBad) {
    if (e.kind === "workflow") {
      console.log(
        `guard-gates: ENCODING WORKFLOW MISSING - ${e.rel} nao existe (o call site do gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (e.kind === "job") {
      console.log(
        `guard-gates: ENCODING CALL SITE MISSING in ${e.rel} (job ${contract.encodingJob}: com uses: ./.github/workflows/utf8-check.yml required - o gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (e.kind === "step") {
      console.log(
        `guard-gates: ENCODING CALL SITE STEP MISSING in ${e.rel} (uses: ./.github/workflows/utf8-check.yml required - o call site do gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else {
      console.log(
        `guard-gates: ENCODING CALL SITE NEEDS in ${e.rel} (${e.needs} - o call site do gate de encoding nao pode depender de outro job; um needs: criaria o skip vector do lint sobre o gate de encoding)`,
      )
    }
  }
  console.log(
    "guard-gates: guard-gates.yml + pr-check.yml (fragile-guard + fuzz + benchmark) + ci.yml/pr-check.yml (utf8-check) must run incondicionalmente (no paths filter, no needs: em NENHUM job standalone - fragile-guard, guard-gates, fuzz, benchmark, utf8-check) com o test:guard completo (scan-push-full-suite incluso) - a premissa da recalibracao 8.4/11.11",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanGuardGates without side effects). main() is
// async (the WORKFLOW_CONTRACTS_MODULE override is a dynamic import), so the
// exit code is set from the resolved value - never from the Promise itself.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code
  })
}
