#!/usr/bin/env node

/**
 * run-all-fuzz.mjs
 *
 * Pure Node.js fuzz test runner - no bash/sed dependency.
 * Portavel para Windows e CI multiplataforma.
 *
 * Auto-descobre todos os arquivos *-fuzz*.test.{ts,tsx} em src/ (via
 * discoverFuzzSuites do fuzz-targets.mjs - a MESMA fonte da descoberta do
 * runner mapeado, secao 11.11, fechando a duplicacao de walkDir/isFuzzFile),
 * extrai FUZZ_ITERATIONS de cada um via regex, executa TODAS as suites em
 * UMA unica invocacao vitest com --reporter=json, re-splita o doc por suite
 * e formata os resultados.
 *
 * BATCHING (secao 11.12 do gates-proofs.md, medicao 2026-08-10): o runner
 * antigo spawnava um vitest POR suite (6 spawns, ~60s); o boot por-spawn
 * dominava o custo. Uma unica invocacao com as 6 suites custa ~2.3x menos
 * (A/B same-session 11.12: 59.96s -> 26.16s; os ~15s da 11.11 eram outro
 * estado de maquina). O CI (`fuzz:ci > fuzz-results.json`) e o pre-push
 * (via run-mapped-fuzz.mjs) ganham o mesmo lever do encoder do
 * verify-encoding. O FORMATO DE SAIDA e
 * preservado: o formatter continua recebendo UM arquivo JSON por suite com
 * o sidecar .iters - splitPerSuiteResults re-splita o doc unico do vitest
 * em docs por-suite identicos em shape aos antigos (numTotalTests,
 * numPassedTests, numFailedTests, duration, testResults[].assertionResults).
 * Bonus: a coluna Duration do formatter passa a mostrar o wall-clock real
 * por suite (endTime-startTime; o vitest 3.1.1 nao emite duration no
 * top-level do doc unico).
 *
 * Usage:
 *   node scripts/run-all-fuzz.mjs                   # table output
 *   node scripts/run-all-fuzz.mjs --json            # JSON output for CI
 *   node scripts/run-all-fuzz.mjs --only radius     # filter by filename
 *   node scripts/run-all-fuzz.mjs --verbose         # raw vitest output
 *
 * Exit codes:
 *   0 - all fuzz tests passed
 *   1 - one or more fuzz tests failed
 *   2 - unexpected error (no suites matched / vitest output unparseable)
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { discoverFuzzSuites } from "./fuzz-targets.mjs"

const require = createRequire(import.meta.url)
// Resolve vitest's real CLI entry from the local install (same pattern as
// pre-commit-tests.mjs / run-mapped-fuzz.mjs) - no `bun`/`npx` PATH
// dependency inside the runner.
const VITEST_BIN = require.resolve("vitest/vitest.mjs")

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(fileURLToPath(import.meta.url), "../..")

/** Name of the formatter script used for output. */
const FORMATTER = join(ROOT, "scripts", "format-fuzz-results.mjs")

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const VERBOSE = args.includes("--verbose")
const JSON_MODE = args.includes("--json")

let ONLY_FILTER = ""
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg.startsWith("--only=")) {
    ONLY_FILTER = arg.slice("--only=".length)
  } else if (arg === "--only" && i + 1 < args.length && !args[i + 1].startsWith("--")) {
    ONLY_FILTER = args[++i]
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract FUZZ_ITERATIONS value from a source file. */
function extractIterations(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8")
    const match = content.match(
      /FUZZ_ITERATIONS\s*[:=]\s*(\d+)/,
    )
    return match ? Number.parseInt(match[1], 10) : 0
  } catch {
    return 0
  }
}

/** Label of a suite from its absolute path (the old per-file naming). */
function suiteLabel(absPath) {
  return absPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.[jt]sx?$/, "") ?? "unknown"
}

/**
 * Re-split one vitest JSON doc (the batch run) into per-suite docs in the
 * OLD per-file shape the formatter consumes. Each suite entry in
 * testResults is one test file: we count its own assertions and use its own
 * wall clock (endTime - startTime; the vitest 3.1.1 top-level doc carries no
 * duration field). Exported for the hermetic vitest suite.
 */
export function splitPerSuiteResults(data) {
  const suites = data?.testResults ?? []
  return suites.map((suite) => {
    const results = suite.assertionResults ?? []
    return {
      numTotalTests: results.length,
      numPassedTests: results.filter((t) => t.status === "passed").length,
      numFailedTests: results.filter((t) => t.status === "failed").length,
      duration: Math.max(0, (suite.endTime ?? 0) - (suite.startTime ?? 0)),
      testResults: [suite],
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // ---- Discover fuzz files (single source of truth: fuzz-targets.mjs) ----
  const allFiles = discoverFuzzSuites(ROOT)

  // Apply --only filter
  let fuzzFiles = allFiles
  if (ONLY_FILTER) {
    fuzzFiles = allFiles.filter((f) =>
      f.replace(/\\/g, "/").includes(ONLY_FILTER),
    )
  }

  if (fuzzFiles.length === 0) {
    console.error(`X No fuzz files matched pattern '${ONLY_FILTER || "*"}' in ${join(ROOT, "src")}`)
    process.exit(2)
  }

  // ---- Header ----
  // In JSON mode, header goes to stderr so stdout is pure JSON (for > file redirects).
  const log = JSON_MODE ? console.error : console.log
  log("")
  log("????????????????????????????????????????????????????????????????????????")
  log("?                   Severinno - Fuzz Test Runner                     ?")
  log("????????????????????????????????????????????????????????????????????????")
  log("")

  if (ONLY_FILTER) {
    log(`  Filter: --only=${ONLY_FILTER}`)
  }
  log("  Seed:   42 (hardcoded in each test suite)")
  log("")

  // ---- --verbose mode: run vitest inline (already a single batch) ----
  if (VERBOSE) {
    log(`  Running: npx vitest run ${fuzzFiles.join(" ")} --reporter=verbose\n`)
    const res = spawnSync(
      process.execPath,
      [VITEST_BIN, "run", ...fuzzFiles, "--reporter=verbose"],
      { cwd: ROOT, stdio: "inherit", env: process.env, timeout: 180_000 },
    )
    if (res.error) process.exit(2)
    process.exit(res.status ?? 1)
  }

  // ---- Normal mode: ONE vitest invocation for ALL suites (the batching) ----
  const tmpDir = mkdtempSync(join(tmpdir(), "fuzz-"))
  const res = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", ...fuzzFiles, "--reporter=json"],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (res.error) {
    console.error(`[fuzz] falha ao executar vitest: ${res.error.message}`)
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(2)
  }

  // vitest exits non-zero on test failure - the JSON is still emitted; the
  // formatter decides the final exit (per-suite numFailedTests).
  let doc
  try {
    doc = JSON.parse(res.stdout)
  } catch {
    console.error("[fuzz] saida JSON do vitest invalida/incompleta (config quebrada?)")
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(2)
  }

  // ---- Re-split into per-suite JSON + .iters sidecars (formatter contract) ----
  const jsonFiles = []
  for (const suiteDoc of splitPerSuiteResults(doc)) {
    const suitePath = suiteDoc.testResults[0]?.name ?? ""
    const label = suiteLabel(suitePath)
    const jsonOut = join(tmpDir, `${label}.json`)
    const iters = suitePath ? extractIterations(suitePath) : 0
    writeFileSync(jsonOut, JSON.stringify(suiteDoc), "utf-8")
    writeFileSync(join(tmpDir, `${label}.iters`), String(iters), "utf-8")
    jsonFiles.push(jsonOut)
  }

  // ---- Format output ----
  const formatterArgs = JSON_MODE ? ["--json", ...jsonFiles] : jsonFiles

  const fmt = spawnSync(
    process.execPath,
    [FORMATTER, ...formatterArgs],
    { cwd: ROOT, stdio: "inherit", env: process.env, timeout: 60_000 },
  )
  rmSync(tmpDir, { recursive: true, force: true })

  if (fmt.error) process.exit(2)
  process.exit(fmt.status ?? 1)
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of splitPerSuiteResults without side effects).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
