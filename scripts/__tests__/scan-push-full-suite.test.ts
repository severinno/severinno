/**
 * scan-push-full-suite.mjs - guard de CONTRATOS dos gates de custo nos hooks
 * (2026-08): Gate 3 mapeado + fuzz:ci pre-push-only + encoding gate unico +
 * divisao commit/push da 11.11.
 *
 * Hermetic tests via PUSH_SUITE_SCAN_ROOT (the same env-override pattern as
 * FRAGILE_SCAN_ROOT): each test builds an isolated temp dir with fake hook
 * files, then runs the CLI with env override. Missing files are skipped (a
 * synthetic root may omit one).
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * scripts/pre-push-gates.sh + .husky/pre-push + .husky/pre-commit + (since
 * contrato #6) package.json + scripts/run-mapped-fuzz.mjs and asserts clean
 * - if someone ever re-adds a full-suite invocation (test:unit / vitest run
 * / bare bun run test) to the Gate 3 path, moves fuzz:ci/run-mapped-fuzz
 * into the pre-commit, removes the mapped fuzz gate from the pre-push,
 * swaps verify-encoding.sh for check-utf8.sh in a hook, or blurs the
 * commit/push division (pre-commit:test com --scope push no package.json,
 * pre-commit:test fora do hook, runner sem --since), that test fails in CI
 * (it runs under test:unit AND test:guard / the guard-gates push net).
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
import { cleanupTempDirs, createTempDir, replaceEolAgnostic, runSubprocess } from "./golden-copy-utils"

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

/** A legitimate .husky/pre-commit: verify-encoding gate, NO fuzz, guards node BATCHADOS (sec 11.13) + pre-commit:test cached (sec 11.11). */
const CLEAN_PRE_COMMIT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "bash scripts/verify-encoding.sh --dry-run --ci src/",
  "node scripts/run-precommit-guards.mjs",
  "bun run pre-commit:test",
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
    // CLEAN_PRE_COMMIT has 6 lines incl. the trailing-newline empty line, so
    // the appended line lands at 7 - the exact line the guard reports.
    expect(r.stdout).toContain("CONTRACT 'fuzz mapeado pre-push-only' VIOLATED in .husky/pre-commit:7")
    expect(r.stdout).toContain("bun run fuzz:ci")
  }, 60000)

  it("MUTATION: run-mapped-fuzz no .husky/pre-commit -> exit 1 (o runner de fuzz tambem e pre-push-only)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --since ${PRE_PUSH_REMOTE_SHA:-}\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'fuzz mapeado pre-push-only' VIOLATED in .husky/pre-commit:7")
    expect(r.stdout).toContain("run-mapped-fuzz")
  }, 60000)

  it("FUZZ GATE DELETADO: sem run-mapped-fuzz no .husky/pre-push -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(dir, ".husky/pre-push", replaceEolAgnostic(CLEAN_PRE_PUSH, 'node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"\n', "", "pre-push fuzz line"))
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
    writeGuardFile(dir, ".husky/pre-commit", replaceEolAgnostic(CLEAN_PRE_COMMIT, "bash scripts/verify-encoding.sh --dry-run --ci src/\n", "", "pre-commit encoding line"))
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

  it("MUTATION: um guard node spawnado INDIVIDUALMENTE no .husky/pre-commit (4 boots, sec 11.13) -> exit 1 com o caminho exato", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    // The batch runner line swapped back to an individual spawn = the cost
    // regression the batch exists to kill (4 node boots ~0.54-0.81s vs 1
    // boot ~0.22-0.26s). The swapped line keeps its position at 4.
    writeGuardFile(
      dir,
      ".husky/pre-commit",
      CLEAN_PRE_COMMIT.replace("node scripts/run-precommit-guards.mjs", "node scripts/scan-push-full-suite.mjs"),
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'guards node batchados (1 invocacao)' VIOLATED in .husky/pre-commit:4")
    expect(r.stdout).toContain("node scripts/scan-push-full-suite.mjs")
  }, 60000)

  it("BATCH DELETADO: sem run-precommit-guards.mjs no .husky/pre-commit -> exit 1 (assert positivo - guards voltariam a custar 4 boots)", () => {
    const dir = createTempDir("push-suite-")
    writeCleanRepo(dir)
    writeGuardFile(
      dir,
      ".husky/pre-commit",
      replaceEolAgnostic(CLEAN_PRE_COMMIT, "node scripts/run-precommit-guards.mjs\n", "", "pre-commit guards line"),
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("CONTRACT 'guards node batchados (1 invocacao)' MISSING in .husky/pre-commit")
  }, 60000)
})

describe("scan-push-full-suite.mjs - Gate 3 mapeado por co-location (secao 11.15)", () => {
  afterEach(cleanupTempDirs)

  it("clean: mapper com SOURCE_RE ts/tsx/mjs presente -> exit 0 (contrato 5 nao tripa)", () => {
    const dir = createTempDir("push-suite-coloc-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "scripts/pre-commit-tests.mjs", "const SOURCE_RE = /\\.(ts|tsx|mjs)$/\n")
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: SOURCE_RE com .sh (gate file mapearia a suite co-localizada pesada) -> exit 1 com o contrato e o caminho exato", () => {
    const dir = createTempDir("push-suite-coloc-")
    writeCleanRepo(dir)
    // Adicionar '.sh' ao SOURCE_RE = tocar scripts/verify-encoding.sh
    // passaria a mapear scripts/__tests__/verify-encoding.test.ts (~36.5s,
    // sec 11.14) em todo push de gate files - o custo comum viraria ~77s.
    writeGuardFile(dir, "scripts/pre-commit-tests.mjs", "const SOURCE_RE = /\\.(ts|tsx|mjs|sh)$/\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(
      "CONTRACT 'gate 3 mapeado por co-location (SOURCE_RE ts/tsx/mjs, sem gate files)' VIOLATED in scripts/pre-commit-tests.mjs:1",
    )
    expect(r.stdout).toContain("SOURCE_RE = /\\.(ts|tsx|mjs|sh)$/")
  }, 60000)

  it("MUTATION: superficie de origem MUDADA (positivo nao casa) -> exit 1 com 'MISSING'", () => {
    const dir = createTempDir("push-suite-coloc-")
    writeCleanRepo(dir)
    // A superficie deixou de ser exatamente ts/tsx/mjs - o pin positivo
    // (a declaracao SOURCE_RE exata) nao casa -> MISSING.
    writeGuardFile(dir, "scripts/pre-commit-tests.mjs", "const SOURCE_RE = /\\.(tsx|mjs)$/\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(
      "CONTRACT 'gate 3 mapeado por co-location (SOURCE_RE ts/tsx/mjs, sem gate files)' MISSING in scripts/pre-commit-tests.mjs",
    )
  }, 60000)
})

describe("scan-push-full-suite.mjs - divisao commit/push (secao 11.11): pre-commit:test cached deterministico vs run-mapped-fuzz --since so", () => {
  afterEach(cleanupTempDirs)

  /** A legitimate package.json: pre-commit:test wired SEM --scope (default cached/staged). */
  const CLEAN_PACKAGE_JSON = [
    "{",
    '  "scripts": {',
    '    "pre-commit:test": "node scripts/pre-commit-tests.mjs",',
    '    "pre-push:gates": "bash scripts/pre-push-gates.sh"',
    "  }",
    "}",
    "",
  ].join("\n")

  /** A legitimate runner: parseSince reading --since (the push scope). */
  const CLEAN_RUNNER = [
    "export function parseSince(argv) {",
    "  for (let i = 0; i < argv.length; i++) {",
    '    if (argv[i] === "--since") return argv[i + 1] ?? ""',
    "  }",
    '  return ""',
    "}",
    "",
  ].join("\n")

  it("clean: package.json + runner + hook com a divisao commit/push correta -> exit 0", () => {
    const dir = createTempDir("push-suite-div-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "package.json", CLEAN_PACKAGE_JSON)
    writeGuardFile(dir, "scripts/run-mapped-fuzz.mjs", CLEAN_RUNNER)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: pre-commit:test com --scope push no package.json (commit viraria estocastico) -> exit 1 com o caminho exato", () => {
    const dir = createTempDir("push-suite-div-")
    writeCleanRepo(dir)
    // O script pre-commit:test ganhou --scope push: o commit rodaria o
    // escopo do push (staged + HEAD + range) em vez do cached deterministico
    // (staged) - a quebra da divisao da 11.11 que o contrato #6 trava.
    writeGuardFile(
      dir,
      "package.json",
      CLEAN_PACKAGE_JSON.replace(
        "node scripts/pre-commit-tests.mjs",
        "node scripts/pre-commit-tests.mjs --scope push",
      ),
    )
    writeGuardFile(dir, "scripts/run-mapped-fuzz.mjs", CLEAN_RUNNER)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(
      "CONTRACT 'divisao commit/push 11.11 (pre-commit:test cached deterministico; run-mapped-fuzz --since so)' VIOLATED in package.json:3",
    )
    expect(r.stdout).toContain("--scope push")
  }, 60000)

  it("MUTATION: pre-commit:test removido do package.json (commit sem teste deterministico) -> exit 1 'MISSING'", () => {
    const dir = createTempDir("push-suite-div-")
    writeCleanRepo(dir)
    writeGuardFile(
      dir,
      "package.json",
      replaceEolAgnostic(CLEAN_PACKAGE_JSON, '    "pre-commit:test": "node scripts/pre-commit-tests.mjs",\n', "", "package pre-commit:test line"),
    )
    writeGuardFile(dir, "scripts/run-mapped-fuzz.mjs", CLEAN_RUNNER)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(
      "CONTRACT 'divisao commit/push 11.11 (pre-commit:test cached deterministico; run-mapped-fuzz --since so)' MISSING in package.json",
    )
  }, 60000)

  it("MUTATION: bun run pre-commit:test fora do .husky/pre-commit (commit sem teste nas areas tocadas) -> exit 1 'MISSING'", () => {
    const dir = createTempDir("push-suite-div-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "package.json", CLEAN_PACKAGE_JSON)
    writeGuardFile(dir, "scripts/run-mapped-fuzz.mjs", CLEAN_RUNNER)
    writeGuardFile(dir, ".husky/pre-commit", replaceEolAgnostic(CLEAN_PRE_COMMIT, "bun run pre-commit:test\n", "", "pre-commit pre-commit:test line"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(
      "CONTRACT 'divisao commit/push 11.11 (pre-commit:test cached deterministico; run-mapped-fuzz --since so)' MISSING in .husky/pre-commit",
    )
  }, 60000)

  it("MUTATION: parseSince do runner nao le mais --since (fuzz sem diff do push) -> exit 1 'MISSING'", () => {
    const dir = createTempDir("push-suite-div-")
    writeCleanRepo(dir)
    writeGuardFile(dir, "package.json", CLEAN_PACKAGE_JSON)
    // parseSince trocado por uma logica que nao le --since (ex.: --scope)
    // - o runner perderia o escopo do push e rodaria o fallback FULL em todo
    // push (ou um modo cached, a divisao confusa da 11.11).
    writeGuardFile(
      dir,
      "scripts/run-mapped-fuzz.mjs",
      CLEAN_RUNNER.replace('if (argv[i] === "--since") return argv[i + 1] ?? ""', 'if (argv[i] === "--scope") return argv[i + 1] ?? ""'),
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(
      "CONTRACT 'divisao commit/push 11.11 (pre-commit:test cached deterministico; run-mapped-fuzz --since so)' MISSING in scripts/run-mapped-fuzz.mjs",
    )
  }, 60000)
})
