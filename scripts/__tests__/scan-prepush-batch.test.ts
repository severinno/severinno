/**
 * scan-prepush-batch.mjs - guard do veredito da 11.17 (2026-08-10): o
 * pre-push NAO e batchado - o batch so passa a valer se o pre-push ganhar
 * um SEGUNDO node guard (<0.2s cada). O veredito vivia SO na doc; este
 * guard trava a condicao estruturalmente.
 *
 * Hermetic tests via PREPUSH_BATCH_SCAN_ROOT (the same env-override pattern
 * as FUZZ_PRECOMMIT_SCAN_ROOT): each test builds an isolated temp dir with
 * a fake .husky/pre-push (+ optional docs/gates-proofs.md for the
 * reversal-note contract), then runs the CLI with env override.
 *
 * The guard is BIDIRECTIONAL:
 * - NEGATIVE (INCONDITIONAL - must NOT appear): a node guard OUTSIDE the
 *   pinned set (ALLOWED_NODE_GUARDS = integrity + check-push-deletion +
 *   run-mapped-fuzz - the 11.17 taxonomy) spawnado direto no pre-push. The
 *   ADOTADO note in gates-proofs.md DOCUMENTS a re-mediation but does NOT
 *   bypass the list - the LIST is the structural pin (the HOOK_ALLOWLIST
 *   mirror, sec 11.16): a 4th legitimate guard requires consciously
 *   EDITING ALLOWED_NODE_GUARDS, even with the note. The note only relaxes
 *   the POSITIVE below.
 * - POSITIVE (must exist): check-node-modules-integrity as an INDIVIDUAL
 *   spawn in the pre-push (removing it = the pre-push loses the 8.5
 *   integrity check before the fuzz gate) AND check-push-deletion (the
 *   8.4/11.18 pure-deletion shortcut - removing it = the hook silently
 *   loses the housekeeping skip; the DERIVATION PIN catches it in CI but
 *   the guard must signal locally too, 'DELETION SHORTCUT MISSING'). Both
 *   relaxed under the reversal note (a legit adoption moves them INTO the
 *   batch).
 *
 * The positive direction of the 4th-guard contract is proven via the
 * PREPUSH_ALLOWLIST_EXTRA seam (comma-separated, extends the allowed set
 * hermetically - the CLI/hook never sets it): guard novo + nota + lista
 * editada -> exit 0 (the conscious list edit unblocks the legit adoption).
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * .husky/pre-push and asserts clean - if someone wires a 2nd cheap node
 * guard into the pre-push without the dated ADOTADO reversal section, that
 * test fails in CI (it runs under test:unit AND test:guard / the
 * guard-gates push net, same as scan-fuzz-precommit).
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { ALLOWED_NODE_GUARDS, derivePrepushSpawns } from "../scan-prepush-batch.mjs"
import { cleanupTempDirs, createTempDir, replaceEolAgnostic, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-prepush-batch.mjs")

function writeFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

function runGuard(dir: string, extraEnv: Record<string, string> = {}) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    env: { PREPUSH_BATCH_SCAN_ROOT: dir, ...extraEnv },
  })
}

/**
 * A legitimate .husky/pre-push (the 11.17 taxonomy): the single node guard
 * (integrity) as an individual spawn + the deletion shortcut + the mapped
 * fuzz gate + the bash encoding gate + pre-push:gates.
 */
const CLEAN_PRE_PUSH = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "node scripts/check-push-deletion.mjs",
  "bash scripts/verify-encoding.sh --dry-run --ci src/",
  "node scripts/check-node-modules-integrity.mjs",
  'node scripts/run-mapped-fuzz.mjs --since "${PRE_PUSH_REMOTE_SHA:-}"',
  "bun run pre-push:gates",
  "",
].join("\n")

/** Write a full synthetic repo with the pre-push clean. */
function writeCleanRepo(dir: string) {
  writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH)
}

describe("scan-prepush-batch.mjs - pre-push NAO batchado (sec 11.17, padrao 11.11)", () => {
  afterEach(cleanupTempDirs)

  it("clean: pre-push com o node guard unico (integrity) + os pinados -> exit 0", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: um node guard NOVO (fora do conjunto pinado) no .husky/pre-push -> exit 1 com o caminho exato (file:line + conteudo)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    // CLEAN_PRE_PUSH has 8 lines incl. the trailing-newline empty line, so
    // the appended line lands at 9 - the exact line the guard reports.
    writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH + "\nnode scripts/scan-new-guard.mjs\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("SECOND NODE GUARD at .husky/pre-push:9")
    expect(r.stdout).toContain("node scripts/scan-new-guard.mjs")
    expect(r.stdout).toContain("sec 11.17")
  }, 60000)

  it("count-pin: exatamente 1 violacao p/ 1 linha injetada, com linha exata (fonte unica de falha)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH + "\nnode scripts/scan-new-guard.mjs\n")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout.match(/SECOND NODE GUARD/g)?.length).toBe(1)
    expect(r.stdout).toContain(".husky/pre-push:9")
  }, 60000)

  it("comentario com 'node scripts/scan-new-guard.mjs' em prosa NAO tripa (o header do hook explica o POR QUE)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(
      dir,
      ".husky/pre-push",
      "# (um 2o node guard faria o batch valer a pena - node scripts/scan-new-guard.mjs, sec 11.17)\n" + CLEAN_PRE_PUSH,
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("NOTA SOZINHA NAO bypassa: guard novo + secao '## 11.x ... pre-push ... ADOTADO' SEM editar a lista -> exit 1 com 'SECOND NODE GUARD' (a LISTA e o pin estrutural, espelho do HOOK_ALLOWLIST da 11.16 - a nota documenta mas nao implementa)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH + "\nnode scripts/scan-new-guard.mjs\n")
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.18 pre-push batchado - ADOTADO (medicao 2026-08-10)\nre-mediado: o pre-push ganhou um 2o node guard; o batch agora cobre os dois; tabela na secao\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("SECOND NODE GUARD at .husky/pre-push:9")
    expect(r.stdout).toContain("scan-new-guard.mjs")
    expect(r.stdout).toContain("edit ALLOWED_NODE_GUARDS")
  }, 60000)

  it("4o guard legitimo: nota ADOTADO + LISTA EDITADA (seam PREPUSH_ALLOWLIST_EXTRA) -> exit 0 (a edicao consciente da lista desbloqueia a adocao)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH + "\nnode scripts/scan-new-guard.mjs\n")
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.18 pre-push batchado - ADOTADO (medicao 2026-08-10)\nre-mediado: o pre-push ganhou um 2o node guard; o batch agora cobre os dois; tabela na secao\n",
    )
    // O seam estende o ALLOWED_NODE_GUARDS hermeticamente: o MESMO guard
    // que a MUTATION acima flagra agora passa quando a lista e editada.
    const r = runGuard(dir, { PREPUSH_ALLOWLIST_EXTRA: "scan-new-guard.mjs" })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("prosa explicando a regra NAO satisfaz a nota (o marcador exige HEADER de secao 11.x com ADOTADO)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", CLEAN_PRE_PUSH + "\nnode scripts/scan-new-guard.mjs\n")
    // A secao 11.17 legitima tem 'Pre-push' no header mas NUNCA ADOTADO na
    // MESMA linha - nao satisfaz a nota de reversao.
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.17 Pre-push NAO e batchado - por que a assimetria e correta (avaliacao 2026-08-10)\nprosa: se um dia o pre-push ganhar um 2o node guard, o batch passa a valer; adicione uma secao 11.x ADOTADO com a re-mediacao\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("SECOND NODE GUARD")
  }, 60000)

  it("INTEGRITY GUARD DELETADO: pre-push sem o spawn individual do integrity -> exit 1 com 'INTEGRITY GUARD MISSING' (assert positivo)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", replaceEolAgnostic(CLEAN_PRE_PUSH, "node scripts/check-node-modules-integrity.mjs\n", "", "pre-push integrity line"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("INTEGRITY GUARD MISSING in .husky/pre-push")
    // Sole-failure pin (inverso): o shortcut de delecao continua presente -
    // so o integrity falta (o irmao DELETION SHORTCUT DELETADO faz o pin
    // espelhado).
    expect(r.stdout.match(/SECOND NODE GUARD/g)?.length ?? 0).toBe(0)
    expect(r.stdout.match(/DELETION SHORTCUT MISSING/g)?.length ?? 0).toBe(0)
  }, 60000)

  it("INTEGRITY DELETADO + NOTA: sob a nota ADOTADO o integrity pode ter ido para DENTRO do batch -> exit 0 (positivo relaxado)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", replaceEolAgnostic(CLEAN_PRE_PUSH, "node scripts/check-node-modules-integrity.mjs\n", "", "pre-push integrity line"))
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.18 pre-push batchado - ADOTADO (medicao 2026-08-10)\nre-mediado: integrity movido para o batch do pre-push\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("DELETION SHORTCUT DELETADO: pre-push sem o spawn do check-push-deletion -> exit 1 com 'DELETION SHORTCUT MISSING' (assert positivo do sub-caminho 11.18 - o skip de delecao pura da 8.4 precisa de sinal LOCAL, nao so o DERIVATION PIN do CI)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", replaceEolAgnostic(CLEAN_PRE_PUSH, "node scripts/check-push-deletion.mjs\n", "", "pre-push deletion shortcut line"))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DELETION SHORTCUT MISSING in .husky/pre-push")
    expect(r.stdout).toContain("sec 8.4/11.18")
    // Sole-failure pin: o integrity continua presente - so o shortcut falha.
    expect(r.stdout.match(/SECOND NODE GUARD/g)?.length ?? 0).toBe(0)
    expect(r.stdout.match(/INTEGRITY GUARD MISSING/g)?.length ?? 0).toBe(0)
  }, 60000)

  it("DELETION DELETADO + NOTA: sob a nota ADOTADO o checker pode ter ido para DENTRO do batch -> exit 0 (positivo relaxado, espelho do INTEGRITY DELETADO + NOTA)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    writeFile(dir, ".husky/pre-push", replaceEolAgnostic(CLEAN_PRE_PUSH, "node scripts/check-push-deletion.mjs\n", "", "pre-push deletion shortcut line"))
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.18 pre-push batchado - ADOTADO (medicao 2026-08-10)\nre-mediado: checker de delecao pura movido para o batch do pre-push\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("ALLOWED pin: o conjunto pinado (taxonomia 11.17) tem exatamente os 3 (integrity, delecao, fuzz vitest)", () => {
    // O pin do conjunto: um 4o entry exige re-mediacao consciente (nao uma
    // allowlist generica que cresce no acaso).
    expect(ALLOWED_NODE_GUARDS).toEqual([
      "check-node-modules-integrity.mjs",
      "check-push-deletion.mjs",
      "run-mapped-fuzz.mjs",
    ])
  })

  it("DERIVATION PIN: o .husky/pre-push REAL deriva exatamente os 3 node spawns na ordem (a 11.17 'um node guard' travada contra drift)", () => {
    // O padrao do deriveBatchGuards do pre-commit aplicado ao outro hook: a
    // lista de node guards do pre-push e DERIVADA dos spawns reais (todo
    // `node scripts/X.mjs` em linha nao-comentario, na ordem). O pin da
    // lista VIVA: se um dev adicionar um 2o node guard no pre-push, a lista
    // derivada muda e este teste quebra ANTES de o scan precisar. O scan
    // consome a MESMA derivacao (2 usos - fonte unica, nunca hardcoded).
    const prePush = fs.readFileSync(path.join(process.cwd(), ".husky", "pre-push"), "utf8")
    const derived = derivePrepushSpawns(prePush).map((s) => s.module)
    // Ordem real do hook: (1) o atalho de delecao pura no shortcut, (2) o
    // integrity - o UNICO node guard legitimo (a 11.17), (3) o runner
    // vitest do fuzz mapeado (nao cabe no batch, sec 11.17/11.18).
    expect(derived).toEqual([
      "check-push-deletion.mjs",
      "check-node-modules-integrity.mjs",
      "run-mapped-fuzz.mjs",
    ])
    // A claim da 11.17: exatamente UM node guard (o integrity) - os outros
    // dois sao a taxonomia de NAO-guards (atalho de delecao + runner vitest).
    const guards = derived.filter((m) => m === "check-node-modules-integrity.mjs")
    expect(guards.length).toBe(1)
  }, 60000)

  it("GROWTH: um node spawn NOVO alem do baseline da fixture sintetica e DERIVADO (a derivacao e viva, nao lista hardcoded)", () => {
    const dir = createTempDir("prepush-batch-")
    writeCleanRepo(dir)
    // CLEAN_PRE_PUSH deriva 3 spawns (check-push-deletion + integrity +
    // run-mapped-fuzz); o guard simulado entra na lista derivada
    // automaticamente - a derivacao cobre o futuro sem entry hardcoded (o
    // spread contract dos TARGET_DIRS).
    const prePushPath = path.join(dir, ".husky", "pre-push")
    const base = fs.readFileSync(prePushPath, "utf8")
    fs.writeFileSync(prePushPath, base + "\nnode scripts/scan-new-guard.mjs\n")
    const derived = derivePrepushSpawns(fs.readFileSync(prePushPath, "utf8")).map((s) => s.module)
    expect(derived).toContain("check-node-modules-integrity.mjs")
    expect(derived).toContain("check-push-deletion.mjs")
    expect(derived).toContain("scan-new-guard.mjs")
    expect(derived.length).toBe(4)
  }, 60000)

  it("root sintetico sem hooks -> clean (nao escaneavel, postura do scan-push-full-suite)", () => {
    const dir = createTempDir("prepush-batch-")
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("REAL-REPO CONTRACT: pre-push real limpo hoje -> exit 0 + estado pino (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    // Os dois positivos vivem no pre-push real (o pin positivo vivo): o
    // node guard unico (integrity) E o atalho de delecao pura (11.18).
    const prePush = fs.readFileSync(path.join(process.cwd(), ".husky", "pre-push"), "utf8")
    expect(prePush).toContain("node scripts/check-node-modules-integrity.mjs")
    expect(prePush).toContain("node scripts/check-push-deletion.mjs")
  }, 60000)
})
