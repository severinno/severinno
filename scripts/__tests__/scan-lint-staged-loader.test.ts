/**
 * scan-lint-staged-loader.mjs - guard do veredito RECUSADO da 11.7 (2026-08):
 * o lint-staged nao pode voltar a rodar o eslint por um loader bun.
 *
 * Hermetic tests via LINT_LOADER_SCAN_ROOT (the same env-override pattern as
 * PUSH_SUITE_SCAN_ROOT / FRAGILE_SCAN_ROOT): each test builds an isolated
 * temp dir with a fake package.json (+ optional docs/gates-proofs.md for the
 * reversal-note contract), then runs the CLI with env override.
 *
 * The guard is BIDIRECTIONAL:
 * - NEGATIVE (must NOT appear): a bun loader (bun/bunx) for eslint in ANY
 *   lint-staged command, unless a dated '## 11.x ... bun ... ADOTADO' section
 *   header exists in gates-proofs.md (the documented re-mediation that would
 *   reverse the verdict).
 * - POSITIVE (must exist): at least one eslint command in lint-staged (the
 *   shim eslintd-shim.sh from 11.6, or plain node `eslint` from 11.7).
 *   Deleting the eslint gate entirely fails with 'LINT-STAGED ESLINT MISSING'.
 *
 * The REAL-REPO CONTRACT test is the regression lock: it scans the ACTUAL
 * package.json lint-staged config and asserts clean - if someone re-adds a
 * bun loader without the reversal section, or deletes the eslint gate, that
 * test fails in CI (it runs under test:unit AND test:guard / the guard-gates
 * push net, same as scan-push-full-suite).
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-lint-staged-loader.mjs")

function writeFile(dir: string, rel: string, content: string) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), content)
}

/** Write a minimal package.json whose lint-staged section is the fixture. */
function writePkg(dir: string, lintStaged: Record<string, unknown>) {
  writeFile(dir, "package.json", JSON.stringify({ name: "synthetic", "lint-staged": lintStaged }, null, 2))
}

function runGuard(dir: string) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    env: { LINT_LOADER_SCAN_ROOT: dir },
  })
}

/** The current adopted production command (11.6 shim). */
const SHIM_CMD = "bash scripts/eslintd-shim.sh --fix"
/** The node-loader baseline (11.7) - also allowed. */
const PLAIN_ESLINT_CMD = "eslint --fix"

describe("scan-lint-staged-loader.mjs - loader bun do eslint RECUSADO (sec 11.7)", () => {
  afterEach(cleanupTempDirs)

  it("clean: shim eslintd (o estado adotado da 11.6) -> exit 0", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": SHIM_CMD })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("clean: eslint puro (node loader, baseline da 11.7) -> exit 0", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": PLAIN_ESLINT_CMD })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it.each([
    ["bunx eslint --fix", "bunx eslint --fix"],
    ["bun eslint --fix", "bun eslint --fix"],
    ["bunx eslint_d --fix", "bunx eslint_d --fix"],
    ["bunx --bun eslint --fix", "bunx --bun eslint --fix"],
    ["bun run lint -- --fix", "bun run lint -- --fix"],
    ["bun run eslint:fix", "bun run eslint:fix"],
    ["bun node_modules/eslint/bin/eslint.js --fix", "bun node_modules/eslint/bin/eslint.js"],
  ])("MUTATION: %s sem nota de reversao -> exit 1 com 'BUN LOADER' + o comando exato", (cmd, fragment) => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": cmd })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("BUN LOADER")
    expect(r.stdout).toContain(fragment)
  }, 60000)

  it("count-pin: exatamente 1 violacao p/ 1 comando bun, com key + linha exatas (fonte unica de falha)", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": "bunx eslint --fix" })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout.match(/BUN LOADER/g)?.length).toBe(1)
    // JSON.stringify(indent 2): a chave esta na linha 4 do package.json sintetico
    expect(r.stdout).toContain('lint-staged ("*.{ts,tsx}") at package.json:4')
    expect(r.stdout).toContain("bunx eslint --fix")
  }, 60000)

  it("near-miss NEGATIVO: node node_modules/eslint/bin/eslint.js (o baseline node da 11.7) NAO e loader bun -> exit 0 (e o gate reconhece a forma eslint.js)", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": "node node_modules/eslint/bin/eslint.js --fix" })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it.each([
    ["bun run lint-staged", "o runner nao e o eslint"],
    ["bunx eslint-config --fix", "eslint-config e um pacote, nao o binario"],
  ])("near-miss POSITIVO: %s (%s) nao satisfaz o gate eslint -> exit 1 com 'LINT-STAGED ESLINT MISSING'", (cmd) => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": cmd })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("LINT-STAGED ESLINT MISSING")
    expect(r.stdout.match(/BUN LOADER/g)?.length ?? 0).toBe(0)
  }, 60000)

  it("NOTA presente: loader bun + secao '## 11.x ... bun ... ADOTADO' no doc -> exit 0 (veredito re-mediado)", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": "bunx eslint --fix" })
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.11 bun loader no lint-staged - ADOTADO (medicao 2026-08-10)\nre-mediado: boot caiu para 4s com cache x; tabela na secao\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("prosa explicando a regra NAO satisfaz a nota (o marcador exige HEADER de secao 11.x)", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": "bunx eslint --fix" })
    writeFile(
      dir,
      "docs/gates-proofs.md",
      "## 11.7 O loader do bun vs node no boot do eslint - RECUSADO\nprosa: se um dia o loader bun for adotado, adicione uma secao numerada 11.x declarando ADOTADO com a re-mediacao\n",
    )
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("BUN LOADER")
  }, 60000)

  it("GATE ESLINT TROCADO: lint-staged sem nenhum comando de eslint -> exit 1 com 'LINT-STAGED ESLINT MISSING' (assert positivo)", () => {
    const dir = createTempDir("lint-loader-")
    writePkg(dir, { "*.{ts,tsx}": "prettier --write" })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("LINT-STAGED ESLINT MISSING")
  }, 60000)

  it("GATE ESLINT DELETADO: sem a chave lint-staged no package.json -> exit 1 (assert positivo)", () => {
    const dir = createTempDir("lint-loader-")
    writeFile(dir, "package.json", JSON.stringify({ name: "synthetic", scripts: {} }))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("LINT-STAGED ESLINT MISSING")
  }, 60000)

  it("REAL-REPO CONTRACT: lint-staged real limpo hoje (shim) -> exit 0 + estado pino (regressao futura falha aqui)", () => {
    const r = runGuard(process.cwd())
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"))
    expect(pkg["lint-staged"]["*.{ts,tsx}"]).toContain("eslintd-shim.sh")
  }, 60000)
})
