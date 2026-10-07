/**
 * check-inline-style.test.ts
 *
 * Testes do guard scripts/check-inline-style.mjs — reprova `<style>` inline
 * em .tsx do app fora da allowlist (a CSP não tem 'unsafe-inline' em
 * style-src-elem; o único pin é o hash do global-error).
 *
 * Cobre:
 *   - Funções puras: blanking de comentários/strings, detecção de `<style`
 *     em JSX (elemento/self-closing/atributos), exclusão de testes e
 *     allowlist, e a prova do hash (global-error ⇄ csp.ts).
 *   - CLI real (spawnSync, padrão check-clock-bombs-cli): repo fake com
 *     violação → exit 1; falso positivo em comentário → exit 0; global-error
 *     allowlistado com hash casando → exit 0; hash editado → exit 1; e o
 *     repo REAL do projeto → exit 0 (com asserção de que a regra tem sujeito:
 *     o global-error renderiza <style> hoje e o hash casa).
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  blankCommentsAndStrings,
  findStyleRenderLines,
  isTestFile,
  isAllowlisted,
  checkInlineStyles,
  extractGlobalErrorStyles,
  extractCspStyleHash,
  sha256Base64,
  checkGlobalErrorHashPin,
  ALLOWLIST,
} from "../../../scripts/check-inline-style.mjs"

const SCRIPT = join(process.cwd(), "scripts", "check-inline-style.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "inline-style-cli-"))

/** Roda o guard num cwd arbitrário (CLI real). */
function runGuard(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Repo fake com src/ contendo os arquivos .tsx/.ts dados. */
function makeFakeRepo(name: string, files: Record<string, string>): string {
  const dir = join(ROOT_TMP, name)
  for (const [fileName, content] of Object.entries(files)) {
    const filePath = join(dir, fileName)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, "utf8")
  }
  return dir
}

// ── Funções puras: blanking + detecção ─────────────────────────────────────

describe("blankCommentsAndStrings", () => {
  it("branqueia comentário de linha preservando o código", () => {
    const out = blankCommentsAndStrings("const a = 1 // <style> citado\nconst b = 2")
    expect(out).toContain("const a = 1")
    expect(out).toContain("const b = 2")
    expect(out).not.toContain("<style>")
  })

  it("branqueia JSDoc multilinha citando <style>", () => {
    const out = blankCommentsAndStrings("/**\n * usa <style> inline\n */\nconst x = 1")
    expect(out).not.toContain("<style>")
    expect(out).toContain("const x = 1")
  })

  it("branqueia comentário JSX {/* */} multilinha", () => {
    const out = blankCommentsAndStrings("(<div>\n{/* <style> migrado para globals.css */}\n</div>)")
    expect(out).not.toContain("<style>")
  })

  it("// dentro de string (URL) não abre comentário", () => {
    const out = blankCommentsAndStrings(`const url = "https://fonts.googleapis.com/x"`)
    expect(out).toContain("const url")
  })

  it("template literal multilinha é branqueado por inteiro", () => {
    const out = blankCommentsAndStrings("const css = `\n.foo { color: red }\n`\nconst ok = 1")
    expect(out).not.toContain("color: red")
    expect(out).toContain("const ok = 1")
  })

  it("preserva quebras de linha (número de linha estável)", () => {
    const blanked = blankCommentsAndStrings("a\nb\nc")
    expect(blanked.split("\n")).toHaveLength(3)
  })
})

describe("findStyleRenderLines", () => {
  it("detecta <style> elemento simples", () => {
    expect(findStyleRenderLines("return (\n  <style>{css}</style>\n)")).toEqual([
      { line: 2, text: "<style>{css}</style>" },
    ])
  })

  it("detecta <style self-closing /> e <style com atributos", () => {
    const hits = findStyleRenderLines('<style id="x" />\n<style dangerouslySetInnerHTML={{}} />')
    expect(hits).toHaveLength(2)
  })

  it("detecta <style> aberto em linha (tag multilinha)", () => {
    expect(findStyleRenderLines("<style\n  dangerouslySetInnerHTML={{}}\n/>")).toEqual([
      { line: 1, text: "<style" },
    ])
  })

  it("NÃO detecta </style> de fechamento nem <styleSheet (prefixo)", () => {
    expect(findStyleRenderLines("</style>\nconst StyleSheet = 1")).toEqual([])
  })

  it("NÃO detecta <style citado em comentário ou string", () => {
    const src = '// usa <style> aqui\nconst s = "<style>x</style>"\n/* <style> */\nrender()'
    expect(findStyleRenderLines(src)).toEqual([])
  })
})

describe("checkInlineStyles / allowlist / testes", () => {
  it("arquivo de teste é sempre ignorado (mesmo com <style> real)", () => {
    expect(isTestFile("src/app/__tests__/loading.test.tsx")).toBe(true)
    expect(isTestFile("e2e/foo.spec.tsx")).toBe(true)
    expect(isTestFile("src/app/page.tsx")).toBe(false)
    expect(checkInlineStyles("src/app/__tests__/x.test.tsx", "<style>{css}</style>")).toEqual([])
  })

  it("allowlist tem UM membro (global-error, hash pinnado), com motivo", () => {
    // O wrapper de charts do shadcn (2º membro original) foi REMOVIDO do repo
    // em 2026-10-02 — código morto sem consumidores; a allowlist encolheu.
    expect(ALLOWLIST.map((a) => a.path)).toEqual(["src/app/global-error.tsx"])
    for (const a of ALLOWLIST) {
      expect(a.reason.length).toBeGreaterThan(20)
      expect(a.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(isAllowlisted("src/app/global-error.tsx")).toBe(true)
    expect(isAllowlisted("src/app/page.tsx")).toBe(false)
    expect(isAllowlisted("src/components/ui/chart.tsx")).toBe(false)
  })

  it("violação real fora da allowlist vem com linha e texto", () => {
    const violations = checkInlineStyles(
      "src/components/bad.tsx",
      'export function Bad() {\n  return <style>{"x"}</style>\n}',
    )
    expect(violations).toEqual([{ line: 2, text: `return <style>{"x"}</style>` }])
  })
})

// ── Prova do hash (global-error ⇄ csp.ts) ──────────────────────────────────

describe("checkGlobalErrorHashPin", () => {
  const STYLES = ".e{color:red}\n.b{font-weight:700}"
  const globalError = `const styles = \`${STYLES}\`\nexport default () => <style>{styles}</style>`
  const cspFor = (hash: string) =>
    `const directives = [\n  \`style-src-elem 'self' 'sha256-${hash}' https://fonts.googleapis.com\`,\n]`

  it("hash casando → []", () => {
    expect(checkGlobalErrorHashPin(globalError, cspFor(sha256Base64(STYLES)))).toEqual([])
  })

  it("styles editado sem recalcular o hash → violação com os DOIS hashes", () => {
    const violations = checkGlobalErrorHashPin(globalError, cspFor(sha256Base64(".antigo{}")))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain("dessincronizado")
    expect(violations[0]!.message).toContain(sha256Base64(STYLES))
  })

  it("pin removido da CSP → violação (fail-closed)", () => {
    expect(checkGlobalErrorHashPin(globalError, "style-src-elem 'self'")).toHaveLength(1)
  })

  it("styles não extraível (refatorado) → violação acionável", () => {
    expect(checkGlobalErrorHashPin("export default null", cspFor(sha256Base64("x")))).toHaveLength(
      1,
    )
  })

  it("arquivos ausentes (fixtures de CLI) → skip", () => {
    expect(checkGlobalErrorHashPin(null, null)).toEqual([])
  })

  it("extratores: styles e hash saem do texto real", () => {
    expect(extractGlobalErrorStyles(globalError)).toBe(STYLES)
    expect(extractCspStyleHash(cspFor("abc123=="))).toBe("abc123==")
  })
})

// ── CLI real ───────────────────────────────────────────────────────────────

describe("check-inline-style.mjs — CLI real (fast gate)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("componente com <style> inline → exit 1 com linha", () => {
    const dir = makeFakeRepo("t1-violacao", {
      "src/components/bad.tsx": `export function Bad() {\n  return <style>{".x{color:red}"}</style>\n}\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("FORA DA ALLOWLIST")
    expect(out).toContain("src/components/bad.tsx")
    expect(out).toContain("linha 2")
  })

  it("<style> só em comentário/string → exit 0 (sem falso positivo)", () => {
    const dir = makeFakeRepo("t2-comentarios", {
      "src/components/ok.tsx": `/** usa <style>? não — globals.css */\n// <style> inline proibido\nconst s = "<style>x</style>"\nexport const Ok = () => <div />\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhum <style> inline")
  })

  it("global-error allowlistado + CSP com hash correto → exit 0", () => {
    const styles = ".ge{color:blue}"
    const dir = makeFakeRepo("t3-allowlist-ok", {
      "src/app/global-error.tsx": `const styles = \`${styles}\`\nexport default () => <style>{styles}</style>\n`,
      "src/lib/csp.ts": `export const directives = [\n  \`style-src-elem 'self' 'sha256-${sha256Base64(styles)}' https://fonts.googleapis.com\`,\n]\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("hash da CSP sincronizado")
  })

  it("hash da CSP editado sem recalcular → exit 1", () => {
    const dir = makeFakeRepo("t4-hash-quebrado", {
      "src/app/global-error.tsx": `const styles = \`.ge{color:blue}\`\nexport default () => <style>{styles}</style>\n`,
      "src/lib/csp.ts": `export const directives = [\n  \`style-src-elem 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' https://fonts.googleapis.com\`,\n]\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("dessincronizado")
  })

  it("repo REAL do projeto → exit 0 (nenhum <style> fora da allowlist hoje)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("Nenhum <style> inline")
  })

  it("a regra tem sujeito: o global-error real renderiza <style> e o hash casa com a CSP real", () => {
    const ge = readFileSync(join(process.cwd(), "src", "app", "global-error.tsx"), "utf8")
    const csp = readFileSync(join(process.cwd(), "src", "lib", "csp.ts"), "utf8")
    // Sujeito 1: o arquivo allowlistado realmente renderiza <style>.
    expect(findStyleRenderLines(ge).length).toBeGreaterThanOrEqual(1)
    // Sujeito 2: o hash pinado é o do styles ATUAL (a allowlist não é vaga).
    const styles = extractGlobalErrorStyles(ge)
    expect(styles).not.toBeNull()
    expect(checkGlobalErrorHashPin(ge, csp)).toEqual([])
  })
})
