/**
 * scan-push-full-suite.mjs - guard do Gate 3 do pre-push (2026-08)
 *
 * Hermetic tests via PUSH_SUITE_SCAN_ROOT (the same env-override pattern as
 * FRAGILE_SCAN_ROOT): each test builds an isolated temp dir with a fake
 * scripts/pre-push-gates.sh, then runs the CLI with env override. The .husky
 * file is absent in the synthetic roots (the scanner skips missing files).
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * scripts/pre-push-gates.sh + .husky/pre-push and asserts clean - if someone
 * ever re-adds a full-suite invocation (test:unit / vitest run / bare bun run
 * test) to the Gate 3 path, that test fails in CI (it runs under test:unit
 * AND test:guard / the guard-gates push net).
 *
 * The guard is BIDIRECTIONAL (the reviewer's actionable): it is not only
 * NEGATIVE (full-suite invocations fail) but also POSITIVE - scripts/
 * pre-push-gates.sh MUST contain the mapped Gate 3 marker
 * (pre-commit-tests.mjs --scope push). Deleting the Gate 3 step entirely
 * (a push with no tests at all) now fails with 'GATE 3 MISSING'. The
 * GATE-3-MARKER test below locks that path.
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-push-full-suite.mjs")

function writeGuardFile(dir: string, content: string) {
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
  fs.writeFileSync(path.join(dir, "scripts", "pre-push-gates.sh"), content)
}

function runGuard(dir: string) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    env: { PUSH_SUITE_SCAN_ROOT: dir },
  })
}

/** The legitimate Gate 3 (area-mapped, sec 8.4): 5 lines incl. trailing newline. */
const CLEAN_GATE3 = [
  "#!/usr/bin/env bash",
  'echo "-- Gate 3/3: testes unitarios das areas tocadas --"',
  'node scripts/pre-commit-tests.mjs --scope push --since "${PRE_PUSH_REMOTE_SHA:-}"',
  'echo "[OK] pre-push: todos os gates passaram"',
  "",
].join("\n")

describe("scan-push-full-suite.mjs - Gate 3 nunca roda a suite completa (sec 8.4)", () => {
  afterEach(cleanupTempDirs)

  it("clean: Gate 3 legitimo (pre-commit-tests.mjs mapeado) -> exit 0", () => {
    const dir = createTempDir("push-suite-")
    writeGuardFile(dir, CLEAN_GATE3)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: test:unit no Gate 3 -> exit 1 com o caminho exato (file:line + conteudo)", () => {
    const dir = createTempDir("push-suite-")
    writeGuardFile(dir, CLEAN_GATE3 + "\nbun run test:unit\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FULL-SUITE in scripts/pre-push-gates.sh:6")
    expect(r.stdout).toContain("bun run test:unit")
  }, 60000)

  it("MUTATION: vitest run bare (sem arquivos mapeados) -> exit 1", () => {
    const dir = createTempDir("push-suite-")
    writeGuardFile(dir, CLEAN_GATE3 + "\nnpx vitest run --config vitest.config.unit.ts\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FULL-SUITE in scripts/pre-push-gates.sh:6")
  }, 60000)

  it("comentario com test:unit NAO tripa (a prosa do header e permitida)", () => {
    const dir = createTempDir("push-suite-")
    writeGuardFile(dir, "# bun run test:unit seria a suite completa\n" + CLEAN_GATE3)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("test:guard fora de escopo (par fixo do push net, nao a suite completa) -> nao tripa", () => {
    const dir = createTempDir("push-suite-")
    writeGuardFile(dir, CLEAN_GATE3 + "\nbun run test:guard\n")
    const r = runGuard(dir)
    expect(r.status).toBe(0)
  }, 60000)

  it("GATE 3 DELETADO: sem o marcador pre-commit-tests.mjs --scope push -> exit 1 com 'GATE 3 MISSING' (assert positivo)", () => {
    const dir = createTempDir("push-suite-")
    writeGuardFile(dir, ["#!/usr/bin/env bash", 'echo "-- Gate 3/3: testes unitarios --"', ""].join("\n"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GATE 3 MISSING in scripts/pre-push-gates.sh")
    expect(r.stdout).toContain("pre-commit-tests.mjs --scope push required")
  }, 60000)

  it("REAL-REPO CONTRACT: os arquivos reais estao limpos hoje -> exit 0 (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)
})
