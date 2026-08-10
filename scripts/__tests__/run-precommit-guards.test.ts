/**
 * run-precommit-guards.mjs - batch runner dos 6 guards node do pre-commit
 * (2026-08, secao 11.13/11.16): uma UNICA invocacao node agrega os exit codes.
 *
 * Hermetic tests via the guards' OWN env overrides (PUSH_SUITE_SCAN_ROOT /
 * LINT_LOADER_SCAN_ROOT / GUARD_GATES_SCAN_ROOT / NODE_MODULES_ROOT /
 * FUZZ_PRECOMMIT_SCAN_ROOT / BATCH_COVERAGE_SCAN_ROOT - the same env-override
 * pattern as FRAGILE_SCAN_ROOT): each test points ONE override at a synthetic
 * temp repo that FAILS that guard, while the OTHER five guards scan the REAL
 * repo (clean today) - proving:
 *   1. AGREGACAO (worst-exit): um guard falho -> batch exit 1.
 *   2. ISOLAMENTO: os outros 5 guards RODAM MESMO ASSIM e reportam clean -
 *      uma falha nunca esconde as demais (a razao do batch sobre o hook
 *      antigo com `set -e`, que parava no 1o erro e escondia o resto).
 *   3. ORDER (determinismo): a saida segue a ordem do hook (integrity,
 *      push-suite, lint-loader, guard-gates, fuzz-precommit,
 *      batch-coverage) - nunca interleaved, a vantagem do batch sobre o
 *      paralelo.
 * O REAL-REPO CONTRACT test roda o batch SEM env override (repo real limpo)
 * e asserta exit 0 + os 6 veredictos clean - o lock de regressao.
 *
 * Subprocess-heavy (todo teste spawna o CLI via runSubprocess) -> timeout
 * EXPLICITO em todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { ENCODING_CI_NET, GUARD_PR_TWIN, GUARD_PUSH_NET, cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "run-precommit-guards.mjs")

function runBatch(env?: Record<string, string>) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    ...(env ? { env } : {}),
  })
}

/** A synthetic root that FAILS scan-push-full-suite: full-suite in the Gate 3. */
function writeBadGate3(dir: string) {
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
  // The mapped Gate-3 MARKER stays present (pre-commit-tests.mjs --scope
  // push) so the ONLY violation is the full-suite line - the sole-failure
  // pin: a missing marker would ADD a 'GATE 3 MISSING' violation and muddy
  // which contract the isolation test is proving.
  fs.writeFileSync(
    path.join(dir, "scripts", "pre-push-gates.sh"),
    [
      "#!/usr/bin/env bash",
      'echo "-- Gate 3/3 --"',
      'node scripts/pre-commit-tests.mjs --scope push --since "${PRE_PUSH_REMOTE_SHA:-}"',
      "bun run test:unit",
      "",
    ].join("\n"),
  )
}

/** A synthetic root that FAILS check-node-modules-integrity: divergent react. */
function writeDivergentModules(dir: string) {
  fs.mkdirSync(path.join(dir, "node_modules", "react"), { recursive: true })
  fs.mkdirSync(path.join(dir, "node_modules", "react-dom"), { recursive: true })
  fs.writeFileSync(path.join(dir, "bun.lock"), `{\n  "lockfileVersion": 1,\n  "packages": {\n    "react": ["react@19.2.3", "https://registry.npmjs.com/react/-/x.tgz", {}],\n    "react-dom": ["react-dom@19.2.3", "https://registry.npmjs.com/react-dom/-/x.tgz", {}]\n  }\n}\n`)
  fs.writeFileSync(path.join(dir, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "19.2.8" }))
  fs.writeFileSync(path.join(dir, "node_modules", "react-dom", "package.json"), JSON.stringify({ name: "react-dom", version: "19.2.3" }))
}

/** A synthetic root that FAILS scan-lint-staged-loader: bun loader sem reversal note. */
function writeBunLoaderLintStaged(dir: string) {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "synthetic",
      "lint-staged": { "*.ts": ["bunx eslint --fix"] },
    }),
  )
}

/**
 * A synthetic root that FAILS scan-guard-gates: guard net sem test:guard step.
 * The pr-check.yml keeps the FUZZ job WITH the fuzz:ci step + the BENCHMARK
 * job WITH the run-benchmark step (sole-failure pin): the ONLY violation
 * must be the missing test:guard step - a missing fuzz/benchmark job would
 * ADD a 'FUZZ JOB MISSING'/'BENCHMARK JOB MISSING' line and muddy which
 * contract the isolation test is proving. The ci.yml keeps the utf8-check
 * call site (rule 8 scans ci.yml + pr-check.yml; a missing call site would
 * ADD an 'ENCODING CALL SITE MISSING' line - the same sole-failure
 * discipline).
 */
function writeBadGuardNet(dir: string) {
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, GUARD_PUSH_NET),
    ["name: guard-gates", "on:", "  push:", "    branches: [main, develop]", "jobs:", "  guard-gates:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo no test:guard", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(dir, GUARD_PR_TWIN),
    ["name: pr-check", "on:", "  pull_request:", "jobs:", "  utf8-check:", "    uses: ./.github/workflows/utf8-check.yml", "  fuzz:", "    name: Fuzz Tests", "    runs-on: ubuntu-latest", "    steps:", "      - name: Run fuzz tests", "        run: bun run fuzz:ci > fuzz-results.json", "  benchmark:", "    name: Geo Benchmark", "    runs-on: ubuntu-latest", "    steps:", "      - name: Run geo benchmark", "        run: |", "          node scripts/run-benchmark.mjs --type geo --json", "  fragile-guard:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo no test:guard", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(dir, ENCODING_CI_NET),
    ["name: ci", "on:", "  push:", "    branches: [main, develop]", "jobs:", "  utf8-check:", "    uses: ./.github/workflows/utf8-check.yml", ""].join("\n"),
  )
}

/** A synthetic root that FAILS scan-fuzz-precommit: --scope cached no .husky/pre-commit sem nota. */
function writeCachedFuzzInPrecommit(dir: string) {
  fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, ".husky", "pre-commit"),
    ["#!/usr/bin/env bash", "set -euo pipefail", "node scripts/run-mapped-fuzz.mjs --scope cached", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(dir, ".husky", "pre-push"),
    ['node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"', ""].join("\n"),
  )
}

describe("run-precommit-guards.mjs - batch runner dos 7 guards node (sec 11.13)", () => {
  afterEach(cleanupTempDirs)

  it("AGREGACAO + ISOLAMENTO: guard fora do batch (sintetico) -> exit 1, os outros 5 clean", () => {
    const dir = createTempDir("run-guards-")
    // A falha do scan-batch-coverage: um node guard spawnado direto no hook
    // sintetico que nao e o batch runner nem allowlisted (GROWTH, sec 11.16).
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".husky", "pre-commit"),
      ["#!/usr/bin/env bash", "node scripts/run-precommit-guards.mjs", "node scripts/scan-new-guard.mjs", ""].join("\n"),
    )
    const r = runBatch({ BATCH_COVERAGE_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("batch-coverage: GUARD OUTSIDE BATCH at .husky/pre-commit:3")
    expect(r.stdout).toContain("scan-new-guard.mjs")
    // ISOLAMENTO: os outros 5 guards escanearam o repo REAL (limpo) e
    // rodaram MESMO com o guard 6 falho - nenhuma falha esconde as demais.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("fuzz-precommit: clean")
  }, 60000)

  it("REAL-REPO CONTRACT: sem env override -> exit 0, TODOS os 7 veredictos clean na ORDEM do hook", () => {
    const r = runBatch()
    expect(r.status).toBe(0)
    // Determinismo: a ordem do hook (integrity, push-suite, lint-loader,
    // guard-gates, fuzz-precommit, batch-coverage, prepush-batch) - nunca
    // interleaved (a vantagem do batch sobre o paralelo).
    const cleanIdx = [
      "check-node-modules-integrity: clean",
      "push-suite: clean",
      "lint-staged-loader: clean",
      "guard-gates: clean",
      "fuzz-precommit: clean",
      "batch-coverage: clean",
      "prepush-batch: clean",
    ].map((v) => r.stdout.indexOf(v))
    expect(cleanIdx.every((i) => i >= 0)).toBe(true)
    expect(cleanIdx[0]).toBeLessThan(cleanIdx[1])
    expect(cleanIdx[1]).toBeLessThan(cleanIdx[2])
    expect(cleanIdx[2]).toBeLessThan(cleanIdx[3])
    expect(cleanIdx[3]).toBeLessThan(cleanIdx[4])
    expect(cleanIdx[4]).toBeLessThan(cleanIdx[5])
    expect(cleanIdx[5]).toBeLessThan(cleanIdx[6])
  }, 60000)

  it("AGREGACAO + ISOLAMENTO: push-suite falha (sintetico) -> exit 1, os outros 3 rodam e reportam clean", () => {
    const dir = createTempDir("run-guards-")
    writeBadGate3(dir)
    const r = runBatch({ PUSH_SUITE_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    // A falha do guard apontado para o repo sintetico aparece (worst-exit).
    // Line 4 (shebang=1, echo=2, marker=3, bun run test:unit=4).
    expect(r.stdout).toContain("FULL-SUITE in scripts/pre-push-gates.sh:4")
    expect(r.stdout).toContain("bun run test:unit")
    // ISOLAMENTO: os outros 3 guards escanearam o repo REAL (limpo) e
    // rodaram MESMO com o guard 2 falho - nenhuma falha esconde as demais.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
    expect(r.stdout).toContain("guard-gates: clean")
  }, 60000)

  it("AGREGACAO + ISOLAMENTO: node-modules divergente (sintetico) -> exit 1, os outros 3 clean", () => {
    const dir = createTempDir("run-guards-")
    writeDivergentModules(dir)
    const r = runBatch({ NODE_MODULES_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DIVERGENT react installed=19.2.8 locked=19.2.3")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
    expect(r.stdout).toContain("guard-gates: clean")
  }, 60000)

  it("AGREGACAO + ISOLAMENTO: bun loader no lint-staged (sintetico) -> exit 1, os outros 3 clean", () => {
    const dir = createTempDir("run-guards-")
    writeBunLoaderLintStaged(dir)
    const r = runBatch({ LINT_LOADER_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("lint-staged-loader: BUN LOADER for eslint in lint-staged")
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("guard-gates: clean")
  }, 60000)

  it("AGREGACAO + ISOLAMENTO: guard net sem test:guard (sintetico) -> exit 1, os outros 4 clean", () => {
    const dir = createTempDir("run-guards-")
    writeBadGuardNet(dir)
    const r = runBatch({ GUARD_GATES_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`guard-gates: TEST GUARD STEP MISSING in ${GUARD_PUSH_NET}`)
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
    expect(r.stdout).toContain("fuzz-precommit: clean")
  }, 60000)

  it("AGREGACAO + ISOLAMENTO: --scope cached no pre-commit (sintetico) -> exit 1, os outros 4 clean", () => {
    const dir = createTempDir("run-guards-")
    writeCachedFuzzInPrecommit(dir)
    const r = runBatch({ FUZZ_PRECOMMIT_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("fuzz-precommit: FUZZ IN PRE-COMMIT (--scope cached) at .husky/pre-commit:3")
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
    expect(r.stdout).toContain("guard-gates: clean")
  }, 60000)
})
