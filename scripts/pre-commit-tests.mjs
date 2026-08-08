#!/usr/bin/env node
/**
 * Pre-commit targeted unit tests — Severinno
 *
 * Runs the unit tests related to the files STAGED in git (`git diff --cached`),
 * so a commit can't land with a broken test in an area it touches — before the
 * full suite runs in CI. Mapping rules:
 *   - a staged `*.test.{ts,tsx}` file runs as-is (only if it still exists on
 *     disk — a staged DELETION of a test has nothing to run);
 *   - a staged source file (`*.ts|tsx|mjs`) runs its co-located tests:
 *     `<dir>/<name>.test.{ts,tsx}` and `<dir>/__tests__/<name>.test.{ts,tsx}`
 *     (the `scripts/__tests__/` convention is covered by the latter). This
 *     includes staged DELETIONS of sources (diff-filter D): the co-located
 *     test still exists on disk, so it runs and fails loudly on the missing
 *     import — exactly what you want when a source is removed without its test;
 *   - anything else (docs, workflow YAML, e2e specs, ...) maps to nothing.
 * When no unit tests map to the staged files, it prints a skip line and exits 0
 * (fast path for doc-only commits — the pre-commit hook must not block those).
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
// bundle-report.mjs spawning check-js-budget with process.execPath) — avoids
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
 * Map a list of staged file paths (relative to `root`) to the deduped unit
 * test files that cover them. Only files that EXIST on disk are returned.
 */
export function collectTestFiles(staged, root = process.cwd()) {
  const out = new Set()
  for (const rel of staged) {
    if (isTestFile(rel)) {
      // diff-filter D includes deleted tests; passing a non-existent path to
      // vitest would error — skip staged test files that no longer exist.
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
  return [...out]
}

/**
 * Staged file paths relative to cwd. Includes deletions (D) so a removed
 * source still runs its co-located test (fails loudly on the missing import).
 * Renames (R) appear under their new name with --name-only.
 */
function gitStagedFiles() {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return out.split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function main() {
  const staged = gitStagedFiles()
  const tests = collectTestFiles(staged)
  if (tests.length === 0) {
    console.log("  pre-commit:test — nenhum teste unitário nas áreas tocadas (skip)")
    return
  }
  console.log(`  pre-commit:test — ${tests.length} teste(s) nas áreas tocadas: ${tests.join(", ")}`)
  const res = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", ...tests, "--config", "vitest.config.unit.ts", "--passWithNoTests"],
    { cwd: process.cwd(), stdio: "inherit", env: process.env },
  )
  if (res.error) {
    console.error(`  pre-commit:test — falha ao executar vitest: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

// Entry-point guard: only run the CLI flow when executed directly (vitest
// imports the file for unit tests of collectTestFiles without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
