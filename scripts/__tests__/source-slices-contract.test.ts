/**
 * source-slices-contract.test.ts - sec 11.103: the STRUCTURAL pin of the
 * 'guard that passes vacuously when the target disappears' class (the Prova 17
 * ACHADO, sec 8.14).
 *
 * The 11.84 form guard (hook-proof-run.test.ts) slices hook-proof-run.mjs by
 * string markers ('export function revertCycle' .. 'export function main')
 * and depends on FAIL-LOUD asserts of those markers to never slice empty or
 * wrong text. That fix is PER-SITE. THIS suite pins the class: every
 * indexOf-fed slice in the repo (scripts/*.mjs + scripts/__tests__/*.ts)
 * must EITHER carry a fail-loud check naming its marker, OR be a decided
 * boundary listed in DOCUMENTED_SLICES.
 *
 * Accepted fail-loud forms (the repo's conventions):
 *   - `if (X === -1) throw`          (sec81Text, sectionBetween, typeD/E/F)
 *   - `if (X < 0) throw`             (extractChartData)
 *   - `if (X < 0) continue`          (scan-timeouts parser: the slice NEVER
 *     runs with -1; the call-site count is baseline-pinned, so a silent
 *     drop fails the REAL-REPO CONTRACT instead)
 *   - `expect(X).not.toBe(-1)`       (test assertions)
 *   - `expect(X).toBeGreaterThan(0)` / `expect(X).toBeGreaterThanOrEqual(0)`
 *   - `expect(X, \"msg\").toBeGreaterThan(...)` (o 2o argumento de MENSAGEM do
 *     expect nao quebra a forma - a variante do dryOpen da sec 11.116 no
 *     ci-proof-run.test.ts, `expect(dryOpen, \"o guard 'if (opts.dryRun) {'...\")
 *     .toBeGreaterThan(-1)`)
 *   - `expect(X).toBeGreaterThan(Y)` (the 11.84 + sec 8.38 guards: the pair
 *     end > start proves BOTH markers exist - an indexOf can only be -1 or
 *     >= 0, so X > Y >= -1 is a marker-existence assert)
 *
 * String literals are MASKED before the site scan (the masking culture of
 * the repo's detectors), so prose/fixtures that merely MENTION the shapes
 * (this suite's own docblock and mutation strings) never register as sites.
 * An INLINE `text.slice(text.indexOf(m))` is an offender by construction: no
 * variable exists to carry the fail-loud check - the marker must be ASSIGNED
 * first (the bundle-report fix does exactly that, sec 11.103). Scope note:
 * only vars that feed a `.slice()`/`.substring()` argument DIRECTLY are
 * sites; check-js-budget's `start` feeds its slice transitively via `i` and
 * stays outside the scan (it is fail-loud anyway).
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SCRIPTS_DIR = path.join(ROOT, "scripts")
const TESTS_DIR = path.join(SCRIPTS_DIR, "__tests__")

interface SliceSite {
  file: string
  line: number
  var: string | null
  marker: string
}

type Classified = SliceSite & { kind: "fail-loud" | "offender" }

/** The DECIDED boundaries: slices that intentionally do not throw. */
const DOCUMENTED_SLICES: Array<{ file: string; var: string; why: string }> = [
  {
    file: "scripts/hook-proof-run.mjs",
    var: "idx",
    why: "injectDocClaim: append-fallback - a mutacao NUNCA quebra o ciclo de prova (o claim e inserido no fim mesmo sem o anchor '## 12.'); o comportamento e pinado pelo teste 'doc sem ## 12.' da suite hook-proof-run (sec 11.98)",
  },
  {
    file: "scripts/__tests__/fail-input-cites.ts",
    var: "btIdx",
    why: "failMsgInputCites (sec 11.115): o btIdx < 0 e um SKIP legitimo - um fail sem-template (fail(1, check.message)-style) nao tem backtick e o skip avanca para o proximo fail(; o site MIGROU do ci-proof-run.test.ts para a fonte unica compartilhada na sec 11.115, e a corretude da varredura e pinada pelos ABS PINs de 17 citacoes do ci (11.105) e 31 do hook (11.115) (se a derivada perdesse um span, o pin diverge e falha)",
  },
]

/** Block/function start markers - bounds the enclosing region of a site. */
const BLOCK_START_RE =
  /^\s*(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\(|^\s*(?:it|describe|test|beforeEach|afterEach)\(/

function markerOf(expr: string): string {
  const m = expr.match(/"([^"]{1,40})"/)
  return m ? m[1] : "(var)"
}

/** String literals masked to spaces (quotes kept) before the site scan. */
function maskStrings(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'/g, (m) => "'" + " ".repeat(Math.max(m.length - 2, 0)) + "'")
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => '"' + " ".repeat(Math.max(m.length - 2, 0)) + '"')
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => "`" + " ".repeat(Math.max(m.length - 2, 0)) + "`")
}

/** Pattern A: `const x = ... .indexOf(m)`. Pattern B: inline slice. */
function findSites(text: string, file: string): SliceSite[] {
  const sites: SliceSite[] = []
  const lines = text.split(/\r?\n/)
  const masked = lines.map(maskStrings)
  const assigned = /(?:const|let)\s+(\w+)\s*=\s*([^;\n]*\.indexOf\([^;\n]*)/
  const inline = /(?:\.slice|\.substring|\.substr)\(\s*([^)]*\.indexOf\([^)]*)/
  masked.forEach((line, idx) => {
    const a = line.match(assigned)
    if (a) {
      sites.push({ file, line: idx + 1, var: a[1], marker: markerOf(lines[idx]) })
      return
    }
    const b = line.match(inline)
    if (b) sites.push({ file, line: idx + 1, var: null, marker: markerOf(lines[idx]) })
  })
  return sites
}

/** The lines of the enclosing block/function (bounded by block markers). */
function blockSpan(lines: string[], siteLine: number): string {
  let start = siteLine - 1
  for (let i = siteLine - 2; i >= 0; i--) {
    if (BLOCK_START_RE.test(lines[i])) {
      start = i
      break
    }
  }
  let end = lines.length
  for (let i = siteLine; i < lines.length; i++) {
    if (BLOCK_START_RE.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

function sliceReferenced(span: string, v: string): boolean {
  return new RegExp(`\\.(?:slice|substring|substr)\\([^)]*\\b${v}\\b`).test(span)
}

function failLoud(span: string, v: string): boolean {
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const forms = [
    `if\\s*\\([^;\\n]*\\b${esc}\\b\\s*=== -1[^\\n]*throw`,
    `if\\s*\\([^;\\n]*\\b${esc}\\b\\s*< 0[^\\n]*throw`,
    `if\\s*\\([^;\\n]*\\b${esc}\\b\\s*< 0[^\\n]*continue`,
    `expect\\s*\\(\\s*\\b${esc}\\b\\s*\\)\\.not\\.toBe\\(-1\\)`,
    `expect\\s*\\(\\s*\\b${esc}\\b\\s*\\)\\.toBeGreaterThan\\(0\\)`,
    `expect\\s*\\(\\s*\\b${esc}\\b\\s*\\)\\.toBeGreaterThanOrEqual\\(0\\)`,
    `expect\\s*\\(\\s*\\b${esc}\\b\\s*\\)\\.toBeGreaterThan\\(`,
    // a variante com MENSAGEM (2o arg = string literal): o dryOpen da sec
    // 11.116 usa `expect(dryOpen, "o guard 'if (opts.dryRun) {'...")
    // .toBeGreaterThan(-1)` - o [^"]* tolera o ')' DENTRO da mensagem (o
    // [^)]* pararia no ')' de (opts.dryRun) e a forma nao casaria - um
    // falso offender; a corretude fica pinada pelo ABS PIN + a MUTATION
    // do bundle (o expect sem mensagem segue na forma sem-comentario).
    `expect\\s*\\(\\s*\\b${esc}\\b\\s*,\\s*"[^"]*"\\s*\\)\\.toBeGreaterThan\\(`,
  ]
  return forms.some((f) => new RegExp(f).test(span))
}

function classifyText(rel: string, text: string): Classified[] {
  const lines = text.split(/\r?\n/)
  const out: Classified[] = []
  for (const site of findSites(text, rel)) {
    if (site.var === null) {
      out.push({ ...site, kind: "offender" })
      continue
    }
    const span = blockSpan(lines, site.line)
    if (!sliceReferenced(span, site.var)) continue
    out.push({ ...site, kind: failLoud(span, site.var) ? "fail-loud" : "offender" })
  }
  return out
}

function scanFiles(): string[] {
  const mjs = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => path.join(SCRIPTS_DIR, f))
  const tss = fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(TESTS_DIR, f))
  return [...mjs, ...tss]
}

function classifySites(): Classified[] {
  const all: Classified[] = []
  for (const file of scanFiles()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/")
    all.push(...classifyText(rel, fs.readFileSync(file, "utf8")))
  }
  return all
}

const documented = (s: Classified): boolean =>
  DOCUMENTED_SLICES.some((d) => d.file === s.file && d.var === s.var)

describe("SOURCE SLICES contract (sec 11.103)", () => {
  it("INVARIANT: todo slice indexOf-fed e fail-loud ou fronteira documentada", () => {
    const sites = classifySites()
    const offenders = sites.filter((s) => s.kind === "offender" && !documented(s))
    const stale = sites.filter((s) => s.kind === "fail-loud" && documented(s))
    // the message carries the full offender list (file:line:var) so a drift
    // fails with the exact site, never a bare diff
    expect(offenders.map((o) => `${o.file}:${o.line}:${o.var}`), `offenders: ${JSON.stringify(offenders)}`).toEqual([])
    // the reverse direction (reviewer nit, sec 11.103): a documented boundary
    // whose site became fail-loud is STALE - the entry must be removed
    expect(stale.map((s) => `${s.file}:${s.line}:${s.var}`), `stale-documented: ${JSON.stringify(stale)}`).toEqual([])
  })

  it("INVARIANT: fronteira documentada nunca orfa (o site existe no scan)", () => {
    const sites = classifySites()
    for (const d of DOCUMENTED_SLICES) {
      expect(sites.some((s) => s.file === d.file && s.var === d.var)).toBe(true)
    }
  })

  it("ABS PIN: os sites derivados (file, line, var, marker)", () => {
    const snapshot = classifySites().map((s) => [s.file, s.line, s.var, s.marker] as const)
    // the message carries the FULL derived list so a drift is self-diagnosing
    expect(snapshot, `derived: ${JSON.stringify(snapshot)}`).toEqual([
      ["scripts/hook-proof-run.mjs", 243, "idx", "(var)"],
      ["scripts/scan-timeouts.mjs", 361, "openIdx", "("],
      ["scripts/scan-unit-config.mjs", 81, "i", "## 8.1 "],
      ["scripts/scan-unit-config.mjs", 82, "j", "## 8.2 "],
      ["scripts/__tests__/bundle-report-gate.test.ts", 576, "rotasIdx", "## Rotas (real transfer"],
      ["scripts/__tests__/ci-proof-run.test.ts", 1469, "dryOpen", "if (opts.dryRun) {"],
      ["scripts/__tests__/fail-input-cites.ts", 39, "btIdx", "`"],
      ["scripts/__tests__/hook-proof-run.test.ts", 232, "idx12", "## 12."],
      ["scripts/__tests__/hook-proof-run.test.ts", 432, "start", "export function revertCycle"],
      ["scripts/__tests__/hook-proof-run.test.ts", 433, "end", "export function main"],
      ["scripts/__tests__/hook-proof-run.test.ts", 1072, "secStart", "## 8.38 "],
      ["scripts/__tests__/hook-proof-run.test.ts", 1073, "secEnd", "## 8.39 "],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 122, "i", "(var)"],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 124, "j", "(var)"],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 319, "i", "### Type D"],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 321, "j", "### Type E"],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 328, "i", "### Type E"],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 330, "j", "### Type F"],
      ["scripts/__tests__/scan-surfaces-contract.test.ts", 337, "i", "### Type F"],
    ])
  })

  it("MUTATION: remover o throw do j no typeDText -> offender com file+var", () => {
    // o checkout pode trazer o alvo CRLF (o .gitattributes text=auto):
    // normaliza para LF antes da mutacao - as strings de mutacao sao LF-only
    // e um replace com \r\n no alvo no-oparia (o expect(...).not.toBe(src)
    // falharia na suite hermEtica, nao na mutacao).
    const src = fs
      .readFileSync(path.join(TESTS_DIR, "scan-surfaces-contract.test.ts"), "utf8")
      .replace(/\r\n/g, "\n")
    const tolerant = src.replace(
      '  const j = doc.indexOf("### Type E", i)\n  if (j === -1) throw new Error(`scan-surfaces.md: header "### Type E" not found after "### Type D" - update this extractor`)\n  return doc.slice(i, j)',
      '  const j = doc.indexOf("### Type E", i)\n  return j === -1 ? doc.slice(i) : doc.slice(i, j)'
    )
    expect(tolerant).not.toBe(src)
    const offenders = classifyText("scripts/__tests__/scan-surfaces-contract.test.ts", tolerant).filter(
      (s) => s.kind === "offender"
    )
    expect(offenders.map((o) => o.var)).toContain("j")
    expect(offenders.find((o) => o.var === "j")?.file).toBe("scripts/__tests__/scan-surfaces-contract.test.ts")
  })

  it("MUTATION: remover o expect do rotasIdx no bundle-report -> offender", () => {
    // o checkout pode trazer o alvo CRLF (o .gitattributes text=auto):
    // normaliza para LF antes da mutacao (as strings de mutacao sao LF-only).
    const src = fs
      .readFileSync(path.join(TESTS_DIR, "bundle-report-gate.test.ts"), "utf8")
      .replace(/\r\n/g, "\n")
    const mutated = src.replace(
      'const rotasIdx = md.indexOf("## Rotas (real transfer")\n    expect(rotasIdx).not.toBe(-1) // fail-loud (sec 11.103): a moved marker must not become md.slice(-1)',
      'const rotasIdx = md.indexOf("## Rotas (real transfer")'
    )
    expect(mutated).not.toBe(src)
    const offenders = classifyText("scripts/__tests__/bundle-report-gate.test.ts", mutated).filter(
      (s) => s.kind === "offender"
    )
    expect(offenders.map((o) => o.var)).toContain("rotasIdx")
  })

  it("MUTATION: o site idx do injectDocClaim some -> a fronteira documentada vira orfa", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "hook-proof-run.mjs"), "utf8")
    const mutated = src.replace("const idx = doc.indexOf(anchor)", "const idx = doc.search(anchor)")
    expect(mutated).not.toBe(src)
    const sites = classifyText("scripts/hook-proof-run.mjs", mutated)
    expect(sites.some((s) => s.var === "idx")).toBe(false)
  })
})
