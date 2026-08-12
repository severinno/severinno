/**
 * run-precommit-guards.mjs - batch runner dos 10 guards node do pre-commit
 * (2026-08, secao 11.13/11.16): uma UNICA invocacao node agrega os exit codes.
 *
 * Hermetic tests via the guards' OWN env overrides (PUSH_SUITE_SCAN_ROOT /
 * LINT_LOADER_SCAN_ROOT / GUARD_GATES_SCAN_ROOT / NODE_MODULES_ROOT /
 * FUZZ_PRECOMMIT_SCAN_ROOT / BATCH_COVERAGE_SCAN_ROOT / EXIT_CLAIMS_DOC /
 * PROOF_HELPERS_ROOT - the
 * same env-override pattern as FRAGILE_SCAN_ROOT): each test points ONE
 * override at a synthetic temp repo that FAILS that guard, while the OTHER
 * guards scan the REAL repo (clean today) - proving:
 *   1. AGREGACAO (worst-exit): um guard falho -> batch exit 1.
 *   2. ISOLAMENTO: os outros guards RODAM MESMO ASSIM e reportam clean -
 *      uma falha nunca esconde as demais (a razao do batch sobre o hook
 *      antigo com `set -e`, que parava no 1o erro e escondia o resto).
 *   3. ORDER (determinismo): a saida segue a ordem do hook (integrity,
 *      push-suite, lint-loader, guard-gates, fuzz-precommit,
 *      batch-coverage, prepush-batch, exit-claims, proof-helpers,
 *      unit-config) - nunca
 *      interleaved, a
 *      vantagem do batch sobre o paralelo.
 * O REAL-REPO CONTRACT test roda o batch SEM env override (repo real limpo)
 * e asserta exit 0 + os 10 veredictos clean - o lock de regressao.
 *
 * Subprocess-heavy (todo teste spawna o CLI via runSubprocess) -> timeout
 * EXPLICITO em todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { GUARD_PUSH_NET, cleanupTempDirs, createTempDir, runSubprocess, writeCIWorkflow, writeGuardGatesWorkflow, writePRWorkflow, writePoisonExitClaimsDoc } from "./golden-copy-utils"

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
 * The pr-check.yml is the SHARED CLEAN family shape (writePRWorkflow, sec
 * 11.26): all five jobs standalone with the CORRECT steps (utf8-check call
 * site + check + fuzz:ci + run-benchmark + fragile-guard test:guard). The
 * ACHADO of the 11.26 extraction: the OLD inline twin carried a BROKEN
 * fragile-guard step (`- run: echo no test:guard`) - but it was INERT for
 * the signal: the scanner's missingStep is SINGLE-VALUED (the FIRST net
 * workflow missing the step, GUARD_NET[0] push net first) - the push net
 * already claims it, so the twin's broken step never surfaced and the
 * sole-failure pin held. The CLEAN twin preserves that pin (the ONLY
 * violation stays the push-net TEST GUARD STEP MISSING) AND gains the
 * fixture-vs-real drift coverage of sec 11.25 (the shared blocks are
 * validated against the real pr-check.yml) - strictly better than the old
 * inert-broken inline. The ci.yml keeps the utf8-check call site (rule 8
 * scans ci.yml + pr-check.yml; a missing call site would ADD an 'ENCODING
 * CALL SITE MISSING' line - the same sole-failure discipline).
 */
function writeBadGuardNet(dir: string) {
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
  // O push net com o step ERRADO (sem test:guard) - a shape compartilhada do
  // golden-copy-utils (name + runsOn + step:false = TEST GUARD STEP MISSING).
  writeGuardGatesWorkflow(dir, { name: "guard-gates", runsOn: true, step: false })
  // O twin PR e a shape CLEAN compartilhada (writePRWorkflow, sec 11.26).
  writePRWorkflow(dir)
  // O ci.yml e a shape CLEAN compartilhada (writeCIWorkflow, sec 11.34) - o
  // inline da sec 11.26 ("a unica variante que fica inline") morre aqui: a
  // fronteira moveu com a extracao da familia CI. O lint job novo nao
  // introduz sinal (o guard so ancora o call site utf8-check + o grafo
  // needs: - ambos limpos), entao o pin sole-failure do teste (a UNICA
  // violacao e o TEST GUARD STEP MISSING do push net) e preservado.
  writeCIWorkflow(dir)
}

/**
 * A synthetic root that FAILS scan-proof-helpers (o 9o guard, sec 11.93):
 * o hook-proof-run.mjs com o docblock 'Exit codes:' MUTADO (o `3 = falha
 * de` vira `X = falha de` - o MESMO alvo que as Provas 44/48 usaram ao
 * vivo) + a suite e a nota INTACTAS. O pin sole-failure: so a parte 1 do
 * contrato 11.72 viola (EXIT_CODES_RE) - a 11.93 e claim-bearing (exit
 * code 0/1/2 no corpo da secao, registrada no EXIT_CLAIMS 28->29).
 */
function writeBrokenProofHelper(dir: string) {
  fs.mkdirSync(path.join(dir, "scripts", "__tests__"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "synthetic",
      scripts: { "hook-proof:run": "node scripts/hook-proof-run.mjs" },
    }),
  )
  fs.writeFileSync(
    path.join(dir, "scripts", "hook-proof-run.mjs"),
    [
      "#!/usr/bin/env node",
      "/**",
      " * Exit codes: 0 = ok; 1 = divergiu; 2 = usage; X = falha de infra.",
      " */",
      "const scratchLeftNote = (msg) => msg",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(dir, "scripts", "__tests__", "hook-proof-run.test.ts"),
    [
      'const FAKE = { HOOK_PROOF_GIT: "fake" }',
      "expect(r.status).toBe(1)",
      "",
    ].join("\n"),
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

describe("run-precommit-guards.mjs - batch runner dos 10 guards node (sec 11.13)", () => {
  afterEach(cleanupTempDirs)

  it("AGREGACAO + ISOLAMENTO: guard fora do batch (sintetico) -> exit 1, os outros guards clean", () => {
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
    // ISOLAMENTO: os outros guards escanearam o repo REAL (limpo) e rodaram
    // MESMO com o guard falho - nenhuma falha esconde as demais.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("push-suite: clean")
    expect(r.stdout).toContain("lint-staged-loader: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("fuzz-precommit: clean")
  }, 60000)

  it("REAL-REPO CONTRACT: sem env override -> exit 0, TODOS os 10 veredictos clean na ORDEM do hook", () => {
    const r = runBatch()
    expect(r.status).toBe(0)
    // Determinismo: a ordem do hook (integrity, push-suite, lint-loader,
    // guard-gates, fuzz-precommit, batch-coverage, prepush-batch,
    // exit-claims, proof-helpers, unit-config) - nunca interleaved (a
    // vantagem do batch sobre o paralelo).
    const cleanIdx = [
      "check-node-modules-integrity: clean",
      "push-suite: clean",
      "lint-staged-loader: clean",
      "guard-gates: clean",
      "fuzz-precommit: clean",
      "batch-coverage: clean",
      "prepush-batch: clean",
      "exit-claims: clean",
      "proof-helpers: clean",
      "unit-config: clean",
    ].map((v) => r.stdout.indexOf(v))
    expect(cleanIdx.every((i) => i >= 0)).toBe(true)
    expect(cleanIdx[0]).toBeLessThan(cleanIdx[1])
    expect(cleanIdx[1]).toBeLessThan(cleanIdx[2])
    expect(cleanIdx[2]).toBeLessThan(cleanIdx[3])
    expect(cleanIdx[3]).toBeLessThan(cleanIdx[4])
    expect(cleanIdx[4]).toBeLessThan(cleanIdx[5])
    expect(cleanIdx[5]).toBeLessThan(cleanIdx[6])
    expect(cleanIdx[6]).toBeLessThan(cleanIdx[7])
    expect(cleanIdx[7]).toBeLessThan(cleanIdx[8])
    expect(cleanIdx[8]).toBeLessThan(cleanIdx[9])
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

  it("AGREGACAO + ISOLAMENTO + SURFACE da CURE (sec 11.57): EXIT_CLAIMS_DOC envenenado (o 8o guard exit-claims falha) -> batch exit 1 E a CURE aparece na saida AGREGADA (o batch NAO consome silenciosamente - a stderr do main() compartilhado flui direto, o mecanismo da sec 11.57), os outros 7 guards clean", () => {
    const dir = createTempDir("run-guards-")
    const poison = writePoisonExitClaimsDoc(dir)
    const r = runBatch({ EXIT_CLAIMS_DOC: poison })
    expect(r.status).toBe(1)
    // O 8o guard falha com a claim fake (unregistered) e a CURE surface na
    // saida agregada (stderr) - o pin da sec 11.57 'o batch SURFACE, nao consome'.
    expect(r.stderr).toContain("claim na secao 11.99")
    expect(r.stderr).toContain("CURE: registre a claim no EXIT_CLAIMS")
    // ISOLAMENTO: os outros 7 guards rodaram e reportaram clean MESMO com o 8o falho.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("prepush-batch: clean")
    expect(r.stdout).toContain("batch-coverage: clean")
  }, 60000)

  it("AGREGACAO + SURFACE da dimensao REVAL (sec 11.66): EXIT_CLAIMS_DOC com uma 8.x de reval datada citando count ANTIGO (o esquecimento do doc-revalidate quando o EXIT_CLAIMS cresce) -> batch exit 1 com a CURE doc-revalidate --section na saida agregada, os outros 7 guards clean", () => {
    const dir = createTempDir("run-guards-")
    const docPath = path.join(dir, "stale-reval.md")
    fs.writeFileSync(
      docPath,
      [
        "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real",
        "",
        "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).",
        "",
        "## 8.99 Prova X - controle sintetico",
        "",
        "**Re-validação (2026-08-11, 27 claims)**: re-validado quando o manifest tinha 27.",
        "",
        "## 12. Referências",
        "",
      ].join("\n"),
      "utf8",
    )
    const r = runBatch({ EXIT_CLAIMS_DOC: docPath })
    expect(r.status).toBe(1)
    // O exit-claims (8o guard) surface a dimensao nova da sec 11.66 no stderr
    // agregado - o tripwire do esquecimento do doc-revalidate no pre-commit.
    expect(r.stderr).toContain("re-validacao datada DESATUALIZADA")
    expect(r.stderr).toContain("secao 8.99")
    expect(r.stderr).toContain("node scripts/doc-revalidate.mjs --section 8.99")
    // ISOLAMENTO: os outros guards rodaram e reportaram clean MESMO com o 8o falho.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("prepush-batch: clean")
  }, 60000)

  /**
   * A synthetic root that FAILS scan-unit-config (o 10o guard, sec 11.96):
   * um vitest.config.unit.ts SEM o bloco '// SERIALIZED POOL' (a nota do
   * singleFork removida - o MESMO alvo que a sec 11.80 pina). O pin
   * sole-failure: so a checagem poolNotePresent viola (a citacao da sec
   * 11.95 nem roda - short-circuit sem a nota).
   */
  function writeConfigWithoutNote(dir: string) {
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "vitest.config.unit.ts"),
      [
        "import { defineConfig } from \"vitest/config\"",
        "export default defineConfig({ test: { pool: \"forks\", poolOptions: { forks: { singleFork: true } } } })",
        "",
      ].join("\n"),
    )
    fs.writeFileSync(path.join(dir, "docs", "gates-proofs.md"), "## 8.1 dummy\n## 8.2 dummy\n")
  }

  it("AGREGACAO + ISOLAMENTO + o 10o guard (sec 11.96): config sem a nota SERIALIZED POOL (UNIT_CONFIG_SCAN_ROOT sintetico) -> exit 1 com o caminho exato, os outros 9 guards clean (a edicao do vitest.config.unit.ts bloqueada ANTES do commit, o padrao do tripwire do exit-claims)", () => {
    const dir = createTempDir("run-guards-")
    writeConfigWithoutNote(dir)
    const r = runBatch({ UNIT_CONFIG_SCAN_ROOT: dir })
    expect(r.status).toBe(1)
    // O 10o guard falha com a violacao da checagem poolNotePresent (a nota
    // do singleFork removida) - a mensagem exata com o caminho.
    expect(r.stderr).toContain("unit-config: 1 violacao")
    expect(r.stderr).toContain("vitest.config.unit.ts: o bloco '// SERIALIZED POOL' da nota (sec 11.80) ausente")
    // ISOLAMENTO: os outros 9 guards rodaram e reportaram clean MESMO com o 10o falho.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("prepush-batch: clean")
    expect(r.stdout).toContain("exit-claims: clean")
    expect(r.stdout).toContain("proof-helpers: clean")
  }, 60000)

  it("AGREGACAO + ISOLAMENTO + o 9o guard (sec 11.93): helper de prova com o docblock 'Exit codes:' mutado (PROOF_HELPERS_ROOT sintetico) -> exit 1 com o caminho exato, os outros 9 guards clean (a edicao acidental do bloco 'Exit codes:' bloqueada ANTES do commit, o padrao do tripwire do exit-claims)", () => {
    const dir = createTempDir("run-guards-")
    writeBrokenProofHelper(dir)
    const r = runBatch({ PROOF_HELPERS_ROOT: dir })
    expect(r.status).toBe(1)
    // O 9o guard falha com a violacao da parte 1 do contrato 11.72 (o
    // docblock sem os exit codes 0-3) - a mensagem exata com o caminho.
    expect(r.stderr).toContain("proof-helpers: 1 violacao")
    expect(r.stderr).toContain("hook-proof-run.mjs: o docblock deve documentar os exit codes 0-3")
    // ISOLAMENTO: os outros 9 guards rodaram e reportaram clean MESMO com o 9o falho.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("prepush-batch: clean")
    expect(r.stdout).toContain("exit-claims: clean")
  }, 60000)

  it("AGREGACAO + SURFACE da dimensao DIGEST (sec 11.67): EXIT_CLAIMS_DOC com a row 99 da TABELA ## 1 citando count ANTIGO (o checkCitedCounts da 11.62 nao ve a tabela - o ultimo ponto cego) -> batch exit 1 com a CURE doc-revalidate --section na saida agregada, os outros 7 guards clean", () => {
    const dir = createTempDir("run-guards-")
    const docPath = path.join(dir, "digest-stale.md")
    fs.writeFileSync(
      docPath,
      [
        "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real",
        "",
        "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).",
        "",
        "## 1. Tabela resumo",
        "",
        "| # | Gate sob prova | Prova | Resultado |",
        "|---|---|---|---|",
        "| 99 | Guard X (Prova 99, sec 8.99) | `clean (25 claims)` |",
        "",
        "## 8.99 Prova X - controle sintetico",
        "",
        "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.",
        "",
        "## 12. Referências",
        "",
      ].join("\n"),
      "utf8",
    )
    // NOTA (sec 11.67): o corpo da 8.99 citando counts e inofensivo AQUI -
    // o batch roda o exitClaimsMain, que NAO executa o checkCitedCounts da
    // sec 11.62 (essa dimensao e do guard do push). Se este doc fosse usado
    // no teste do push, o count no corpo mascararia a dimensao digest - por
    // isso o doc do push test isola (sem counts no corpo).
    const r = runBatch({ EXIT_CLAIMS_DOC: docPath })
    expect(r.status).toBe(1)
    // O exit-claims (8o guard) surface a dimensao nova da sec 11.67 no
    // stderr agregado - o guard do digest no pre-commit (via o main()
    // compartilhado que o batch roda).
    expect(r.stderr).toContain("TABELA ## 1")
    expect(r.stderr).toContain("row 99")
    expect(r.stderr).toContain("node scripts/doc-revalidate.mjs --section 8.99")
    // ISOLAMENTO: os outros guards rodaram e reportaram clean MESMO com o 8o falho.
    expect(r.stdout).toContain("check-node-modules-integrity: clean")
    expect(r.stdout).toContain("guard-gates: clean")
    expect(r.stdout).toContain("prepush-batch: clean")
    expect(r.stdout).toContain("batch-coverage: clean")
  }, 60000)
})
