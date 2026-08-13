/**
 * scan-batch-coverage.mjs - guard do CONTRATO DE CRESCIMENTO do batch runner
 * (2026-08, secao 11.16): TODO node guard novo do pre-commit DEVE entrar no
 * batch runner - um guard adicionado como spawn direto no .husky/pre-commit
 * sem entrar no batch = falha com o caminho exato.
 *
 * Hermetic tests via BATCH_COVERAGE_SCAN_ROOT (the same env-override pattern
 * as PUSH_SUITE_SCAN_ROOT / GUARD_GATES_SCAN_ROOT): each test builds a
 * synthetic temp repo with a .husky/pre-commit (+ optionally a copy of the
 * batch runner) and runs the CLI with the override.
 *
 * The guard is BIDIRECTIONAL:
 * - NEGATIVO: um spawn `node scripts/X.mjs` direto no pre-commit onde X NAO
 *   e o batch runner. Subclasses: 'ALREADY BATCHED' (X esta no batch
 *   DERIVADO dos imports vivos do runner - o spawn direto e redundante,
 *   double-run) e 'GUARD OUTSIDE BATCH' (X nao esta no batch nem na
 *   HOOK_ALLOWLIST - o guard novo precisa ENTRAR no batch).
 * - POSITIVO: o batch runner DEVE estar wired (remover = 'BATCH RUNNER
 *   MISSING').
 * A HOOK_ALLOWLIST pina as 2 excecoes (scan-lucide-icons, check-next-types).
 *
 * SPREAD CONTRACT (o padrao dos TARGET_DIRS aplicado ao batch): a lista do
 * batch e DERIVADA dos imports do run-precommit-guards.mjs REAL (nao uma
 * lista hardcoded no guard) - o teste patcha uma temp copy do runner com um
 * 7o import e prova que um spawn direto desse guard futuro vira
 * 'ALREADY BATCHED' (derivado) em vez de 'GUARD OUTSIDE BATCH' - a derivacao
 * cobre guards futuros automaticamente.
 *
 * O REAL-REPO CONTRACT test roda o CLI contra o repo real e asserta exit 0
 * (o hook real tem so o batch runner + as 2 excecoes allowlisted) - o lock
 * de regressao: um guard novo spawnado direto no hook real falha aqui.
 *
 * Subprocess-heavy (todo teste spawna o CLI via runSubprocess) -> timeout
 * EXPLICITO em todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { deriveBatchGuards } from "../scan-batch-coverage.mjs"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-batch-coverage.mjs")
const RUNNER = path.resolve(process.cwd(), "scripts", "run-precommit-guards.mjs")
const BATCH_ANCHOR = 'import { main as batchCoverageMain } from "./scan-batch-coverage.mjs"'

function writeHook(dir: string, lines: string[]) {
  fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
  fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), lines.join("\n"))
}

/** The real hook shape: batch runner + the 2 allowlisted exceptions. */
function writeCleanHook(dir: string) {
  writeHook(dir, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "node scripts/scan-lucide-icons.mjs --check",
    "node scripts/check-next-types.mjs --fix",
    "node scripts/run-precommit-guards.mjs",
    "",
  ])
}

/**
 * Write a patched temp copy of the real runner with `extraImport` appended
 * after the batch-coverage import (the SPREAD fixture). Fails loudly on
 * anchor drift.
 */
function writePatchedRunner(dir: string, extraImport: string) {
  const src = fs.readFileSync(RUNNER, "utf8")
  if (!src.includes(BATCH_ANCHOR)) {
    throw new Error("SPREAD: batch-coverage import anchor missing in the real runner — update the harness")
  }
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "scripts", "run-precommit-guards.mjs"),
    src.replace(BATCH_ANCHOR, `${BATCH_ANCHOR}\n${extraImport}`),
  )
}

function runGuard(dir: string) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    env: { BATCH_COVERAGE_SCAN_ROOT: dir },
  })
}

describe("scan-batch-coverage.mjs - contrato de crescimento do batch (sec 11.16)", () => {
  afterEach(cleanupTempDirs)

  it("REAL-REPO CONTRACT: hook real (batch runner + allowlist) -> exit 0 clean (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("GROWTH: guard novo spawnado direto no pre-commit (nao no batch) -> exit 1 com 'GUARD OUTSIDE BATCH' + caminho exato", () => {
    const dir = createTempDir("batch-cov-")
    writeHook(dir, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "node scripts/run-precommit-guards.mjs",
      "node scripts/scan-new-guard.mjs --check",
      "",
    ])
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD OUTSIDE BATCH at .husky/pre-commit:4")
    expect(r.stdout).toContain("scan-new-guard.mjs")
    expect(r.stdout).toContain("add it to run-precommit-guards.mjs")
  }, 60000)

  it("ALREADY BATCHED: spawn direto de um guard QUE JA ESTA no batch (scan-push-full-suite) -> exit 1 (double-run redundante)", () => {
    const dir = createTempDir("batch-cov-")
    writePatchedRunner(dir, "") // copy the real runner (derives the 6)
    writeHook(dir, [
      "#!/usr/bin/env bash",
      "node scripts/run-precommit-guards.mjs",
      "node scripts/scan-push-full-suite.mjs",
      "",
    ])
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("ALREADY BATCHED at .husky/pre-commit:3")
    expect(r.stdout).toContain("remove the redundant direct spawn")
  }, 60000)

  it("SPREAD CONTRACT: runner patcheado com import extra -> spawn direto do guard futuro vira 'ALREADY BATCHED' (derivado), nao 'GUARD OUTSIDE BATCH'", () => {
    const dir = createTempDir("batch-cov-")
    writePatchedRunner(dir, 'import { main as futureGuardMain } from "./scan-future-guard.mjs"')
    writeHook(dir, [
      "#!/usr/bin/env bash",
      "node scripts/run-precommit-guards.mjs",
      "node scripts/scan-future-guard.mjs",
      "",
    ])
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    // A derivacao dos imports vivos cobre o guard futuro - sem entry hardcoded.
    expect(r.stdout).toContain("ALREADY BATCHED at .husky/pre-commit:3")
    expect(r.stdout).toContain("scan-future-guard.mjs")
    expect(r.stdout).not.toContain("GUARD OUTSIDE BATCH")
  }, 60000)

  it("SPREAD CONTROL (sem o import): o MESMO guard futuro SEM o import no runner -> 'GUARD OUTSIDE BATCH' (a derivacao e o que cobre, nao o acaso)", () => {
    const dir = createTempDir("batch-cov-")
    writeHook(dir, [
      "#!/usr/bin/env bash",
      "node scripts/run-precommit-guards.mjs",
      "node scripts/scan-future-guard.mjs",
      "",
    ])
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD OUTSIDE BATCH at .husky/pre-commit:3")
  }, 60000)

  it("ALLOWLIST: as 2 excecoes (lucide + next-types) spawnadas direto -> clean (excecoes pinadas, nao acidente)", () => {
    const dir = createTempDir("batch-cov-")
    writeCleanHook(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("comentario com 'node scripts/scan-new-guard.mjs' em prosa NAO tripa (o header do hook explica o POR QUE)", () => {
    const dir = createTempDir("batch-cov-")
    writeHook(dir, [
      "#!/usr/bin/env bash",
      "# (node scripts/scan-new-guard.mjs - um guard futuro entraria no batch, sec 11.16)",
      "node scripts/run-precommit-guards.mjs",
      "",
    ])
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("POSITIVO: batch runner removido do pre-commit -> exit 1 com 'BATCH RUNNER MISSING' (os guards voltariam a custar N boots)", () => {
    const dir = createTempDir("batch-cov-")
    writeHook(dir, [
      "#!/usr/bin/env bash",
      "node scripts/scan-lucide-icons.mjs --check",
      "",
    ])
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("BATCH RUNNER MISSING in .husky/pre-commit")
  }, 60000)

  it("DERIVATION PIN: o runner REAL deriva exatamente os 12 guards (8 + o proprio batch-coverage + o exit-claims + o proof-helpers + o derived-inventory + o unit-config + o evidence-sweep) na ordem dos imports", () => {
    const src = fs.readFileSync(RUNNER, "utf8")
    expect(deriveBatchGuards(src)).toEqual([
      "check-node-modules-integrity.mjs",
      "scan-push-full-suite.mjs",
      "scan-lint-staged-loader.mjs",
      "scan-guard-gates.mjs",
      "scan-fuzz-precommit.mjs",
      "scan-batch-coverage.mjs",
      "scan-prepush-batch.mjs",
      "scan-exit-claims.mjs",
      "scan-proof-helpers.mjs",
      "scan-derived-inventory.mjs",
      "scan-unit-config.mjs",
      "scan-evidence-sweep.mjs",
    ])
  })

  it("root sintetico minimo sem .husky/pre-commit -> clean (sem hook = sem superficie, mesmo postura do scan-push-full-suite)", () => {
    const dir = createTempDir("batch-cov-")
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)
})
