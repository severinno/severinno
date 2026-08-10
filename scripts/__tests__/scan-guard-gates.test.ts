/**
 * scan-guard-gates.mjs - guard do CONTRATO do push net guard-gates.yml
 * (2026-08): a rede que valida a premissa da recalibracao 8.4/11.11.
 *
 * Hermetic tests via GUARD_GATES_SCAN_ROOT (the same env-override pattern as
 * PUSH_SUITE_SCAN_ROOT / FRAGILE_SCAN_ROOT): each test builds an isolated
 * temp dir with a fake .github/workflows/guard-gates.yml + package.json,
 * then runs the CLI with env override.
 *
 * The guard is BIDIRECTIONAL:
 * - NEGATIVE (must NOT appear): a `paths:`/`paths-ignore:` filter in the
 *   workflow's on.push (the "NO paths filter BY DESIGN" decision - the scan
 *   surface is DERIVED from TARGET_DIRS, so a filter would create the drift
 *   point the SPREAD CONTRACT eliminates, and a push touching only a new
 *   surface the filter forgot would silently skip the net).
 * - POSITIVE (must exist): the `bun run test:guard` step in the workflow
 *   (the push net itself) AND the scan-push-full-suite.test.ts suite in the
 *   package.json test:guard script (the 8.4 REAL-REPO CONTRACT lock).
 *   Deleting either fails with 'TEST GUARD STEP MISSING' / 'GUARD SUITE
 *   MISSING'.
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * .github/workflows/guard-gates.yml + package.json and asserts clean - if
 * someone re-adds a paths filter, removes the test:guard step, or drops the
 * scan-push-full-suite suite from test:guard, that test fails in CI (it
 * runs under test:unit AND test:guard / the guard-gates push net).
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-guard-gates.mjs")

function writeFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

/** Write a synthetic guard-gates.yml WITHOUT a paths filter (the clean base). */
function writeWorkflow(dir: string, extra = "") {
  writeFile(
    dir,
    ".github/workflows/guard-gates.yml",
    [
      "name: Guard Gates",
      "on:",
      "  push:",
      "    branches: [main, develop]",
      "jobs:",
      "  guard-gates:",
      "    steps:",
      "      - name: Run guard vitest suites (BASELINE + divergence guards)",
      "        run: bun run test:guard",
      "",
    ].join("\n") + extra,
  )
}

/** Write a synthetic package.json whose test:guard keeps the 8.4 suite. */
function writePkg(dir: string, testGuard = "vitest run scripts/__tests__/scan-push-full-suite.test.ts --config vitest.config.unit.ts") {
  writeFile(
    dir,
    "package.json",
    JSON.stringify({ name: "synthetic", scripts: { "test:guard": testGuard } }, null, 2),
  )
}

/** Write a clean synthetic repo (workflow without filter + pkg with the suite). */
function writeCleanRepo(dir: string) {
  writeWorkflow(dir)
  writePkg(dir)
}

function runGuard(dir: string) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    env: { GUARD_GATES_SCAN_ROOT: dir },
  })
}

describe("scan-guard-gates.mjs - push net guard-gates.yml incondicional (sec 8.4/11.11)", () => {
  afterEach(cleanupTempDirs)

  it("clean: workflow sem paths filter + test:guard step + suite no test:guard -> exit 0", () => {
    const dir = createTempDir("guard-gates-")
    writeCleanRepo(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: paths: filter no on.push -> exit 1 com o caminho exato (file:line + conteudo)", () => {
    const dir = createTempDir("guard-gates-")
    // A fixture tem 9 linhas de conteudo + a linha 10 do filtro (o ultimo
    // elemento vazio do array vira o \n final antes do extra)
    writeWorkflow(dir, "        paths:\n          - 'scripts/**'\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("PATHS FILTER in .github/workflows/guard-gates.yml:10")
    expect(r.stdout).toContain("paths:")
  }, 60000)

  it("MUTATION: paths-ignore: filter -> exit 1 (a mesma classe, o filtro NEGATIVO do on.push)", () => {
    const dir = createTempDir("guard-gates-")
    writeWorkflow(dir, "        paths-ignore:\n          - 'docs/**'\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("PATHS FILTER in .github/workflows/guard-gates.yml:10")
    expect(r.stdout).toContain("paths-ignore:")
  }, 60000)

  it("comentario com 'paths filter' NAO tripa (o header do workflow explica o POR QUE em prosa)", () => {
    const dir = createTempDir("guard-gates-")
    writeWorkflow(dir, "# NO paths filter BY DESIGN - a surface escaneada e derivada dos TARGET_DIRS\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: step test:guard removido do workflow -> exit 1 com 'TEST GUARD STEP MISSING' (assert positivo)", () => {
    const dir = createTempDir("guard-gates-")
    writeFile(
      dir,
      ".github/workflows/guard-gates.yml",
      [
        "name: Guard Gates",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  guard-gates:",
        "    steps:",
        "      - name: lint",
        "        run: bun run lint",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("TEST GUARD STEP MISSING")
  }, 60000)

  it("MUTATION: scan-push-full-suite removido do test:guard -> exit 1 com 'GUARD SUITE MISSING' (assert positivo)", () => {
    const dir = createTempDir("guard-gates-")
    writeWorkflow(dir)
    writePkg(dir, "vitest run scripts/__tests__/fragile-range-guard.test.ts --config vitest.config.unit.ts")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD SUITE MISSING")
    expect(r.stdout).toContain("scan-push-full-suite.test.ts")
  }, 60000)

  it("MUTATION: test:guard script deletado do package.json -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("guard-gates-")
    writeWorkflow(dir)
    writeFile(dir, "package.json", JSON.stringify({ name: "synthetic", scripts: {} }, null, 2))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD SUITE MISSING")
  }, 60000)

  it("MUTATION: workflow DELETADO (so package.json) -> exit 1 com 'WORKFLOW MISSING' (a rede orfa nao passa em silencio)", () => {
    const dir = createTempDir("guard-gates-")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("WORKFLOW MISSING")
    expect(r.stdout).toContain("guard-gates.yml")
  }, 60000)

  it("package.json ausente (root sintetico minimo) -> clean (sem pkg = sem suite para validar)", () => {
    const dir = createTempDir("guard-gates-")
    writeWorkflow(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("REAL-REPO CONTRACT: guard-gates.yml real sem paths filter + test:guard com a suite -> exit 0 (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    // Pin the actual state: the workflow has no paths filter AND the step
    // exists AND the suite is in test:guard (the premise of 8.4/11.11).
    const wf = fs.readFileSync(
      path.join(process.cwd(), ".github", "workflows", "guard-gates.yml"),
      "utf8",
    )
    expect(wf).not.toMatch(/^\s*paths(?:-ignore)?:/m)
    expect(wf).toMatch(/bun\s+run\s+test:guard/)
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))
    expect(pkg.scripts["test:guard"]).toContain("scan-push-full-suite.test.ts")
  }, 60000)
})
