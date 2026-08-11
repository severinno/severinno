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
 * 10. SCANNER STEPS (POSITIVO, AMBOS os lados da rede): os 3 gate scanners
 *     versionados (scan-timeouts.mjs --ci, scan-curl-timeouts.mjs --ci e
 *     scan-eol-anchor.mjs --ci) DEVEM rodar como steps em AMBOS os
 *     workflows do net - o push net (guard-gates.yml) e o twin PR
 *     (pr-check.yml, job fragile-guard). AVALIADO 2026-08 (sec 11.32): o
 *     scan-guard-gates pinava os jobs/steps de gate mas NAO os steps dos
 *     scanners --ci - remover o scan-curl-timeouts do workflow mudaria o
 *     push net sem este guard travar (a mesma classe de orfao das regras
 *     1-9). Os 3 steps vivem nos MESMOS 2 workflows, entao a regra exige
 *     os 3 (fechar so 2 de 3 deixaria um furo visivel). A checagem e
 *     SINGLE-VALUED por step-key em net order (o PRIMEIRO workflow
 *     existente sem o step - o mirror exato do missingStep da regra 3):
 *     remover um step = falha 'SCAN TIMEOUTS STEP MISSING' /
 *     'CURL TIMEOUTS STEP MISSING' / 'EOL ANCHOR STEP MISSING' com o
 *     arquivo exato. O ancoramento no `run:` key (o mesmo do
 *     TEST_GUARD_STEP_RE) exclui comentarios em prosa.
 * 11. DANGLING NEEDS (POSITIVO + NEGATIVO, o grafo needs: do repo): em
 *     TODOS os workflows de .github/workflows/ (repo-wide, sec 11.33 - a
 *     superficie era guardNet + encodingNet; estendida 2026-08-11: a
 *     classe do orfao silencioso e workflow-agnostica, medida 0 dangling
 *     em 18 workflows com 5 needs: reais - 4 fora do net), TODA referencia `needs:` de
 *     um job DEVE resolver para um job key que existe no MESMO workflow -
 *     um needs: pendurado (job removido/renomeado) INVALIDA o workflow no
 *     parse do GitHub (0 jobs, nada roda) - a classe observada AO VIVO na
 *     Prova 24/sec 8.19: a agregacao deletou o job utf8-check do ci.yml
 *     mas build/budget ainda o citavam em needs: e o CI/CD foi rejeitado
 *     com 0 jobs ANTES de qualquer guard rodar. O scan cobre as 3 formas
 *     do YAML (inline `needs: [a, b]` - a forma do ci.yml hoje - single
 *     `needs: a` e o bloco `needs:` + `- a`), pula comentarios, e e
 *     MULTI-VALUED (cada ref pendurada reporta com job + ref + linha, o
 *     padrao da Prova 22): = falha 'DANGLING NEEDS' com o caminho exato.
 *     O CO-EMIT com a regra 8 e a MESMA Prova 24: deletar o call site de
 *     encoding dispara ENCODING CALL SITE MISSING E DANGLING NEEDS juntos
 *     (o par que a suite de exclusividade prova coexistir).
 *
 * Env override GUARD_GATES_SCAN_ROOT (repo sintetico p/ o vitest - espelha
 * o PUSH_SUITE_SCAN_ROOT do scan-push-full-suite). Saida ASCII pura (gate
 * file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
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

/**
 * The 3 versioned scanner steps (rule 10, sec 11.32) - the standalone CLI
 * gate scanners that must run in BOTH net workflows (guard-gates.yml + the
 * pr-check.yml fragile-guard job). Line-anchored on the `run:` key + the
 * `--ci` flag (the same anchor as TEST_GUARD_STEP_RE, so a prose mention in
 * a COMMENT cannot false-positive): the step MUST invoke the scanner with
 * --ci on a single logical line. key = the emitted signal.
 */
const SCANNER_STEPS = [
  { key: "SCAN TIMEOUTS STEP MISSING", re: /^\s+run:\s+node scripts\/scan-timeouts\.mjs\s+--ci\s*$/m },
  { key: "CURL TIMEOUTS STEP MISSING", re: /^\s+run:\s+node scripts\/scan-curl-timeouts\.mjs\s+--ci\s*$/m },
  { key: "EOL ANCHOR STEP MISSING", re: /^\s+run:\s+node scripts\/scan-eol-anchor\.mjs\s+--ci\s*$/m },
]

/**
 * Rule 11 (sec 11.33) - the DANGLING-NEEDS check over ONE workflow's needs
 * graph: every `needs:` reference (from any job) must resolve to a job key
 * declared in the SAME workflow. A needs: to a job that does not exist makes
 * GitHub INVALIDATE the workflow at parse (0 jobs, nothing runs) - the class
 * Prova 24 observed live: the aggregation deleted the utf8-check job from
 * ci.yml but build/budget still cited it in needs:, and the CI/CD workflow
 * was rejected with 0 jobs BEFORE any guard ran. Forms covered: inline list
 * (`needs: [a, b]` - the form ci.yml uses today), single ref (`needs: a`)
 * and the YAML block form (`needs:` + `      - a` items). Comment lines are
 * skipped (a prose mention of needs: cannot false-positive). Returns
 * [{ job, ref, line }] for EVERY dangling ref - multi-valued, the Prova 22
 * pattern (the CLI lists all violations, never short-circuits). Exported
 * for unit tests.
 */
export function danglingNeedsIn(text) {
  const lines = text.split(/\r?\n/)
  const jobKeys = new Set()
  const dangling = []
  let inJobs = false
  let currentJob = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isComment(line)) continue
    // The `jobs:` root key (0-indent) opens the jobs section - everything
    // before it (on:, env:, concurrency:, etc.) is not a job block, so a
    // `push:` key under on: can never be mistaken for a job key.
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true
      continue
    }
    // A root-level job key (2-space indent, `name:` shape) collects the key
    // AND becomes the current job for subsequent needs: lines.
    const key = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (key) {
      jobKeys.add(key[1])
      currentJob = key[1]
      continue
    }
    if (currentJob === null) continue
    const needs = line.match(/^    needs:\s*(.*)$/)
    if (!needs) continue
    const inline = needs[1].trim().replace(/\s*#.*$/, "")
    if (inline) {
      // Inline list `needs: [a, b]` or single ref `needs: a`.
      const refs = inline.startsWith("[")
        ? inline.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean)
        : [inline]
      for (const ref of refs) {
        if (ref && !jobKeys.has(ref)) dangling.push({ job: currentJob, ref, line: i + 1 })
      }
    } else {
      // YAML block form: `needs:` followed by 6-space `- a` items.
      let j = i + 1
      while (j < lines.length) {
        const item = lines[j].match(/^      - (\S+)\s*$/)
        if (!item) break
        const ref = item[1]
        if (!jobKeys.has(ref)) dangling.push({ job: currentJob, ref, line: j + 1 })
        j++
      }
    }
  }
  return dangling
}

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

  // Rule 10 - the scanner steps (sec 11.32): each of the 3 versioned gate
  // scanners (scan-timeouts / scan-curl-timeouts / scan-eol-anchor with
  // --ci) must run in BOTH net workflows. Single-valued PER STEP-KEY in
  // guardNet order (the FIRST existing workflow missing the step - the
  // exact mirror of missingStep above): a push net without the curl step
  // reports CURL TIMEOUTS STEP MISSING@guard-gates.yml, never a twin
  // signal, and the OTHER two step-keys stay silent (they exist).
  const missingScanSteps = []
  for (const step of SCANNER_STEPS) {
    for (const rel of guardNet) {
      const abs = path.join(root, rel)
      if (fs.existsSync(abs) && !step.re.test(fs.readFileSync(abs, "utf8"))) {
        missingScanSteps.push({ key: step.key, file: rel })
        break
      }
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

  // Rule 11 (sec 11.33) - the DANGLING-NEEDS graph over EVERY workflow in
  // .github/workflows/ (repo-wide, not just the net - the silent-orphan
  // class is workflow-agnostic: a needs: to a removed/renamed job
  // invalidates THAT workflow at GitHub parse with 0 jobs, nothing runs;
  // Prova 24 observed it live on ci.yml, but a dangling needs in deploy.yml
  // or release-deploy.yml would kill a deploy the same way). Surface
  // measured 2026-08-11: 18 workflows, 5 carry REAL needs: (4 outside the
  // net: benchmark-auto-baseline, deploy, e2e-cache, release-deploy -
  // guard-gates.yml and health-check.yml only mention needs: in comments),
  // 0 dangling today - the extension is a forward lock on the whole repo.
  // Derived by listing the dir (self-maintaining: a NEW workflow is
  // auto-covered, no manifest edit). Both .yml and .yaml are covered (the
  // count-pin filters the same way). Multi-valued: every dangling ref
  // reports with file + job + ref + line (the Prova 22 pattern - the CLI
  // lists all violations).
  // NAO-JS-YAML (sec 11.39, MEDIDO): a fronteira das 3 formas basta - o
  // parser regex cobre as formas reais do GitHub Actions (inline list,
  // single ref, YAML block); js-yaml NAO reduz a superficie (paridade
  // medida 2026-08-11: 0 vs 0 dangling, 0 divergencias nos 18 workflows;
  // as formas exoticas - anchors/aliases, merge keys, flow multi-linha -
  // tem 0 usos reais e o unico anchor do repo (e2e-cache.yml) vive em
  // on.pull_request.paths, FORA de jobs: onde este parser escopa) e o
  // custo nao vale: js-yaml NAO e dep declarada (so transitiva via
  // @mdxeditor/editor, uma dep de UI) e o boot e identico (~0.12s ambos,
  // dominado pelo node). Fronteira nomeada: forms exoticas sobre-flagam
  // (needs: *deps -> DANGLING NEEDS, direcao segura - falha alto, nunca
  // passa silencioso).
  const wfDir = path.join(root, ".github", "workflows")
  const allWorkflows = fs.existsSync(wfDir)
    ? fs.readdirSync(wfDir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .map((f) => path.posix.join(".github/workflows", f))
    : []
  const danglingNeeds = []
  for (const rel of allWorkflows) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    for (const d of danglingNeedsIn(fs.readFileSync(abs, "utf8"))) {
      danglingNeeds.push({ file: rel, job: d.job, ref: d.ref, line: d.line })
    }
  }

  return { missingWorkflow, pathsFilter, missingStep, missingScanSteps, missingSuite, prJob, pushNetJob, fuzzJob, encodingBad, benchmarkJob: benchmarkJobInfo, danglingNeeds }
}

/**
 * The ORDERED list of signals a scan result emits - the SINGLE SOURCE OF
 * TRUTH for what the guard reports (main() prints from this list; the
 * exclusivity contract suite scripts/__tests__/guard-gates-exclusivity.test.ts
 * derives the rule matrix from THIS function + a reachable-result generator,
 * sec 8.14 - the test must NEVER re-implement these conditions, or the
 * derived exclusivity matrix would drift from the CLI). Each entry carries
 * { key, target, ...extra } where target is the workflow rel / package.json
 * the signal points at. Exported for the contract suite.
 */
export function emittedSignals(f, ctx) {
  const { prWorkflow, pushNet } = ctx
  const out = []
  if (f.missingWorkflow !== null) out.push({ key: "WORKFLOW MISSING", target: f.missingWorkflow })
  for (const o of f.pathsFilter) out.push({ key: "PATHS FILTER", target: o.file, line: o.line, text: o.text })
  if (f.missingStep !== null) out.push({ key: "TEST GUARD STEP MISSING", target: f.missingStep })
  for (const m of f.missingScanSteps || []) out.push({ key: m.key, target: m.file })
  if (f.prJob !== null && !f.prJob.present) {
    out.push({ key: "FRAGILE GUARD JOB MISSING", target: prWorkflow, jobLine: f.prJob.jobLine })
  }
  if (f.prJob !== null && f.prJob.needs !== null) {
    out.push({ key: "FRAGILE GUARD NEEDS", target: prWorkflow, needs: f.prJob.needs })
  }
  if (f.pushNetJob !== null && !f.pushNetJob.present) {
    out.push({ key: "GUARD GATES JOB MISSING", target: pushNet })
  }
  if (f.pushNetJob !== null && f.pushNetJob.needs !== null) {
    out.push({ key: "GUARD GATES JOB NEEDS", target: pushNet, needs: f.pushNetJob.needs })
  }
  if (f.missingSuite !== null) out.push({ key: "GUARD SUITE MISSING", target: "package.json" })
  if (f.fuzzJob !== null && !f.fuzzJob.present) out.push({ key: "FUZZ JOB MISSING", target: prWorkflow })
  if (f.fuzzJob !== null && f.fuzzJob.needs !== null) {
    out.push({ key: "FUZZ JOB NEEDS", target: prWorkflow, needs: f.fuzzJob.needs })
  }
  if (f.fuzzJob !== null && f.fuzzJob.present && !f.fuzzJob.stepPresent) {
    out.push({ key: "FUZZ STEP MISSING", target: prWorkflow })
  }
  if (f.benchmarkJob !== null && !f.benchmarkJob.present) {
    out.push({ key: "BENCHMARK JOB MISSING", target: prWorkflow })
  }
  if (f.benchmarkJob !== null && f.benchmarkJob.needs !== null) {
    out.push({ key: "BENCHMARK JOB NEEDS", target: prWorkflow, needs: f.benchmarkJob.needs })
  }
  if (f.benchmarkJob !== null && f.benchmarkJob.present && !f.benchmarkJob.stepPresent) {
    out.push({ key: "BENCHMARK STEP MISSING", target: prWorkflow })
  }
  for (const e of f.encodingBad) {
    if (e.kind === "workflow") out.push({ key: "ENCODING WORKFLOW MISSING", target: e.rel })
    else if (e.kind === "job") out.push({ key: "ENCODING CALL SITE MISSING", target: e.rel })
    else if (e.kind === "step") out.push({ key: "ENCODING CALL SITE STEP MISSING", target: e.rel })
    else out.push({ key: "ENCODING CALL SITE NEEDS", target: e.rel, needs: e.needs })
  }
  // Rule 11 (sec 11.33): one signal per dangling needs: ref (multi-valued -
  // the Prova 22 pattern). || [] keeps older result shapes (the main
  // exclusivity model without the field) emit-compatible.
  for (const d of f.danglingNeeds || []) out.push({ key: "DANGLING NEEDS", target: d.file, job: d.job, ref: d.ref, line: d.line })
  return out
}

const require = createRequire(import.meta.url)

export async function main() {
  // WORKFLOW_CONTRACTS_MODULE override (the FRAGILE_MODULE pattern): point
  // the guard at a temp manifest copy to prove derivation. Default: the
  // static workflow-contracts import.
  // Loaded via createRequire (require(esm), node >=22.12 - the repo runs
  // 22.23.1, and the override tests spawn the CLI via process.execPath)
  // INSTEAD of a dynamic import(): a computed-specifier `await import(...)`
  // makes vite's SSR transform (vitest's in-process import path) inject the
  // __vite__injectQuery client helper BEFORE the shebang (line 1) - a parse
  // error for any suite importing this module in-process
  // (guard-gates-exclusivity.test.ts). createRequire keeps the env override
  // byte-identical (the temp manifest is a plain .mjs with static exports)
  // with ZERO vite surface. path.resolve on an absolute path is a no-op but
  // makes the relative-specifier case unambiguous.
  const mod = process.env.WORKFLOW_CONTRACTS_MODULE
    ? require(path.resolve(process.env.WORKFLOW_CONTRACTS_MODULE))
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
  const facts = scanGuardGates(ROOT, contract)
  const sigs = emittedSignals(facts, { prWorkflow, pushNet })
  if (sigs.length === 0) {
    console.log(
      "guard-gates: clean (workflow present, no paths filter, test:guard step in BOTH workflows, fragile-guard job present without needs:, guard-gates job present without needs:, scan-push-full-suite in test:guard, fuzz job standalone com fuzz:ci, benchmark job standalone, encoding call sites sem needs:, os 3 scanner steps --ci (scan-timeouts/scan-curl-timeouts/scan-eol-anchor) nos DOIS workflows, grafo needs: da rede sem refs penduradas (rule 11) - sec 8.4/11.11 premise locked)",
    )
    return 0
  }
  for (const s of sigs) {
    if (s.key === "WORKFLOW MISSING") {
      console.log(
        `guard-gates: WORKFLOW MISSING - ${s.target} nao existe (a guard net, sec 8.4/11.11)`,
      )
    } else if (s.key === "PATHS FILTER") {
      console.log(`guard-gates: PATHS FILTER in ${s.target}:${s.line}: ${s.text}`)
    } else if (s.key === "TEST GUARD STEP MISSING") {
      console.log(
        `guard-gates: TEST GUARD STEP MISSING in ${s.target} (run: bun run test:guard required - the guard net, sec 8.4/11.11)`,
      )
    } else if (s.key === "SCAN TIMEOUTS STEP MISSING") {
      console.log(
        `guard-gates: SCAN TIMEOUTS STEP MISSING in ${s.target} (run: node scripts/scan-timeouts.mjs --ci required - o scanner de timeouts do net, sec 11.32)`,
      )
    } else if (s.key === "CURL TIMEOUTS STEP MISSING") {
      console.log(
        `guard-gates: CURL TIMEOUTS STEP MISSING in ${s.target} (run: node scripts/scan-curl-timeouts.mjs --ci required - o scanner de curl timeouts do net, sec 11.32)`,
      )
    } else if (s.key === "EOL ANCHOR STEP MISSING") {
      console.log(
        `guard-gates: EOL ANCHOR STEP MISSING in ${s.target} (run: node scripts/scan-eol-anchor.mjs --ci required - o scanner de eol anchors do net, sec 11.32)`,
      )
    } else if (s.key === "FRAGILE GUARD JOB MISSING") {
      console.log(
        `guard-gates: FRAGILE GUARD JOB MISSING in ${s.target}:${s.jobLine ?? "?"} (job ${contract.prJobKey}: required - o twin PR do push net, sec 8.4/11.11)`,
      )
    } else if (s.key === "FRAGILE GUARD NEEDS") {
      console.log(
        `guard-gates: FRAGILE GUARD NEEDS in ${s.target} (${s.needs} - o job standalone nao pode depender de outro; um needs: cria o skip vector da classe que o job existe para fechar)`,
      )
    } else if (s.key === "GUARD GATES JOB MISSING") {
      console.log(
        `guard-gates: GUARD GATES JOB MISSING in ${s.target} (job ${contract.pushNetJobKey}: required - o job standalone do push net, sec 8.4/11.11)`,
      )
    } else if (s.key === "GUARD GATES JOB NEEDS") {
      console.log(
        `guard-gates: GUARD GATES JOB NEEDS in ${s.target} (${s.needs} - o job standalone do push net nao pode depender de outro; um needs: para um job inexistente INVALIDA o workflow (guard-gates.yml tem UM job) e o BASELINE nem roda - Prova 19 fecha o par nos dois lados da rede)`,
      )
    } else if (s.key === "GUARD SUITE MISSING") {
      console.log(
        "guard-gates: GUARD SUITE MISSING in package.json test:guard (scan-push-full-suite.test.ts required - the 8.4 REAL-REPO CONTRACT lock)",
      )
    } else if (s.key === "FUZZ JOB MISSING") {
      console.log(
        `guard-gates: FUZZ JOB MISSING in ${s.target} (job ${FUZZ_JOB}: required - a autoridade fuzz:ci batchado, sec 11.11/11.12, standalone em qualquer PR)`,
      )
    } else if (s.key === "FUZZ JOB NEEDS") {
      console.log(
        `guard-gates: FUZZ JOB NEEDS in ${s.target} (${s.needs} - o job fuzz standalone nao pode depender de outro; um needs: tornaria o resultado do fuzz dependente do job check)`,
      )
    } else if (s.key === "FUZZ STEP MISSING") {
      console.log(
        `guard-gates: FUZZ STEP MISSING in ${s.target} (run: bun run fuzz:ci required - a autoridade fuzz:ci batchado, sec 11.11/11.12)`,
      )
    } else if (s.key === "BENCHMARK JOB MISSING") {
      console.log(
        `guard-gates: BENCHMARK JOB MISSING in ${s.target} (job ${contract.benchmarkJob}: required - o gate geo do merge path, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (s.key === "BENCHMARK JOB NEEDS") {
      console.log(
        `guard-gates: BENCHMARK JOB NEEDS in ${s.target} (${s.needs} - o job benchmark standalone nao pode depender de outro; um needs: tornaria o gate geo skippable por lint)`,
      )
    } else if (s.key === "BENCHMARK STEP MISSING") {
      console.log(
        `guard-gates: BENCHMARK STEP MISSING in ${s.target} (node scripts/run-benchmark.mjs required - o gate geo do merge path, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (s.key === "ENCODING WORKFLOW MISSING") {
      console.log(
        `guard-gates: ENCODING WORKFLOW MISSING - ${s.target} nao existe (o call site do gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (s.key === "ENCODING CALL SITE MISSING") {
      console.log(
        `guard-gates: ENCODING CALL SITE MISSING in ${s.target} (job ${contract.encodingJob}: com uses: ./.github/workflows/utf8-check.yml required - o gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (s.key === "ENCODING CALL SITE STEP MISSING") {
      console.log(
        `guard-gates: ENCODING CALL SITE STEP MISSING in ${s.target} (uses: ./.github/workflows/utf8-check.yml required - o call site do gate de encoding, sec scan-surfaces.md Type C - auditoria da rede 2026-08)`,
      )
    } else if (s.key === "DANGLING NEEDS") {
      console.log(
        `guard-gates: DANGLING NEEDS in ${s.target}:${s.line} (job ${s.job}: needs ${s.ref} nao existe no workflow - um needs: pendurado INVALIDA o workflow no parse do GitHub (0 jobs), a classe observada na Prova 24/sec 8.19)`,
      )
    } else {
      console.log(
        `guard-gates: ENCODING CALL SITE NEEDS in ${s.target} (${s.needs} - o call site do gate de encoding nao pode depender de outro job; um needs: criaria o skip vector do lint sobre o gate de encoding)`,
      )
    }
  }
  console.log(
    "guard-gates: guard-gates.yml + pr-check.yml (fragile-guard + fuzz + benchmark) + ci.yml/pr-check.yml (utf8-check) must run incondicionalmente (no paths filter, no needs: em NENHUM job standalone - fragile-guard, guard-gates, fuzz, benchmark, utf8-check) com o test:guard completo (scan-push-full-suite incluso), os 3 scanner steps --ci (scan-timeouts/scan-curl-timeouts/scan-eol-anchor) nos DOIS workflows e o grafo needs: da rede sem refs penduradas (rule 11) - a premissa da recalibracao 8.4/11.11",
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
