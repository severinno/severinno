#!/usr/bin/env node
/**
 * scan-batch-coverage.mjs - guard do CONTRATO DE CRESCIMENTO do batch runner
 * (2026-08, secao 11.16): TODO node guard novo no pre-commit DEVE entrar no
 * batch runner (run-precommit-guards.mjs) - um guard adicionado como spawn
 * direto no .husky/pre-commit sem entrar no batch = falha com o caminho
 * exato (o padrao de spread dos TARGET_DIRS aplicado aos guards do hook).
 *
 * WHY: o contrato 4 do scan-push-full-suite pina os guards do batch por
 * REGEX FIXO (os nomes hardcoded) - um 6o guard adicionado direto ao hook
 * escaparia do regex (a classe de drift que o SPREAD CONTRACT dos TARGET_DIRS
 * mata). Este guard DERIVA a lista do batch dos IMPORTS VIVOS do runner
 * (os mesmos `import { main as X } from "./X.mjs"` do run-precommit-guards.mjs)
 * - um guard adicionado ao batch fica automaticamente coberto (nao precisa
 * de entry no scan), e um guard fora do batch falha ate entrar.
 * NOTA de superficie (2026-08): o runner NAO pode ganhar imports `./`
 * NAO-guard (ex.: um util compartilhado) - a derivacao classificaria como
 * guard do batch; o DERIVATION PIN (exatamente 6) falha alto nessa mudanca
 * (forca a atualizacao consciente do pin), nunca drift silencioso.
 *
 * CONTRATO (bidirecional, mesmo padrao do scan-lint-staged-loader):
 * - NEGATIVO: um spawn `node scripts/X.mjs` direto no .husky/pre-commit em
 *   que X NAO e o batch runner. Duas subclasses:
 *   - X esta no batch DERIVADO (ja roda via run-precommit-guards.mjs) =
 *     'ALREADY BATCHED' - o spawn direto e REDUNDANTE (double-run, o mesmo
 *     guard roda 2x por commit); remover a linha, nao duplicar.
 *   - X nao esta no batch nem na HOOK_ALLOWLIST = 'GUARD OUTSIDE BATCH' -
 *     o guard novo precisa ENTRAR no batch (o crescimento que este contrato
 *     pina), nao virar spawn direto.
 *   O scan ignora comentarios (o header do hook explica os guards em prosa).
 * - POSITIVO: o batch runner DEVE estar wired no .husky/pre-commit (remover
 *   o batch = os guards voltam a custar N boots = falha 'MISSING').
 *
 * HOOK_ALLOWLIST (as 2 excecoes deliberadas, pinadas com rationale - um 3o
 * guard fora do batch exige editar ESTA lista com justificativa):
 * - scan-lucide-icons.mjs --check: guard de GERACAO (--check compara o mock
 *   a11y do vitrine); roda ANTES do batch (a ordem importa - ele alimenta o
 *   setup dos testes que o batch nao ve), custo <1s, superficie src/.
 * - check-next-types.mjs --fix: guard de AUTO-HEAL (--fix remove .next/types
 *   stale); roda ANTES do tsc do hook (a ordem importa - regenerar types
 *   antes do typecheck), custo <10ms. Mover para o batch exigiria o runner
 *   rodar com --fix (mutation) - categoria diferente dos gate-scan puros.
 *
 * Env override BATCH_COVERAGE_SCAN_ROOT (repo sintetico p/ o vitest -
 * espelha o PUSH_SUITE_SCAN_ROOT / GUARD_GATES_SCAN_ROOT). Saida ASCII pura
 * (gate file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.BATCH_COVERAGE_SCAN_ROOT || process.cwd())
// Forward-slash literals (same convention as scan-push-full-suite): Node
// accepts them on Windows for fs reads, and the output path in failure
// messages stays stable across OSes (path.join would emit `\` on Windows
// and break the exact-path asserts in the vitest suite).
const PRE_COMMIT = ".husky/pre-commit"
const RUNNER = "scripts/run-precommit-guards.mjs"

/**
 * The 2 deliberate hook-guard exceptions (pinned - a 3rd entry requires a
 * documented rationale, the EXCLUDED_TREES pattern of the fragile-range):
 * scan-lucide-icons (generation --check, order-sensitive pre-batch) and
 * check-next-types (auto-heal --fix, order-sensitive pre-tsc).
 */
export const HOOK_ALLOWLIST = ["scan-lucide-icons.mjs", "check-next-types.mjs"]

/** A direct node-guard spawn in the pre-commit. */
const DIRECT_SPAWN_RE = /node\s+scripts\/([A-Za-z0-9._-]+\.mjs)/

/** The runner's own module (the batch itself - never a violation). */
const BATCH_RUNNER = "run-precommit-guards.mjs"

/** Import lines of the batch runner: `import { main as X } from "./Y.mjs"`. */
const BATCH_IMPORT_RE = /^import\s+[^;]+?\s+from\s+"\.\/([A-Za-z0-9._-]+\.mjs)"/gm

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Derive the live batch-guard list from the runner's own imports (the single
 * source of truth the runner executes). A guard added to the batch is
 * automatically covered - the SPREAD direction of this contract (a future
 * 6th guard needs no entry here). Returns [] when the runner is absent.
 * Exported for the unit tests.
 */
export function deriveBatchGuards(runnerSource) {
  return [...runnerSource.matchAll(BATCH_IMPORT_RE)].map((m) => m[1])
}

/**
 * Scan the pre-commit hook coverage. Returns { outsideBatch, alreadyBatched,
 * batchRunner } where outsideBatch is [{ line, text }] of direct node-guard
 * spawns that are neither the batch runner nor allowlisted AND NOT in the
 * derived batch (the growth class: must enter the batch), alreadyBatched is
 * [{ line, text }] of direct spawns of guards the derived batch already runs
 * (the redundant double-run class), and batchRunner is [] when the batch
 * line is missing (positive pin). All empty = clean. Exported for tests.
 */
export function scanBatchCoverage(root = ROOT) {
  const hookPath = path.join(root, PRE_COMMIT)
  const runnerPath = path.join(root, RUNNER)
  // Not scannable without the hook (minimal synthetic root) - clean, same
  // posture as scan-push-full-suite skipping missing files.
  if (!fs.existsSync(hookPath)) {
    return { outsideBatch: [], alreadyBatched: [], batchRunner: [] }
  }
  const batchGuards = fs.existsSync(runnerPath)
    ? deriveBatchGuards(fs.readFileSync(runnerPath, "utf8"))
    : []
  const outsideBatch = []
  const alreadyBatched = []
  let runnerFound = false
  const lines = fs.readFileSync(hookPath, "utf8").split(/\r?\n/)
  lines.forEach((line, i) => {
    if (isComment(line)) return
    const m = line.match(DIRECT_SPAWN_RE)
    if (!m) return
    const name = m[1]
    if (name === BATCH_RUNNER) {
      runnerFound = true
      return
    }
    if (HOOK_ALLOWLIST.includes(name)) return
    if (batchGuards.includes(name)) {
      alreadyBatched.push({ line: i + 1, text: line.trim() })
      return
    }
    outsideBatch.push({ line: i + 1, text: line.trim() })
  })
  return {
    outsideBatch,
    alreadyBatched,
    batchRunner: runnerFound ? [] : [{ text: PRE_COMMIT }],
  }
}

export function main() {
  const { outsideBatch, alreadyBatched, batchRunner } = scanBatchCoverage()
  if (
    outsideBatch.length === 0 &&
    alreadyBatched.length === 0 &&
    batchRunner.length === 0
  ) {
    console.log(
      "batch-coverage: clean (all direct node guards in .husky/pre-commit are the batch runner or allowlisted exceptions - sec 11.16)",
    )
    return 0
  }
  for (const o of outsideBatch) {
    console.log(
      `batch-coverage: GUARD OUTSIDE BATCH at ${PRE_COMMIT}:${o.line}: ${o.text} (add it to run-precommit-guards.mjs - sec 11.16)`,
    )
  }
  for (const o of alreadyBatched) {
    console.log(
      `batch-coverage: ALREADY BATCHED at ${PRE_COMMIT}:${o.line}: ${o.text} (the batch runner already runs this guard - remove the redundant direct spawn, sec 11.16)`,
    )
  }
  for (const m of batchRunner) {
    console.log(
      `batch-coverage: BATCH RUNNER MISSING in ${m.text} (node scripts/run-precommit-guards.mjs required - sec 11.16)`,
    )
  }
  console.log(
    "batch-coverage: sec 11.16 - todo node guard novo do pre-commit deve entrar no batch runner (run-precommit-guards.mjs); excecoes so via HOOK_ALLOWLIST com rationale",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanBatchCoverage without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
