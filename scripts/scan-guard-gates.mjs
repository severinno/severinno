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
 * 5. NO NEEDS: (NEGATIVO, lado PR): o job fragile-guard NAO pode ter
 *    `needs:` (ex.: needs: check) - um needs tornaria o job dependente de
 *    um job que pode falhar no lint ANTES dos testes, o skip da classe que
 *    o job standalone existe para fechar = falha 'FRAGILE GUARD NEEDS'.
 * 6. SCAN-PUSH-FULL-SUITE EM test:guard (POSITIVO): o script `test:guard`
 *    do package.json DEVE incluir `scan-push-full-suite.test.ts` (o
 *    REAL-REPO CONTRACT que trava a 8.4) - remover a suite da lista = a
 *    rede deixa de rodar o guard = falha 'GUARD SUITE MISSING'.
 *
 * Env override GUARD_GATES_SCAN_ROOT (repo sintetico p/ o vitest - espelha
 * o PUSH_SUITE_SCAN_ROOT do scan-push-full-suite). Saida ASCII pura (gate
 * file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { GUARD_NET, GUARD_NET_JOB } from "./workflow-contracts.mjs"

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

/** The pr-check.yml job key at the root of jobs (2-space indent). */
const JOB_KEY_RE = /^  [A-Za-z0-9_-]+:$/

/** A `needs:` key (job-level dependency - a skip vector for the guard job). */
const NEEDS_RE = /^\s*needs:/

/** A paths/paths-ignore filter under on.push (the no-filter BY DESIGN decision). */
const PATHS_FILTER_RE = /^\s*paths(?:-ignore)?:\s*/

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * The PR-side guard job state inside the pr-check.yml twin. Returns null
 * when the workflow file is absent; otherwise { present, stepPresent,
 * needs } where present is false when no guard job key exists, stepPresent
 * is false when the job block carries no `run: bun run test:guard` step,
 * and needs is the `needs:` value text (trimmed) when the job declares one.
 * Exported for unit tests.
 */
export function prGuardJob(root, prWorkflow, job) {
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
      if (TEST_GUARD_STEP_RE.test(line)) {
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
  return { guardNet: GUARD_NET, prJobKey: GUARD_NET_JOB }
}

/**
 * Scan the guard-net contract across ALL workflows of the net. Returns
 * { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob } where
 * missingWorkflow is the FIRST net workflow rel-path absent (null when all
 * present), pathsFilter is [{ file, line, text }] of paths: filters in
 * guard-gates.yml, missingStep is the rel-path of the FIRST workflow missing
 * the test:guard step (null when all present), missingSuite is the pkg
 * rel-path when the 8.4 guard suite is missing from test:guard (null when
 * present), and prJob is the prGuardJob() result of the PR twin. All clean =
 * clean. Exported for unit tests.
 */
export function scanGuardGates(root = ROOT, contract = defaultContract()) {
  const { guardNet, prJobKey } = contract
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

  return { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob }
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
  const contract = mod ? { guardNet: mod.GUARD_NET, prJobKey: mod.GUARD_NET_JOB } : defaultContract()
  const prWorkflow = contract.guardNet[contract.guardNet.length - 1]
  const { missingWorkflow, pathsFilter, missingStep, missingSuite, prJob } = scanGuardGates(ROOT, contract)
  const prBad = prJob !== null && (!prJob.present || prJob.needs !== null)
  if (
    missingWorkflow === null &&
    pathsFilter.length === 0 &&
    missingStep === null &&
    missingSuite === null &&
    !prBad
  ) {
    console.log(
      "guard-gates: clean (workflow present, no paths filter, test:guard step in BOTH workflows, fragile-guard job present without needs:, scan-push-full-suite in test:guard - sec 8.4 premise locked)",
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
  if (missingSuite !== null) {
    console.log(
      "guard-gates: GUARD SUITE MISSING in package.json test:guard (scan-push-full-suite.test.ts required - the 8.4 REAL-REPO CONTRACT lock)",
    )
  }
  console.log(
    "guard-gates: guard-gates.yml + pr-check.yml (fragile-guard) must run incondicionalmente (no paths filter, no needs:) com o test:guard completo (scan-push-full-suite incluso) - a premissa da recalibracao 8.4/11.11",
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
