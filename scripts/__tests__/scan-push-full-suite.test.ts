/**
 * scan-push-full-suite.mjs - guard de CONTRATOS dos gates de custo nos hooks
 * (2026-08): Gate 3 mapeado + fuzz:ci pre-push-only + encoding gate unico.
 *
 * Hermetic tests via PUSH_SUITE_SCAN_ROOT (the same env-override pattern as
 * FRAGILE_SCAN_ROOT): each test builds an isolated temp dir with fake hook
 * files, then runs the CLI with env override. Missing files are skipped (a
 * synthetic root may omit one).
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * scripts/pre-push-gates.sh + .husky/pre-push + .husky/pre-commit and
 * asserts clean - if someone ever re-adds a full-suite invocation
 * (test:unit / vitest run / bare bun run test) to the Gate 3 path, moves
 * fuzz:ci/run-mapped-fuzz into the pre-commit, removes the mapped fuzz gate
 * from the pre-push, or swaps verify-encoding.sh for check-utf8.sh in a
 * hook, that test fails in CI (it runs under test:unit AND test:guard / the
 * guard-gates push net).
 *
 * The guard is BIDIRECTIONAL for every contract:
 * - NEGATIVE (must NOT appear): full-suite invocations in the Gate-3 files,
 *   fuzz:ci/run-mapped-fuzz in .husky/pre-commit, check-utf8.sh in the hooks.
 * - POSITIVE (must exist): the mapped Gate-3 marker in pre-push-gates.sh,
 *   run-mapped-fuzz.mjs --since in .husky/pre-push, verify-encoding.sh in
 *   both hooks.
 * Deleting a gate entirely now fails with a 'MISSING' assert.
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-push-full-suite.mjs")

function writeGuardFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
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

/** A legitimate .husky/pre-push: verify-encoding + mapped fuzz gate (sec 11.11) + Gate 3. */
const CLEAN_PRE_PUSH = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "bash scripts/verify-encoding.sh --dry-run --ci src/",
  'node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"',
  'echo "-- Gate 3/3 --"',
  'node scripts/pre-commit-tests.mjs --scope push --since "${PRE_PUSH_REMOTE_SHA:-}"',
  "",
].join("\n")

/** A legitimate .husky/pre-commit: verify-encoding gate, NO fuzz. */
const CLEAN_PRE_COMMIT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "bash scripts/verify-encoding.sh --dry-run --ci src/",
  "node scripts/scan-push-full-suite.mjs",
  "",
].join("\n")

/** Write a full synthetic repo with all three hook files clean. */
function writeCleanRepo(dir: string) {
  writeGuardFile(dir, "scripts/pre-push-gates.sh", CLEAN_GATE3)
  writeGuardFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH)
  writeGuardFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT)
}

describe("scan-push-full-suite.mjs - Gate 3 nunca roda a suite completa (sec 8.4)", () => {
  afterEach(cleanupTempDirs)

  it("clean: Gate 3 legitimo (pre-commit-tests.mjs mapeado) -> exit 0", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: test:unit no Gate 3 -> exit 1 com o caminho exato (file:line + conteudo)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "scripts/pre-push-gates.sh", CLEAN_GATE3 + "\nbun run test:unit\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FULL-SUITE in scripts/pre-push-gates.sh:6")
    expect(r.stdout).toContain("bun run test:unit")
  }, 60000)

  it("MUTATION: vitest run bare (sem arquivos mapeados) -> exit 1", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "scripts/pre-push-gates.sh", CLEAN_GATE3 + "\nnpx vitest run --config vitest.config.unit.ts\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FULL-SUITE in scripts/pre-push-gates.sh:6")
  }, 60000)

  it("comentario com test:unit NAO tripa (a prosa do header e permitida)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "scripts/pre-push-gates.sh", "# bun run test:unit seria a suite completa\n" + CLEAN_GATE3)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("test:guard fora de escopo (par fixo do push net, nao a suite completa) -> nao tripa", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "scripts/pre-push-gates.sh", CLEAN_GATE3 + "\nbun run test:guard\n")
    const r = runGuard(dir)
    expect(r.status).toBe(0)
  }, 60000)

  it("GATE 3 DELETADO: sem o marcador pre-commit-tests.mjs --scope push -> exit 1 com 'GATE 3 MISSING' (assert positivo)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "scripts/pre-push-gates.sh", ["#!/usr/bin/env bash", 'echo "-- Gate 3/3: testes unitarios --"', ""].join("\n"))
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

describe("scan-push-full-suite.mjs - contratos de gate (fuzz:ci + encoding, sec 8.4 nota 1)", () => {
  afterEach(cleanupTempDirs)

  it("MUTATION: fuzz:ci no .husky/pre-commit -> exit 1 com o caminho exato (file:line)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT + "\nbun run fuzz:ci\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    // CLEAN_PRE_COMMIT has 5 lines incl. the trailing-newline empty line, so
    // the appended line lands at 6 - the exact line the guard reports.
    expect(r.stdout).toContain("CONTRACT 'fuzz mapeado pre-push-only' VIOLATED in .husky/pre-commit:6")
    expect(r.stdout).toContain("bun run fuzz:ci")
  }, 60000)

  it("MUTATION: run-mapped-fuzz no .husky/pre-commit -> exit 1 (o runner de fuzz tambem e pre-push-only)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --since ${PRE_PUSH_REMOTE_SHA:-}\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'fuzz mapeado pre-push-only' VIOLATED in .husky/pre-commit:6")
    expect(r.stdout).toContain("run-mapped-fuzz")
  }, 60000)

  it("FUZZ GATE DELETADO: sem run-mapped-fuzz no .husky/pre-push -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH.replace('node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"\n', ""))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'fuzz mapeado pre-push-only' MISSING in .husky/pre-push")
  }, 60000)

  it("FUZZ GATE REGRESSIU para bun run fuzz:ci (o runner mapeado sumiu) -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH.replace('node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"', "bun run fuzz:ci"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'fuzz mapeado pre-push-only' MISSING in .husky/pre-push")
  }, 60000)

  it("ENCODING TROCADO: check-utf8.sh no .husky/pre-commit -> exit 1 (o bloco VPS_ASCII_FILES duplicado nao volta)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT.replace("verify-encoding.sh", "check-utf8.sh"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'encoding gate unico' VIOLATED in .husky/pre-commit:3")
    expect(r.stdout).toContain("check-utf8.sh")
  }, 60000)

  it("ENCODING REMOVIDO: sem verify-encoding.sh no .husky/pre-commit -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT.replace("bash scripts/verify-encoding.sh --dry-run --ci src/\n", ""))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'encoding gate unico' MISSING in .husky/pre-commit")
  }, 60000)

  it("comentario com fuzz NAO tripa (o header do pre-push explica por que o bash runner ficou fora)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(
      dir,
      ".husky/pre-commit",
      "# o bun run fuzz:ci NAO roda aqui (53s, sec 8.4) - pre-push only\n" + CLEAN_PRE_COMMIT,
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)
})
