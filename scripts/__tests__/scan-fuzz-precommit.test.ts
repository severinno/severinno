/**
 * scan-fuzz-precommit.mjs - guard do veredito ADOTADO da 11.11 (2026-08-10):
 * o run-mapped-fuzz.mjs NAO pode ganhar um modo --scope cached wired no
 * .husky/pre-commit sem uma secao numerada 11.x com ADOTADO + re-mediacao
 * datada (o padrao do scan-lint-staged-loader da 11.7).
 *
 * Hermetic tests via FUZZ_PRECOMMIT_SCAN_ROOT (the same env-override pattern
 * as LINT_LOADER_SCAN_ROOT): each test builds an isolated temp dir with fake
 * .husky/pre-commit + .husky/pre-push (+ optional docs/gates-proofs.md for
 * the reversal-note contract), then runs the CLI with env override.
 *
 * The guard is BIDIRECTIONAL:
 * - NEGATIVE (must NOT appear): `run-mapped-fuzz.mjs --scope cached` in ANY
 *   non-comment line of .husky/pre-commit, unless a dated
 *   '## 11.x ... fuzz ... ADOTADO' section header exists in gates-proofs.md
 *   (the documented re-mediation that would reverse the verdict).
 * - POSITIVE (must exist): the mapped fuzz gate in .husky/pre-push
 *   (`run-mapped-fuzz.mjs --since` - the push scope). Deleting the gate
 *   fails with 'FUZZ GATE MISSING'.
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * .husky/pre-commit + .husky/pre-push and asserts clean - if someone wires
 * a cached-scope fuzz invocation into the pre-commit without the dated
 * ADOTADO reversal section, that test fails in CI (it runs under test:unit
 * AND test:guard / the guard-gates push net, same as scan-lint-staged-loader).
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, replaceEolAgnostic, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-fuzz-precommit.mjs")

function writeFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

function runGuard(dir: string) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    env: { FUZZ_PRECOMMIT_SCAN_ROOT: dir },
  })
}

/** A legitimate .husky/pre-commit: NO fuzz, deterministic unit test (sec 11.11). */
const CLEAN_PRE_COMMIT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "bash scripts/verify-encoding.sh --dry-run --ci src/",
  "node scripts/run-precommit-guards.mjs",
  "bun run pre-commit:test",
  "",
].join("\n")

/** A legitimate .husky/pre-push: the mapped fuzz gate with --since (the push scope). */
const CLEAN_PRE_PUSH = [
  "#!/usr/bin/env bash",
  'node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"',
  "",
].join("\n")

/** Write a full synthetic repo with both hooks clean. */
function writeCleanRepo(dir: string) {
  writeFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT)
  writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH)
}

describe("scan-fuzz-precommit.mjs - fuzz pre-push-only (sec 11.11, padrao 11.7)", () => {
  afterEach(cleanupTempDirs)

  it("clean: pre-commit sem fuzz + pre-push com o gate mapeado -> exit 0", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: run-mapped-fuzz --scope cached no .husky/pre-commit -> exit 1 com o caminho exato (file:line + conteudo)", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    // O commit passaria a rodar a rede estocastica do fuzz (o modo cached
    // que o runner nao tem hoje - parseSince ignora --scope, fuzz-mapped.ts).
    writeFile(
      dir,
      ".husky/pre-commit",
      CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --scope cached\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    // CLEAN_PRE_COMMIT has 6 lines incl. the trailing-newline empty line, so
    // the appended line lands at 7 - the exact line the guard reports.
    expect(r.stdout).toContain("FUZZ IN PRE-COMMIT (--scope cached) at .husky/pre-commit:7")
    expect(r.stdout).toContain("run-mapped-fuzz.mjs --scope cached")
  }, 60000)

  it("MUTATION: forma --scope=cached (sinal de igual) tambem tripa", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    writeFile(
      dir,
      ".husky/pre-commit",
      CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --scope=cached\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ IN PRE-COMMIT (--scope cached)")
  }, 60000)

  it("count-pin: exatamente 1 violacao p/ 1 linha injetada, com linha exata (fonte unica de falha)", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    writeFile(
      dir,
      ".husky/pre-commit",
      CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --scope cached\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout.match(/FUZZ IN PRE-COMMIT/g)?.length).toBe(1)
    expect(r.stdout).toContain(".husky/pre-commit:7")
  }, 60000)

  it("comentario com --scope cached NAO tripa (o header do hook explica o POR QUE em prosa)", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    writeFile(
      dir,
      ".husky/pre-commit",
      "# o run-mapped-fuzz.mjs --scope cached ficaria fora (sec 11.11, pre-push only)\n" + CLEAN_PRE_COMMIT,
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("NOTA presente: --scope cached + secao '## 11.x ... fuzz ... ADOTADO' no doc -> exit 0 (veredito re-mediado)", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --scope cached\n")
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.16 fuzz no commit - ADOTADO (medicao 2026-08-10)\nre-mediado: commit passou a rodar o fuzz mapeado; tabela na secao\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("prosa explicando a regra NAO satisfaz a nota (o marcador exige HEADER de secao 11.x com ADOTADO)", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-commit", CLEAN_PRE_COMMIT + "\nnode scripts/run-mapped-fuzz.mjs --scope cached\n")
    // A adocao legitima da 11.11/11.12 tem 'Fuzz' no header mas NUNCA
    // ADOTADO na MESMA linha - nao satisfaz a nota de reversao.
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.11 Fuzz mapeado por diff - avaliacao (medicao 2026-08-10)\nprosa: se um dia o fuzz for adotado no commit, adicione uma secao numerada 11.x declarando ADOTADO com a re-mediacao\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ IN PRE-COMMIT")
  }, 60000)

  it("FUZZ GATE DELETADO: pre-push sem run-mapped-fuzz --since -> exit 1 com 'FUZZ GATE MISSING' (assert positivo)", () => {
    const dir = createTempDir("fuzz-precommit-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", replaceEolAgnostic(CLEAN_PRE_PUSH, 'node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"\n', "", "pre-push fuzz line"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ GATE MISSING in .husky/pre-push")
    expect(r.stdout.match(/FUZZ IN PRE-COMMIT/g)?.length ?? 0).toBe(0)
  }, 60000)

  it("root sintetico sem hooks -> clean (nao escaneavel, postura do scan-push-full-suite)", () => {
    const dir = createTempDir("fuzz-precommit-")
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("REAL-REPO CONTRACT: hooks reais limpos hoje -> exit 0 + estado pino (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    // O gate mapeado existe de fato no pre-push real (o pin positivo vivo).
    const prePush = fs.readFileSync(path.join(process.cwd(), ".husky", "pre-push"), "utf8")
    expect(prePush).toContain("run-mapped-fuzz.mjs --since")
  }, 60000)
})
