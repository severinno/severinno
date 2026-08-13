#!/usr/bin/env node
/**
 * Targeted unit tests for touched areas - Severinno
 *
 * Runs the unit tests related to the files in the git diff, so a commit/push
 * can't land with a broken test in an area it touches - before the full suite
 * runs in CI. Two scopes, selected by `--scope`:
 *   - `cached` (default, pre-commit): files STAGED in git (`git diff --cached`);
 *   - `push` (pre-push, Gate 3 of pre-push-gates.sh): the union of staged
 *     (`git diff --cached`), HEAD (staged + unstaged leftovers, `git diff
 *     HEAD`) and the pushed commits' range (`--since <remote-sha>` ?
 *     `git diff <sha>...HEAD`). The remote sha comes from the pre-push hook
 *     stdin (`.husky/pre-push` captures the 1st ref line); absent or all-zeros
 *     (first push of a new branch), it falls back to staged + HEAD.
 *
 * Mapping rules:
 *   - a staged `*.test.{ts,tsx}` file runs as-is (only if it still exists on
 *     disk - a staged DELETION of a test has nothing to run);
 *   - a staged source file (`*.ts|tsx|mjs`) runs its co-located tests:
 *     `<dir>/<name>.test.{ts,tsx}` and `<dir>/__tests__/<name>.test.{ts,tsx}`
 *     (the `scripts/__tests__/` convention is covered by the latter). This
 *     includes staged DELETIONS of sources (diff-filter D): the co-located
 *     test still exists on disk, so it runs and fails loudly on the missing
 *     import - exactly what you want when a source is removed without its test;
 *   - anything else (docs, workflow YAML, e2e specs, ...) maps to nothing.
 *   - FRONTIER TRIPWIRE (sec 11.122): a staged `scripts/scan-evidence-sweep.mjs`
 *     (a fronteira compartilhada dos sweeps das 11.117/11.118) roda TAMBEM as
 *     suites dependentes (wired-guards-contract + proof-helpers-contract) - a
 *     regra de co-localizacao acharia so a suite do proprio fonte; os ABS PINs
 *     das 11.117/11.118 vivem nas suites dependentes.
 * When no unit tests map to the staged files, it prints a skip line and exits 0
 * (fast path for doc-only commits - the pre-commit hook must not block those).
 *
 * Tests run under `vitest.config.unit.ts` (jsdom + forks pool, the stable unit
 * config) with `--passWithNoTests` as a guard. `collectTestFiles` is exported
 * pure for unit tests; the CLI flow runs only when this file is the entry point.
 *
 * Exit codes: 0 = ok or skipped; 1 = a mapped test failed or vitest errored.
 */
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
// Resolve vitest's real CLI entry from the local install (same pattern as
// bundle-report.mjs spawning check-js-budget with process.execPath) - avoids
// relying on `bun`/`npx` being on PATH inside the hook's spawn environment.
const VITEST_BIN = require.resolve("vitest/vitest.mjs")

const TEST_RE = /\.test\.(ts|tsx)$/
const SOURCE_RE = /\.(ts|tsx|mjs)$/

/** True for unit test files (the things vitest runs). */
export function isTestFile(rel) {
  return TEST_RE.test(rel)
}

/** True for source files that can carry a co-located unit test. */
export function isSourceFile(rel) {
  return SOURCE_RE.test(rel) && !isTestFile(rel)
}

/**
 * FRONTIER_DEPENDENT_SUITES (sec 11.122) - o mapa do tripwire: a fronteira
 * compartilhada dos sweeps de evidencia datada (scan-evidence-sweep.mjs, sec
 * 11.120) e importada por DUAS suites alem da sua (wired-guards-contract com
 * o ABS PIN das 8 citacoes da 11.117; proof-helpers-contract com o ABS PIN
 * das 0 citacoes de helper da 11.118). A regra de co-localizacao mapearia o
 * fonte so para a suite dele - um edit no fonte que mude o conjunto derivado
 * com a doc ainda limpa quebraria so os ABS PINs das dependentes, no push/CI.
 * O mapa e o pin explicito (o padrao do GUARD_SUITE_MAP da sec 11.78).
 */
export const FRONTIER_DEPENDENT_SUITES = {
  "scripts/scan-evidence-sweep.mjs": [
    "scripts/__tests__/wired-guards-contract.test.ts",
    "scripts/__tests__/proof-helpers-contract.test.ts",
  ],
}

/**
 * Map a list of staged file paths (relative to `root`) to the deduped unit
 * test files that cover them. Only files that EXIST on disk are returned.
 */
export function collectTestFiles(staged, root = process.cwd()) {
  const out = new Set()
  for (const rel of staged) {
    if (isTestFile(rel)) {
      // diff-filter D includes deleted tests; passing a non-existent path to
      // vitest would error - skip staged test files that no longer exist.
      if (fs.existsSync(path.join(root, rel))) out.add(rel)
      continue
    }
    if (!isSourceFile(rel)) continue
    // git always emits POSIX-style paths, so build the candidates with
    // path.posix (on Windows path.join would inject backslashes and the
    // returned list would not match the staged-path convention). The
    // existence check still uses the native join, which accepts both.
    const dir = path.posix.dirname(rel)
    const base = path.posix.basename(rel).replace(/\.[^.]+$/, "")
    for (const cand of [
      path.posix.join(dir, `${base}.test.ts`),
      path.posix.join(dir, `${base}.test.tsx`),
      path.posix.join(dir, "__tests__", `${base}.test.ts`),
      path.posix.join(dir, "__tests__", `${base}.test.tsx`),
    ]) {
      if (fs.existsSync(path.join(root, cand))) out.add(cand)
    }
  }
  // O tripwire da sec 11.122: um fonte da fronteira compartilhada staged roda
  // TAMBEM as suites dependentes (so os ABS PINs delas pegam um edit que mude
  // o conjunto derivado com a doc ainda limpa). Deps inexistentes sao pulados
  // (a mesma regra dos candidatos co-localizados - so o que existe no disco).
  for (const [src, deps] of Object.entries(FRONTIER_DEPENDENT_SUITES)) {
    if (!staged.includes(src)) continue
    for (const dep of deps) {
      if (fs.existsSync(path.join(root, dep))) out.add(dep)
    }
  }
  return [...out]
}

/**
 * CLI args for the two scopes:
 *   --scope cached|push   (default cached - pre-commit)
 *   --since <sha>         (push only - the remote sha of the pushed ref, from
 *                          the pre-push hook stdin; optional)
 */
export function parseArgs(argv) {
  const args = { scope: "cached", since: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scope") args.scope = argv[i + 1] ?? "cached"
    else if (argv[i] === "--since") args.since = argv[i + 1] ?? null
  }
  if (args.scope !== "cached" && args.scope !== "push") args.scope = "cached"
  return args
}

/**
 * A remote sha of all zeros means a FIRST push of a new branch (the remote
 * has no counterpart yet) - there is no meaningful range to diff, so the
 * push scope falls back to staged + HEAD.
 */
export function isValidSince(since) {
  return Boolean(since) && !/^0+$/.test(since.trim())
}

/**
 * Pure union of the push scope's three sources (staged / HEAD / pushed-range),
 * deduped - exported for unit tests (the git commands themselves stay private).
 */
export function mergePushScope(staged, headFiles, rangeFiles) {
  const out = new Set()
  for (const f of [...staged, ...headFiles, ...rangeFiles]) {
    if (f) out.add(f)
  }
  return [...out]
}

/**
 * File paths (relative to cwd) changed by a git diff. Includes deletions (D)
 * so a removed source still runs its co-located test (fails loudly on the
 * missing import). Renames (R) appear under their new name with --name-only.
 * Empty output (and exit 0) for an empty diff.
 */
function gitDiffFiles(diffArgs) {
  try {
    const out = execFileSync("git", ["diff", ...diffArgs, "--name-only", "--diff-filter=ACMRD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return out.split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** True when `sha` resolves to a local commit (safe to use in a diff range). */
function gitRefExists(sha) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/** Staged files (the pre-commit scope). */
function gitStagedFiles() {
  return gitDiffFiles(["--cached"])
}

/**
 * Push scope (Gate 3 of pre-push-gates.sh): staged ? HEAD (staged + unstaged
 * leftovers) ? the pushed commits' range (`<since>...HEAD`, three-dot = from
 * the merge-base to HEAD). The since check guards against a first push
 * (all-zeros) or a remote sha unknown locally (force-push), falling back to
 * staged + HEAD.
 *
 * EXPORTED (2026-08) for run-mapped-fuzz.mjs - the mapped-fuzz runner reuses
 * the EXACT same diff union as the Gate 3 (single source of truth for the
 * pushed surface): a push touching the same files must map the same fuzz
 * suites it maps unit tests for. Both callers keep using it unchanged.
 */
export function gitPushScopeFiles(since) {
  const staged = gitDiffFiles(["--cached"])
  const head = gitDiffFiles(["HEAD"])
  let range = []
  if (isValidSince(since) && gitRefExists(since)) {
    range = gitDiffFiles([`${since}...HEAD`])
  }
  return mergePushScope(staged, head, range)
}

function main() {
  const { scope, since } = parseArgs(process.argv.slice(2))
  const files = scope === "push" ? gitPushScopeFiles(since) : gitStagedFiles()
  const tests = collectTestFiles(files)
  const label = scope === "push" ? "pre-push" : "pre-commit"
  if (tests.length === 0) {
    console.log(`  ${label}:test - nenhum teste unit?rio nas ?reas tocadas (skip)`)
    return
  }
  console.log(`  ${label}:test - ${tests.length} teste(s) nas ?reas tocadas: ${tests.join(", ")}`)
  const res = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", ...tests, "--config", "vitest.config.unit.ts", "--passWithNoTests"],
    { cwd: process.cwd(), stdio: "inherit", env: process.env },
  )
  if (res.error) {
    console.error(`  ${label}:test - falha ao executar vitest: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

// Entry-point guard: only run the CLI flow when executed directly (vitest
// imports the file for unit tests of collectTestFiles without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
