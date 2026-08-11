/**
 * scan-eol-anchor.test.ts - suite do guard do ACHADO da Prova 17 (sec 8.14):
 * ancoras de string com a sequencia de escape nova-linha FALHAM
 * SILENCIOSAMENTE em gate files CRLF.
 *
 * O guard (scripts/scan-eol-anchor.mjs) e o fix tornado permanente: um
 * replace de string com ancora contendo o escape nova-linha na superficie
 * de testes/mutacao = falha com file:line (o idioma certo e o
 * replaceEolAgnostic do golden-copy-utils, que normaliza CRLF para LF E
 * throwa no anchor-miss). Esta suite:
 *   - BASELINE: superficie REAL (repo) com ZERO violacoes (exit 0) - os 8
 *     sites historicos foram refatorados para replaceEolAgnostic.
 *   - companion nao-vazio: a superficie escaneada existe (um detector que
 *     nao casa nada seria um pass vazio - a classe do SPREAD).
 *   - MUTATION: um repo sintetico com o padrao cru -> exit 1 com file:line
 *     exato; a variante CLEAN (replaceEolAgnostic) -> exit 0.
 *   - USAGE: flag desconhecida -> exit 2 com usage (espelho do scan-timeouts).
 *   - FRONTEIRA do masking: regex com o escape (a forma segura de casar
 *     EOL) NAO viola - o guard so flagra literais de string.
 *
 * NOTA de metodo: as fixtures de mutacao montam a ancora por
 * CONCATENACAO de literais (ex.: parte + escape + parte) - a sequencia
 * completa nunca existe contigua no codigo-fonte deste proprio arquivo
 * (o guard varre este arquivo tambem; contiguo = auto-flag).
 *
 * Hermetic: TODOS os testes de CLI usam EOL_ANCHOR_SCAN_ROOT (repo
 * sintetico sob createTempDir) - zero superficie real alem do
 * BASELINE/companion. O BASELINE e o UNICO contato com o repo real (a
 * prova viva de que a classe nao voltou).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-eol-anchor.mjs")

/** The escape sequence, assembled so it never appears contiguous here. */
const NL_ESC = "\\" + "n"

interface CliOpts {
  root?: string
  extraArgs?: string[]
}

function runCli(opts: CliOpts = {}) {
  const env: Record<string, string> = { NO_COLOR: "1" }
  if (opts.root) env.EOL_ANCHOR_SCAN_ROOT = opts.root
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT, ...(opts.extraArgs ?? [])],
    env,
  })
}

/** Build a file whose content contains the raw pattern (concatenated). */
function writeRawAnchorFile(dir: string, rel: string, replaceAll = false): string {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  const method = replaceAll ? "replaceAll" : "replace"
  fs.writeFileSync(
    full,
    `const s = content.${method}("job fuzz:${NL_ESC}", "")\n`,
    "utf8",
  )
  return full
}

afterEach(() => cleanupTempDirs())

describe("scan-eol-anchor.mjs - parsing (unidade)", () => {
  it("flagra replace de string com ancora contendo o escape nova-linha (a classe da Prova 17)", () => {
    const dir = createTempDir("eol-anchor-")
    const file = writeRawAnchorFile(dir, "mutate.mjs")
    const { status, stdout, stderr } = runCli({ root: dir })
    expect(status).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain("eol-anchor: string anchor with newline escape in mutate.mjs:1")
    expect(stderr).toContain("replaceEolAgnostic")
    expect(fs.existsSync(file)).toBe(true)
  }, 60000)

  it("flagra replaceAll de string com a mesma classe", () => {
    const dir = createTempDir("eol-anchor-")
    writeRawAnchorFile(dir, "mutate.test.ts", true)
    const { status, stderr } = runCli({ root: dir })
    expect(status).toBe(1)
    expect(stderr).toContain("mutate.test.ts:1")
  }, 60000)

  it("NAO flagra regex com o escape (a forma segura de casar EOL - fronteira do masking)", () => {
    const dir = createTempDir("eol-anchor-")
    fs.writeFileSync(path.join(dir, "safe.mjs"), `const s = content.replace(/${NL_ESC}/g, "\\r\\n")\n`, "utf8")
    fs.writeFileSync(path.join(dir, "safe2.ts"), 'const s = content.replace(/\\r\\n/g, "\\n")\n', "utf8")
    const { status, stdout } = runCli({ root: dir })
    expect(status).toBe(0)
    expect(stdout).toContain("clean")
  }, 60000)

  it("NAO flagra ancora de variavel (nao-literal) nem replaceEolAgnostic", () => {
    const dir = createTempDir("eol-anchor-")
    fs.writeFileSync(path.join(dir, "safe3.ts"), "const s = content.replace(anchor, \"\")\n", "utf8")
    fs.writeFileSync(
      path.join(dir, "safe4.ts"),
      `const s = replaceEolAgnostic(content, "job fuzz:${NL_ESC}", "", "label")\n`,
      "utf8",
    )
    const { status, stdout } = runCli({ root: dir })
    expect(status).toBe(0)
    expect(stdout).toContain("clean")
  }, 60000)
})

describe("scan-eol-anchor.mjs - CLI", () => {
  it("BASELINE: repo REAL com zero violacoes (exit 0) - os 8 sites historicos refatorados", () => {
    const { status, stdout } = runCli({ root: process.cwd() })
    expect(status).toBe(0)
    expect(stdout).toContain("clean")
    expect(stdout).toContain("file(s) scanned")
  }, 60000)

  it("companion: a superficie escaneada NAO pode ser vazia (BASELINE companion)", () => {
    const { status, stdout } = runCli({ root: process.cwd() })
    expect(status).toBe(0)
    const m = stdout.match(/(\d+) file\(s\) scanned/)
    expect(m).not.toBeNull()
    expect(Number(m?.[1] ?? "0")).toBeGreaterThan(0)
  }, 60000)

  it("MUTATION: padrao cru -> exit 1 com o caminho exato (file:line)", () => {
    const dir = createTempDir("eol-anchor-")
    writeRawAnchorFile(dir, "scripts/__tests__/new-mutation.test.ts")
    fs.writeFileSync(path.join(dir, "scripts", "ok.ts"), "const x = 1\n", "utf8")
    const { status, stderr } = runCli({ root: dir })
    expect(status).toBe(1)
    expect(stderr).toContain("scripts/__tests__/new-mutation.test.ts:1")
  }, 60000)

  it("MUTATION clean: replaceEolAgnostic no mesmo conteudo -> exit 0 (o idioma certo)", () => {
    const dir = createTempDir("eol-anchor-")
    fs.writeFileSync(
      path.join(dir, "mutation.test.ts"),
      `const s = replaceEolAgnostic(content, "job fuzz:${NL_ESC}", "", "label")\n`,
      "utf8",
    )
    const { status, stdout } = runCli({ root: dir })
    expect(status).toBe(0)
    expect(stdout).toContain("clean")
  }, 60000)

  it("USAGE: flag desconhecida -> exit 2 com usage no stderr", () => {
    const { status, stderr } = runCli({ root: process.cwd(), extraArgs: ["--bogus"] })
    expect(status).toBe(2)
    expect(stderr).toContain("usage: node scripts/scan-eol-anchor.mjs [--ci]")
  }, 60000)
})

describe("scan-eol-anchor.mjs - entry-point guard (IS_MAIN, sec 11.37 ACHADO fechado)", () => {
  interface EolAnchorModule {
    main: (argv?: string[]) => number
    scanEolAnchors: (root?: string) => { files: string[]; violations: { path: string; line: number }[] }
  }

  it("IMPORT: importar o modulo NAO varre a superficie nem seta exitCode - o ACHADO da 11.37 fechado", async () => {
    // The 11.37 probe proved the bug: `process.exitCode = main()` ran on
    // EVERY import - the probe file itself was flagged and the process
    // exitCode was set. The IS_MAIN guard (mirror scan-timeouts.mjs) fixes
    // it. Proof: a POISONED synthetic surface + a fresh dynamic import
    // (cache-busted) must NOT scan (exitCode untouched, nothing written) -
    // and the embedded counterfactual: calling scanEolAnchors() EXPLICITLY
    // on that same surface DOES find the violation (the detector works, the
    // import just does not auto-run it - deliberate, never a dead module).
    const dir = createTempDir("eol-anchor-import-")
    writeRawAnchorFile(dir, "mutate.mjs")
    const prevEnv = process.env.EOL_ANCHOR_SCAN_ROOT
    process.env.EOL_ANCHOR_SCAN_ROOT = dir
    const prevExitCode = process.exitCode
    try {
      const mod = (await import(
        pathToFileURL(SCRIPT).href + `?import-test=${Date.now()}`,
      )) as unknown as EolAnchorModule
      // The module is importable and exposes the pure functions (the reason
      // it gets imported at all - unit tests of the parsing).
      expect(typeof mod.main).toBe("function")
      expect(typeof mod.scanEolAnchors).toBe("function")
      // The bug's observable (11.37): the import must NOT have set exitCode.
      expect(process.exitCode).toBe(prevExitCode)
      // The embedded counterfactual: the SAME poisoned surface IS scanned
      // when the function runs explicitly - the import no-scan is the guard
      // at work, not a detector that stopped working.
      expect(mod.scanEolAnchors().violations).toHaveLength(1)
    } finally {
      if (prevEnv === undefined) delete process.env.EOL_ANCHOR_SCAN_ROOT
      else process.env.EOL_ANCHOR_SCAN_ROOT = prevEnv
    }
  }, 60000)
})
