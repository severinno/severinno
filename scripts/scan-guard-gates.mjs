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
 * CONTRATO BIDIRECIONAL (mesmo padrao do scan-push-full-suite):
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
 * 3. TEST:GUARD STEP (POSITIVO): o workflow DEVE conter `bun run
 *    test:guard` - remover/trocar o step = push sem rede = falha
 *    'TEST GUARD STEP MISSING'.
 * 4. SCAN-PUSH-FULL-SUITE EM test:guard (POSITIVO): o script `test:guard`
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
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.GUARD_GATES_SCAN_ROOT || process.cwd())
// POSIX rel paths (the repo convention for reported paths - the same as the
// FILES array of scan-push-full-suite): path.join would emit backslashes on
// Windows in the CLI output, breaking the pinned file:line asserts.
const WORKFLOW = ".github/workflows/guard-gates.yml"
const PKG = "package.json"

/** The test:guard script MUST keep the 8.4 contract suite (the 8.4/11.11 premise). */
const REQUIRED_GUARD_SUITE_RE = /scan-push-full-suite\.test\.ts/

/** The push-net step MUST invoke test:guard (the net itself). */
const TEST_GUARD_STEP_RE = /\bbun\s+run\s+test:guard\b/

/** A paths/paths-ignore filter under on.push (the no-filter BY DESIGN decision). */
const PATHS_FILTER_RE = /^\s*paths(?:-ignore)?:\s*/

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Scan the push-net contract. Returns { missingWorkflow, pathsFilter,
 * missingStep, missingSuite } where missingWorkflow is the workflow rel-path
 * when the file is absent (null when present), pathsFilter is [{ file, line,
 * text }] of paths: filters in the workflow, missingStep is the workflow
 * rel-path when the test:guard step is absent (null when present), and
 * missingSuite is the pkg rel-path when the 8.4 guard suite is missing from
 * test:guard (null when present). All empty = clean. Exported for unit tests.
 */
export function scanGuardGates(root = ROOT) {
  const wfAbs = path.join(root, WORKFLOW)
  const wfExists = fs.existsSync(wfAbs)
  const missingWorkflow = wfExists ? null : WORKFLOW
  const pathsFilter = []
  if (wfExists) {
    const lines = fs.readFileSync(wfAbs, "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isComment(line)) return
      if (PATHS_FILTER_RE.test(line)) {
        pathsFilter.push({ file: WORKFLOW, line: i + 1, text: line.trim() })
      }
    })
  }

  let missingStep = null
  if (wfExists) {
    if (!TEST_GUARD_STEP_RE.test(fs.readFileSync(wfAbs, "utf8"))) {
      missingStep = WORKFLOW
    }
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

  return { missingWorkflow, pathsFilter, missingStep, missingSuite }
}

function main() {
  const { missingWorkflow, pathsFilter, missingStep, missingSuite } = scanGuardGates()
  if (missingWorkflow === null && pathsFilter.length === 0 && missingStep === null && missingSuite === null) {
    console.log(
      "guard-gates: clean (workflow present, no paths filter, test:guard step present, scan-push-full-suite in test:guard - sec 8.4 premise locked)",
    )
    return 0
  }
  if (missingWorkflow !== null) {
    console.log(
      "guard-gates: WORKFLOW MISSING - .github/workflows/guard-gates.yml nao existe (o push net, sec 8.4/11.11)",
    )
  }
  for (const o of pathsFilter) {
    console.log(`guard-gates: PATHS FILTER in ${o.file}:${o.line}: ${o.text}`)
  }
  if (missingStep !== null) {
    console.log(
      "guard-gates: TEST GUARD STEP MISSING in .github/workflows/guard-gates.yml (bun run test:guard required - the push net, sec 8.4/11.11)",
    )
  }
  if (missingSuite !== null) {
    console.log(
      "guard-gates: GUARD SUITE MISSING in package.json test:guard (scan-push-full-suite.test.ts required - the 8.4 REAL-REPO CONTRACT lock)",
    )
  }
  console.log(
    "guard-gates: guard-gates.yml must exist and run incondicionalmente (no paths filter) com o test:guard completo (scan-push-full-suite incluso) - a premissa da recalibracao 8.4/11.11",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanGuardGates without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
