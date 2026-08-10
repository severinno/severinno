/**
 * run-precommit-guards.mjs - batch runner dos 4 guards node do pre-commit
 * (2026-08, secao 11.13): uma UNICA invocacao node agrega os exit codes.
 *
 * Hermetic tests via the guards' OWN env overrides (PUSH_SUITE_SCAN_ROOT /
 * LINT_LOADER_SCAN_ROOT / GUARD_GATES_SCAN_ROOT / NODE_MODULES_ROOT - the
 * same env-override pattern as FRAGILE_SCAN_ROOT): each test points ONE
 * override at a synthetic temp repo that FAILS that guard, while the OTHER
 * three guards scan the REAL repo (clean today) - proving:
 *   1. AGREGACAO (worst-exit): um guard falho -> batch exit 1.
 *   2. ISOLAMENTO: os outros 3 guards RODAM MESMO ASSIM e reportam clean -
 *      uma falha nunca esconde as demais (a razao do batch sobre o hook
 *      antigo com `set -e`, que parava no 1o erro e escondia o resto).
 *   3. ORDER (determinismo): a saida segue a ordem do hook (integrity,
 *      push-suite, lint-loader, guard-gates) - nunca interleaved, a vantagem
 *      do batch sobre o paralelo.
 * O REAL-REPO CONTRACT test roda o batch SEM env override (repo real limpo)
 * e asserta exit 0 + os 4 veredictos clean - o lock de regressao.
 *
 * Subprocess-heavy (todo teste spawna o CLI via runSubprocess) -> timeout
 * EXPLICITO em todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

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

/** A synthetic root that FAILS scan-guard-gates: guard net sem test:guard step. */
function writeBadGuardNet(dir: string) {
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, ".github", "workflows", "guard-gates.yml"),
    ["name: guard-gates", "on:", "  push:", "    branches: [main, develop]", "jobs:", "  guard-gates:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo no test:guard", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(dir, ".github", "workflows", "pr-check.yml"),
    ["name: pr-check", "on:", "  pull_request:", "jobs:", "  fragile-guard:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo no test:guard", ""].join("\n"),
  )
}

describe("run-precommit-guards.mjs - batch runner dos 4 guards node (sec 11.13)", () => {
  afterEach(cleanupTempDirs)

  it("REAL-REPO CONTRACT: sem env override -> exit 0, TODOS os 4 veredictos clean na ORDEM do hook", () => {
    const r = runBatch()
    expect(r.status).toBe(0)
    // Determinismo: a ordem do hook (integrity, push-suite, lint-loader,
    // guard-gates) - nunca interleaved (a vantagem do batch sobre o paralelo).
    const cleanIdx = [
      "check-node-modules-integrity: clean",
      "push-suite: clean",
      "lint-staged-loader: clean",
      "guard-gates: clean",
    ].map((v) => r.stdout.indexOf(v))
    expect(cleanIdx.every((i) => i >= 0)).toBe(true)
    expect(cleanIdx[0]).toBeLessThan(cleanIdx[1])
    expect(cleanIdx[1]).toBeLessThan(cleanIdx[2])
    expect(cleanIdx[2]).toBeLessThan(cleanIdx[3])
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

  it("AGREGACAO + ISOLAMENTO: guard net sem test:guard (sintetico) -> exit 1, os outros 3 clean", () => {
    const dir = createTempDir("run-guards-")
    writeBadGuardNet(dir)
    const r = runBatch({ GUARD_GATES_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("guard-gates: TEST GUARD STEP MISSING in .github/workflows/guard-gates.yml")
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
  }, 60000)
})
