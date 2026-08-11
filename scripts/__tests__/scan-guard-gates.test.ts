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
import { ENCODING_CI_NET, GUARD_PR_TWIN, GUARD_PUSH_NET, SCANNER_BLOCKS, cleanupTempDirs, createTempDir, runSubprocess, writeCIWorkflow, writeGuardGatesWorkflow, writePRWorkflow, writePRWorkflowFuzzQuebrado, writePRWorkflowSemFuzz } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-guard-gates.mjs")

function writeFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

/** Write a synthetic package.json whose test:guard keeps the 8.4 suite. */
function writePkg(dir: string, testGuard = "vitest run scripts/__tests__/scan-push-full-suite.test.ts --config vitest.config.unit.ts") {
  writeFile(
    dir,
    "package.json",
    JSON.stringify({ name: "synthetic", scripts: { "test:guard": testGuard } }, null, 2),
  )
}

/** Write a clean synthetic repo (both workflows + pkg with the suite). */
function writeCleanRepo(dir: string) {
  writeGuardGatesWorkflow(dir)
  writePRWorkflow(dir)
  writeCIWorkflow(dir)
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

  it("MUTATION: pr-check.yml sem o job fragile-guard -> exit 1 com 'FRAGILE GUARD JOB MISSING' (o twin PR da rede nao pode sumir)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writeFile(
      dir,
      GUARD_PR_TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  check:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Unit tests",
        "        run: bun run test:unit",
        "  fuzz:",
        "    name: Fuzz Tests",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run fuzz tests",
        "        run: bun run fuzz:ci > fuzz-results.json",
        "  benchmark:",
        "    name: Geo Benchmark",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run geo benchmark",
        "        run: |",
        "          node scripts/run-benchmark.mjs --type geo --json",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FRAGILE GUARD JOB MISSING")
    expect(r.stdout).toContain(GUARD_PR_TWIN)
  }, 60000)

  it("MUTATION: job fragile-guard sem o step test:guard -> exit 1 com 'TEST GUARD STEP MISSING' no pr-check.yml", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writeFile(
      dir,
      GUARD_PR_TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  fuzz:",
        "    name: Fuzz Tests",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run fuzz tests",
        "        run: bun run fuzz:ci > fuzz-results.json",
        "  benchmark:",
        "    name: Geo Benchmark",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run geo benchmark",
        "        run: |",
        "          node scripts/run-benchmark.mjs --type geo --json",
        "  fragile-guard:",
        "    name: Fragile Range Guard",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: lint",
        "        run: bun run lint",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`TEST GUARD STEP MISSING in ${GUARD_PR_TWIN}`)
  }, 60000)

  it("MUTATION: job fragile-guard com needs: check -> exit 1 com 'FRAGILE GUARD NEEDS' (o skip vector do lint nao pode voltar)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writePRWorkflow(
      dir,
      "  fragile-guard:\n    needs: check\n    name: Fragile Range Guard\n    runs-on: ubuntu-latest\n    steps:\n      - name: Run guard vitest suites\n        run: bun run test:guard\n",
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FRAGILE GUARD NEEDS")
    expect(r.stdout).toContain("needs: check")
  }, 60000)

  it("MUTATION: guard-gates.yml sem o job guard-gates -> exit 1 com 'GUARD GATES JOB MISSING' (o job standalone do PUSH NET nao pode sumir - Prova 19)", () => {
    const dir = createTempDir("guard-gates-")
    writeFile(
      dir,
      GUARD_PUSH_NET,
      [
        "name: Guard Gates",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "",
      ].join("\n"),
    )
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD GATES JOB MISSING")
    expect(r.stdout).toContain(GUARD_PUSH_NET)
  }, 60000)

  it("MUTATION: job guard-gates do push net com needs: check -> exit 1 com 'GUARD GATES JOB NEEDS' (o par da Prova 16 fechado no outro lado da rede)", () => {
    const dir = createTempDir("guard-gates-")
    // A base writeWorkflow JA tem o job guard-gates - um segundo bloco
    // APPENDADO com needs: e a mutacao (o parser re-entry le o ULTIMO bloco:
    // o mesmo padrao do teste FRAGILE GUARD NEEDS). Um needs: no push net
    // referencia um job inexistente (guard-gates.yml tem UM job) e INVALIDA
    // o workflow no GitHub - o BASELINE nem chega a rodar (orfao total).
    writeGuardGatesWorkflow(dir, { extra: "  guard-gates:\n    needs: check\n    name: Guard Gates\n    runs-on: ubuntu-latest\n    steps:\n      - name: Run guard vitest suites\n        run: bun run test:guard\n" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD GATES JOB NEEDS")
    expect(r.stdout).toContain("needs: check")
  }, 60000)

  it("comentario com 'test:guard' (o header explica o mirror em prosa) NAO tripa o step check", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir, { extra: "# (bun run test:guard - o script unico em package.json, single source of truth)\n" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir, "# o MESMO par de suites do push net guard-gates.yml (bun run test:guard)\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: paths: filter no on.push -> exit 1 com o caminho exato (file:line + conteudo)", () => {
    const dir = createTempDir("guard-gates-")
    // A fixture tem 15 linhas de conteudo (9 base + 6 scanner steps, regra
    // 10 sec 11.32) + a linha 16 do filtro (o ultimo elemento vazio do
    // array vira o \n final antes do extra)
    writeGuardGatesWorkflow(dir, { extra: "        paths:\n          - 'scripts/**'\n" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`PATHS FILTER in ${GUARD_PUSH_NET}:16`)
    expect(r.stdout).toContain("paths:")
  }, 60000)

  it("MUTATION: paths-ignore: filter -> exit 1 (a mesma classe, o filtro NEGATIVO do on.push)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir, { extra: "        paths-ignore:\n          - 'docs/**'\n" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`PATHS FILTER in ${GUARD_PUSH_NET}:16`)
    expect(r.stdout).toContain("paths-ignore:")
  }, 60000)

  it("comentario com 'paths filter' NAO tripa (o header do workflow explica o POR QUE em prosa)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir, { extra: "# NO paths filter BY DESIGN - a surface escaneada e derivada dos TARGET_DIRS\n" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: step test:guard removido do workflow -> exit 1 com 'TEST GUARD STEP MISSING' (assert positivo)", () => {
    const dir = createTempDir("guard-gates-")
    // A shape compartilhada do golden-copy-utils: o step lint substitui o
    // test:guard (TEST GUARD STEP MISSING) - o mesmo shape do exclusivity.
    writeGuardGatesWorkflow(dir, { step: false })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("TEST GUARD STEP MISSING")
  }, 60000)

  it("MUTATION (regra 10, sec 11.32): scan-curl-timeouts --ci removido do push net -> exit 1 com 'CURL TIMEOUTS STEP MISSING' no caminho exato (o step sozinho - os outros 2 scanners seguem presentes)", () => {
    const dir = createTempDir("guard-gates-")
    // A shape compartilhada do golden-copy-utils: omitScanner remove SO o
    // step curl - o contrato single-valued por step-key: o push net ainda
    // tem timeouts + eol, entao SO o curl reporta, no arquivo exato.
    writeGuardGatesWorkflow(dir, { omitScanner: "curl" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`CURL TIMEOUTS STEP MISSING in ${GUARD_PUSH_NET}`)
    expect(r.stdout).not.toContain("SCAN TIMEOUTS STEP MISSING")
    expect(r.stdout).not.toContain("EOL ANCHOR STEP MISSING")
  }, 60000)

  it("MUTATION (regra 10): TODOS os 3 scanner steps --ci removidos do push net -> exit 1 com os 3 sinais juntos (a multi-violacao da regra)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir, { omitScanners: true })
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`SCAN TIMEOUTS STEP MISSING in ${GUARD_PUSH_NET}`)
    expect(r.stdout).toContain(`CURL TIMEOUTS STEP MISSING in ${GUARD_PUSH_NET}`)
    expect(r.stdout).toContain(`EOL ANCHOR STEP MISSING in ${GUARD_PUSH_NET}`)
  }, 60000)

  it("MUTATION (regra 10): scan-eol-anchor --ci removido do TWIN (pr-check.yml) -> exit 1 com 'EOL ANCHOR STEP MISSING' no twin (o push net tem os 3, o single-valued pega o primeiro existente sem o step)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writePRWorkflow(dir)
    // Remove o step eol do twin: a shape compartilhada do golden-copy-utils
    // escreve o twin clean (com os 3 scanners) - o teste reescreve o arquivo
    // sem o bloco eol (o mesmo idioma replaceEolAgnostic de Prova 17: o
    // conteudo e LF sintetico, o replace cru funciona, mas a constante e a
    // MESMA dos fixtures para nao driftar).
    const twinAbs = path.join(dir, GUARD_PR_TWIN)
    const twin = fs.readFileSync(twinAbs, "utf8")
    const eolBlock = [SCANNER_BLOCKS.eol[0], SCANNER_BLOCKS.eol[1]].join("\n")
    fs.writeFileSync(twinAbs, twin.replace(`${eolBlock}\n`, ""))
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`EOL ANCHOR STEP MISSING in ${GUARD_PR_TWIN}`)
  }, 60000)

  it("comentario com 'node scripts/scan-timeouts.mjs --ci' em prosa NAO tripa o scanner step (o ancoramento no run: key exclui comentarios - a mesma classe do TEST_GUARD_STEP_RE)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir, { extra: "      # run: node scripts/scan-timeouts.mjs --ci (prosa no header)\n" })
    writeCIWorkflow(dir)
    writePRWorkflow(dir, "# o mirror do push net: node scripts/scan-eol-anchor.mjs --ci (prosa)\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: scan-push-full-suite removido do test:guard -> exit 1 com 'GUARD SUITE MISSING' (assert positivo)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writePkg(dir, "vitest run scripts/__tests__/fragile-range-guard.test.ts --config vitest.config.unit.ts")
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD SUITE MISSING")
    expect(r.stdout).toContain("scan-push-full-suite.test.ts")
  }, 60000)

  it("MUTATION: test:guard script deletado do package.json -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeCIWorkflow(dir)
    writeFile(dir, "package.json", JSON.stringify({ name: "synthetic", scripts: {} }, null, 2))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("GUARD SUITE MISSING")
  }, 60000)

  it("MUTATION: pr-check.yml sem o job fuzz -> exit 1 com 'FUZZ JOB MISSING' (a autoridade fuzz:ci nao pode sumir do PR)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    // SEM FUZZ: a shape compartilhada do golden-copy-utils (o mesmo shape do
    // fixture 2 da MUTATION COMBINADA) - utf8-check + check + benchmark +
    // fragile-guard, sem o job fuzz.
    writePRWorkflowSemFuzz(dir)
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ JOB MISSING")
    expect(r.stdout).toContain(GUARD_PR_TWIN)
  }, 60000)

  it("MUTATION: job fuzz com needs: check -> exit 1 com 'FUZZ JOB NEEDS' (o skip vector do check nao pode alcancar o fuzz)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writePRWorkflow(
      dir,
      "  fuzz:\n    needs: check\n    name: Fuzz Tests\n    runs-on: ubuntu-latest\n    steps:\n      - name: Run fuzz tests\n        run: bun run fuzz:ci > fuzz-results.json\n",
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ JOB NEEDS")
    expect(r.stdout).toContain("needs: check")
  }, 60000)

  it("MUTATION: job fuzz sem o step fuzz:ci -> exit 1 com 'FUZZ STEP MISSING' (o step e a autoridade batchada)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    // FUZZ QUEBRADO (omitCheck: a shape do FUZZ STEP MISSING): o job fuzz
    // existe mas roda test:unit - a unica violacao e o step fuzz:ci ausente
    // (sole-failure; sem o job check para nao mudar o pin).
    writePRWorkflowFuzzQuebrado(dir, { omitCheck: true })
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ STEP MISSING")
    expect(r.stdout).toContain("fuzz:ci")
  }, 60000)

  it("comentario com 'bun run fuzz:ci' em prosa NAO tripa o step check (o ancoramento no run: key exclui comentarios)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writePRWorkflow(dir, "# (bun run fuzz:ci > fuzz-results.json - o batched authority do PR, sec 11.11/11.12)\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION COMBINADA (classe FUZZ fechada no padrao da Prova 15): fixture completa com os 3 furos do fuzz job -> os 3 sinais (MISSING + NEEDS + STEP) pinados de uma vez, incluindo a multi-violacao num unico stdout", () => {
    // FURO 1+2 no MESMO fixture: o job fuzz existe mas com needs: check E
    // sem o step fuzz:ci (run: test:unit no lugar). O CLI deve reportar
    // FUZZ JOB NEEDS E FUZZ STEP MISSING num unico stdout - a multi-
    // violacao que os testes sole-failure acima nao cobrem (cada um so
    // remove UMA violacao por vez). O FUZZ JOB MISSING e mutuamente
    // exclusivo com os outros dois (job ausente = present:false -> o
    // prGuardJob nao reporta needs/step), entao o terceiro furo usa a
    // SEGUNDA fixture: pr-check.yml SEM o job fuzz.
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    // FUZZ QUEBRADO com needs: check (a shape compartilhada do MUTATION
    // COMBINADA fixture 1) - os DOIS furos juntos num unico stdout.
    writePRWorkflowFuzzQuebrado(dir, { needs: "check" })
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("FUZZ JOB NEEDS")
    expect(r.stdout).toContain("needs: check")
    expect(r.stdout).toContain("FUZZ STEP MISSING")
    expect(r.stdout).toContain("fuzz:ci")
    // O terceiro furo: o job fuzz AUSENTE (mutuamente exclusivo - o mesmo
    // teste pina os 3 sinais de uma vez, no padrao da Prova 15).
    const dir2 = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir2)
    writeCIWorkflow(dir2)
    writePRWorkflowSemFuzz(dir2)
    writePkg(dir2)
    const r2 = runGuard(dir2)
    expect(r2.status).toBe(1)
    expect(r2.stdout).toContain("FUZZ JOB MISSING")
    expect(r2.stdout).toContain(GUARD_PR_TWIN)
  }, 60000)

  it("MUTATION: workflow DELETADO (so package.json) -> exit 1 com 'WORKFLOW MISSING' (a rede orfa nao passa em silencio)", () => {
    const dir = createTempDir("guard-gates-")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("WORKFLOW MISSING")
    expect(r.stdout).toContain(GUARD_PUSH_NET)
  }, 60000)

  it("package.json ausente (root sintetico minimo) -> clean (sem pkg = sem suite para validar)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeCIWorkflow(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: ci.yml sem o call site utf8-check -> exit 1 com 'ENCODING CALL SITE MISSING' (o gate de encoding nao pode sumir do merge path)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeFile(
      dir,
      ENCODING_CI_NET,
      [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`ENCODING CALL SITE MISSING in ${ENCODING_CI_NET}`)
    expect(r.stdout).toContain("utf8-check")
  }, 60000)

  it("MUTATION: pr-check.yml sem o call site utf8-check -> exit 1 com 'ENCODING CALL SITE MISSING' (o twin PR do encoding gate)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writeFile(
      dir,
      GUARD_PR_TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  check:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Unit tests",
        "        run: bun run test:unit",
        "  fuzz:",
        "    name: Fuzz Tests",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run fuzz tests",
        "        run: bun run fuzz:ci > fuzz-results.json",
        "  benchmark:",
        "    name: Geo Benchmark",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run geo benchmark",
        "        run: |",
        "          node scripts/run-benchmark.mjs --type geo --json",
        "  fragile-guard:",
        "    name: Fragile Range Guard",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run guard vitest suites (fragile-range-guard + golden-copy-utils)",
        "        run: bun run test:guard",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`ENCODING CALL SITE MISSING in ${GUARD_PR_TWIN}`)
  }, 60000)

  it("MUTATION: pr-check.yml sem o job benchmark -> exit 1 com 'BENCHMARK JOB MISSING' (o gate geo do merge path nao pode sumir do PR)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writeFile(
      dir,
      GUARD_PR_TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  check:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Unit tests",
        "        run: bun run test:unit",
        "  fuzz:",
        "    name: Fuzz Tests",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run fuzz tests",
        "        run: bun run fuzz:ci > fuzz-results.json",
        "  fragile-guard:",
        "    name: Fragile Range Guard",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run guard vitest suites (fragile-range-guard + golden-copy-utils)",
        "        run: bun run test:guard",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("BENCHMARK JOB MISSING")
    expect(r.stdout).toContain(GUARD_PR_TWIN)
  }, 60000)

  it("MUTATION: job benchmark com needs: check -> exit 1 com 'BENCHMARK JOB NEEDS' (o skip vector do check nao pode alcancar o gate geo)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writePRWorkflow(
      dir,
      "  benchmark:\n    needs: check\n    name: Geo Benchmark\n    runs-on: ubuntu-latest\n    steps:\n      - name: Run geo benchmark\n        run: |\n          node scripts/run-benchmark.mjs --type geo --json\n",
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("BENCHMARK JOB NEEDS")
    expect(r.stdout).toContain("needs: check")
  }, 60000)

  it("MUTATION: job benchmark sem o step run-benchmark -> exit 1 com 'BENCHMARK STEP MISSING' (o step e o gate geo)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    // A base writePRWorkflow JA tem o run-benchmark step - um segundo bloco
    // APPENDADO nao remove o step do primeiro (stepPresent ficaria true).
    // A mutacao substitui o pr-check.yml inteiro: o benchmark job existe mas
    // roda outra coisa - a unica violacao e o step run-benchmark ausente
    // (sole-failure).
    writeFile(
      dir,
      GUARD_PR_TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  benchmark:",
        "    name: Geo Benchmark",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run something else",
        "        run: bun run test:unit",
        "  fuzz:",
        "    name: Fuzz Tests",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run fuzz tests",
        "        run: bun run fuzz:ci > fuzz-results.json",
        "  fragile-guard:",
        "    name: Fragile Range Guard",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run guard vitest suites (fragile-range-guard + golden-copy-utils)",
        "        run: bun run test:guard",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("BENCHMARK STEP MISSING")
    expect(r.stdout).toContain("run-benchmark")
  }, 60000)

  it("comentario com 'node scripts/run-benchmark.mjs' em prosa NAO tripa o step check (comentario nunca comeca com node)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    writePRWorkflow(dir, "# (node scripts/run-benchmark.mjs - o gate geo do PR, sec scan-surfaces.md Type C - auditoria da rede 2026-08)\n")
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION: call site utf8-check com needs: lint no ci.yml -> exit 1 com 'ENCODING CALL SITE NEEDS' (o skip vector do lint sobre o encoding gate)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeFile(
      dir,
      ENCODING_CI_NET,
      [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "  utf8-check:",
        "    needs: lint",
        "    uses: ./.github/workflows/utf8-check.yml",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`ENCODING CALL SITE NEEDS in ${ENCODING_CI_NET}`)
    expect(r.stdout).toContain("needs: lint")
  }, 60000)

  it("MUTATION: call site sem a linha uses (job vazio) -> exit 1 com 'ENCODING CALL SITE STEP MISSING'", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeFile(
      dir,
      ENCODING_CI_NET,
      [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "  utf8-check:",
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`ENCODING CALL SITE STEP MISSING in ${ENCODING_CI_NET}`)
  }, 60000)

  it("comentario com 'utf8-check.yml' em prosa NAO tripa o call site (o ancoramento no uses: key exclui comentarios)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir, "# (utf8-check.yml - o gate de encoding, sec 8.x; o mirror e explicado no header)\n")
    writeCIWorkflow(dir, { extra: "# Reusable via .github/workflows/utf8-check.yml\n" })
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("MUTATION (regra 11, sec 11.33): ci.yml com needs: para job inexistente -> exit 1 com 'DANGLING NEEDS' no caminho exato (job + ref + linha)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    // build cita `nonexistent` em needs: - o job nao existe no mesmo
    // workflow. A classe observada AO VIVO na Prova 24 (build/budget
    // citavam o utf8-check deletado): o GitHub INVALIDA o workflow no
    // parse com 0 jobs - o scan-guard-gates agora trava ANTES, com a
    // ref pendurada nomeada.
    writeFile(
      dir,
      ENCODING_CI_NET,
      [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  build:",
        "    name: Build",
        "    needs: [lint, nonexistent]",
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`DANGLING NEEDS in ${ENCODING_CI_NET}`)
    expect(r.stdout).toContain("job build")
    expect(r.stdout).toContain("needs nonexistent")
  }, 60000)

  it("MUTATION (regra 11): DUAS refs penduradas no mesmo workflow (build + budget) -> AMBAS reportadas num unico stdout (multi-violacao, o padrao da Prova 22 - o CLI nunca short-circuita na primeira)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeFile(
      dir,
      ENCODING_CI_NET,
      [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  build:",
        "    name: Build",
        "    needs: [lint, missing-a]",
        "    runs-on: ubuntu-latest",
        "  budget:",
        "    name: JS Bundle Budget",
        "    needs: [lint, missing-b]",
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("needs missing-a")
    expect(r.stdout).toContain("needs missing-b")
    const count = (r.stdout.match(/DANGLING NEEDS in /g) ?? []).length
    expect(count).toBe(2)
  }, 60000)

  it("MUTATION (regra 11): needs pendurado no pr-check.yml (o twin PR da rede) -> exit 1 com 'DANGLING NEEDS' no twin", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writeCIWorkflow(dir)
    // O check job cita `lint` em needs: - o pr-check.yml NAO tem job lint
    // (o lint e do ci.yml). A MESMA classe da Prova 24 aplicada ao twin PR:
    // um needs: pendurado no pr-check invalida o workflow no parse.
    writeFile(
      dir,
      GUARD_PR_TWIN,
      [
        "name: PR Check",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  check:",
        "    needs: [lint]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Unit tests",
        "        run: bun run test:unit",
        "  fuzz:",
        "    name: Fuzz Tests",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run fuzz tests",
        "        run: bun run fuzz:ci > fuzz-results.json",
        "  benchmark:",
        "    name: Geo Benchmark",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run geo benchmark",
        "        run: |",
        "          node scripts/run-benchmark.mjs --type geo --json",
        "  fragile-guard:",
        "    name: Fragile Range Guard",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run guard vitest suites (fragile-range-guard + golden-copy-utils)",
        "        run: bun run test:guard",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`DANGLING NEEDS in ${GUARD_PR_TWIN}`)
    expect(r.stdout).toContain("needs lint")
  }, 60000)

  it("MUTATION (regra 11, sec 11.33): needs pendurado num workflow FORA do net (deploy.yml) -> exit 1 com 'DANGLING NEEDS' no caminho exato (a superficie e REPO-WIDE, nao so guardNet + encodingNet)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeCIWorkflow(dir)
    // deploy.yml NAO esta no net (guardNet + encodingNet = guard-gates +
    // pr-check + ci) - a extensao repo-wide (2026-08-11): a classe do
    // orfao silencioso e workflow-agnostica, e um needs: pendurado num
    // deploy mataria o deploy no parse do GitHub com 0 jobs - o net nao
    // pegaria, a superficie nova pega.
    writeFile(
      dir,
      ".github/workflows/deploy.yml",
      [
        "name: Deploy",
        "on:",
        "  push:",
        "    branches: [main]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run build",
        "  deploy:",
        "    needs: [build, removed-job]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run deploy",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DANGLING NEEDS in .github/workflows/deploy.yml")
    expect(r.stdout).toContain("job deploy")
    expect(r.stdout).toContain("needs removed-job")
  }, 60000)

  it("MUTATION (regra 11, sec 11.39): needs: *deps (anchor/alias YAML, a unica forma exotica que js-yaml resolveria) -> exit 1 com 'DANGLING NEEDS' ref *deps - a fronteira NAO-JS-YAML: forms exoticas SOBRE-FLAGAM (direcao segura, falha alto, nunca passam silenciosas)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeCIWorkflow(dir)
    // O anchor/alias YAML e a classe que um parser real (js-yaml) resolveria
    // (a alias apontaria para o anchor real no mesmo arquivo). O regex NAO
    // resolve aliases - nao pode, sem parser YAML completo - e reporta o
    // alias cru como ref pendurada: OVER-FLAG na direcao SEGURA (o guard
    // falha alto e um humano revisa, nunca passa silencioso). A fronteira
    // documentada na sec 11.39 e: forms exoticas tripam, nunca escapam.
    writeFile(
      dir,
      ".github/workflows/deploy.yml",
      [
        "name: Deploy",
        "on:",
        "  push:",
        "    branches: [main]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run build",
        "  deploy:",
        "    needs: *deps",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run deploy",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DANGLING NEEDS in .github/workflows/deploy.yml")
    expect(r.stdout).toContain("job deploy")
    expect(r.stdout).toContain("needs *deps")
  }, 60000)

  it("grafo needs: VALIDO (todas as refs resolvem para jobs do mesmo workflow) -> clean (a regra 11 nao e um ban de needs:, e um ban de refs PENDURADAS)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir)
    writeFile(
      dir,
      ENCODING_CI_NET,
      [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main, develop]",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: bun run lint",
        "  utf8-check:",
        "    uses: ./.github/workflows/utf8-check.yml",
        "  build:",
        "    name: Build",
        "    needs: [lint, utf8-check]",
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n"),
    )
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("comentario com 'needs:' em prosa NAO tripa a regra 11 (linha de comentario e ignorada - o parser so le needs: dentro de um bloco de job)", () => {
    const dir = createTempDir("guard-gates-")
    writeGuardGatesWorkflow(dir)
    writePRWorkflow(dir, "# (needs: [lint] - prosa no header do PR twin)\n")
    writeCIWorkflow(dir, { extra: "# needs: [nonexistent] - prosa no header do ci.yml, nunca um job real\n" })
    writePkg(dir)
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("REAL-REPO CONTRACT: guard-gates.yml real sem paths filter + test:guard com a suite + pr-check.yml com fragile-guard/fuzz/benchmark standalone + ci.yml/pr-check.yml com o call site utf8-check sem needs: -> exit 0 (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    // Pin the actual state: the push net has no paths filter AND the step
    // exists AND the suite is in test:guard (the premise of 8.4/11.11).
    const wf = fs.readFileSync(
      path.join(process.cwd(), GUARD_PUSH_NET),
      "utf8",
    )
    expect(wf).not.toMatch(/^\s*paths(?:-ignore)?:/m)
    expect(wf).toMatch(/^\s+run:\s+bun run test:guard\s*$/m)
    // The PR-side twin: pr-check.yml carries the fragile-guard job with the
    // test:guard step and NO needs: (the standalone-job immunity contract).
    const pr = fs.readFileSync(
      path.join(process.cwd(), GUARD_PR_TWIN),
      "utf8",
    )
    expect(pr).toMatch(/^  fragile-guard:$/m)
    expect(pr).toMatch(/^\s+run:\s+bun run test:guard\s*$/m)
    expect(pr).not.toMatch(/^\s+needs:/m)
    // Rule 5, PUSH-NET side (Prova 19 - the pair Prova 16 proved on the PR
    // side, closed on the OTHER side of the net): the guard-gates job of
    // guard-gates.yml itself must carry the test:guard step WITHOUT needs:.
    // A needs: here references a non-existent job (guard-gates.yml has ONE
    // job) and INVALIDATES the workflow - the BASELINE never runs (orphan).
    expect(wf).toMatch(/^  guard-gates:$/m)
    expect(wf).toMatch(/^\s+run:\s+bun run test:guard\s*$/m)
    expect(wf).not.toMatch(/^\s+needs:/m)
    // The fuzz:ci authority (sec 11.11/11.12): a standalone PR job with the
    // batched fuzz step - the check job may fail on pre-existing lint debt
    // without ever skipping the fuzz result.
    expect(pr).toMatch(/^  fuzz:$/m)
    expect(pr).toMatch(/^\s+run:\s+bun run fuzz:ci\b/m)
    expect(pr).not.toMatch(/^\s+needs:/m)
    // Rule 9 (2026-08 network audit): the geo benchmark gate is a standalone
    // PR job - the merge-path gate cannot disappear or become skippable by
    // lint (a renamed job would silently stop the benchmark from running).
    expect(pr).toMatch(/^  benchmark:$/m)
    expect(pr).toMatch(/^\s+node scripts\/run-benchmark\.mjs\b/m)
    expect(pr).not.toMatch(/^\s+needs:/m)
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))
    expect(pkg.scripts["test:guard"]).toContain("scan-push-full-suite.test.ts")
    // Rule 10 (sec 11.32): the 3 versioned scanner steps (--ci) run in BOTH
    // net workflows - removing one changes the push net without the guard
    // tripping (the class this rule exists to close).
    const scannerRunRe = /^\s+run:\s+node scripts\/scan-(?:timeouts|curl-timeouts|eol-anchor)\.mjs\s+--ci\s*$/m
    const scannerCount = (wf2: string) => (wf2.match(/^\s+run:\s+node scripts\/scan-(?:timeouts|curl-timeouts|eol-anchor)\.mjs\s+--ci\s*$/gm) ?? []).length
    expect(scannerCount(wf)).toBe(3)
    expect(scannerCount(pr)).toBe(3)
    expect(wf).toMatch(scannerRunRe)
    expect(pr).toMatch(scannerRunRe)
    // Rule 8 (2026-08 audit): the encoding-gate call sites on the merge path
    // (ci.yml + pr-check.yml) carry the utf8-check call site WITHOUT needs:
    // - a future `needs: lint` would silently recreate the lint skip vector
    //   over the encoding gate (the class this rule exists to close).
    const ci = fs.readFileSync(path.join(process.cwd(), ENCODING_CI_NET), "utf8")
    expect(ci).toMatch(/^  utf8-check:$/m)
    expect(ci).toMatch(/^\s+uses:\s+\.\/\.github\/workflows\/utf8-check\.yml\s*$/m)
    expect(pr).toMatch(/^  utf8-check:$/m)
    expect(pr).toMatch(/^\s+uses:\s+\.\/\.github\/workflows\/utf8-check\.yml\s*$/m)
    // The budget job MAY keep its needs: (a heavy build gate - the JS budget
    // gate is a STEP inside it, not a standalone call site) - pin the
    // exclusion explicitly so the rule 8 boundary is a documented fact, not
    // an accident.
    expect(ci).toMatch(/^  budget:$/m)
    expect(ci).toMatch(/^\s+needs: \[lint, typecheck, utf8-check, quality-gate\]$/m)
    // Rule 11 (sec 11.33): the real ci.yml needs graph RESOLVES - every
    // needs: reference names a job that exists in the same workflow (the
    // class Prova 24 observed: build/budget kept citing the DELETED
    // utf8-check and the workflow was rejected at parse with 0 jobs). The
    // regression lock: a future dangling needs: ANYWHERE in .github/workflows/
    // (repo-wide surface, extended 2026-08-11 - not just the net) fails
    // this guard; the CLI run above (exit 0) now covers all 18 workflows.
    // Count-pin the repo-wide surface: 18 workflows, 5 carry REAL needs:
    // keys (4 outside the net: benchmark-auto-baseline, deploy, e2e-cache,
    // release-deploy - guard-gates.yml and health-check.yml only mention
    // needs: in comments, so the regex misses them by design), 0 dangling
    // today.
    const wfDir = path.join(process.cwd(), ".github", "workflows")
    const wfFiles = fs.readdirSync(wfDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    expect(wfFiles.length).toBe(18)
    const withNeeds = wfFiles.filter((f) =>
      /^\s*needs:/m.test(fs.readFileSync(path.join(wfDir, f), "utf8")),
    )
    expect(withNeeds.length).toBe(5)
    // Rule 11 (sec 11.39): the repo has ZERO exotic needs: forms (anchors/
    // aliases, quoted refs, multi-line flow) - the regex 3-form frontier
    // covers the real surface BY MEASUREMENT (parity probe vs js-yaml:
    // 0 divergences on all 18), and an exotic form that DOES appear would
    // OVER-FLAG (safe direction) rather than pass silently (pinned by the
    // needs: *deps mutation test above).
    const exotic = wfFiles.filter((f) =>
      /^\s*needs:.*(\*|&|"|'|\[\s*$)/m.test(fs.readFileSync(path.join(wfDir, f), "utf8")),
    )
    expect(exotic.length).toBe(0)
    const buildNeeds = ci.match(/^\s+needs: \[lint, typecheck, utf8-check, quality-gate, test\]$/m)
    expect(buildNeeds).not.toBeNull()
    const deployNeeds = ci.match(/^\s+needs: \[build, budget\]$/m)
    expect(deployNeeds).not.toBeNull()
    const ciJobKeys = [...ci.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1])
    for (const needs of ["lint", "typecheck", "utf8-check", "quality-gate", "test", "build", "budget"]) {
      expect(ciJobKeys).toContain(needs)
    }
  }, 60000)
})
