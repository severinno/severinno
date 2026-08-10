/**
 * gates-proofs-ordering.test.ts - CONTRATO de ordenação monotônica das
 * seções numeradas do docs/gates-proofs.md (2026-08-10).
 *
 * WHY: o doc é o decision record da thread de gates — a sua estrutura
 * numerada É a taxonomia (`## N.` top-level, `## N.M` subseções, `### N.M.K`
 * terciárias). O reorder de 2026-08 revelou a classe de regressão: as seções
 * 11.9/11.10/11.11 haviam sido ANEXADAS após a `## 12. Referências` — o doc
 * continuava legível (as seções existem), mas a ordem de leitura quebrava
 * (11.x depois do fim). Este teste trava a classe: TODA seção numerada deve
 * aparecer em ordem ESTRITAMENTE crescente de número de seção (tupla
 * lexicográfica), no padrão dos contratos scan-surfaces/fragile-range.
 *
 * O que é pinado aqui:
 *  1. MONOTÔNIA (o contrato central): a sequência de tuplas numéricas de
 *     todos os headers numerados (`## 8.1` -> [8,1], `### 8.3.1` -> [8,3,1])
 *     é estritamente crescente na ordem do documento. Qualquer seção
 *     anexada fora do lugar (11.x depois de 12, 11.11 antes de 11.10, uma
 *     duplicata) viola.
 *  2. ÂNCORAS: a primeira seção numerada é a 1 e a ÚLTIMA é a 12
 *     (Referências é o fim natural — nada numerado pode vir depois).
 *  3. MUTATION: os testes provam que o parser/checker pegam a classe real
 *     (append de 11.13 após 12; 11.9 após 12 — o incidente; swap 11.10↔11.11)
 *     — não é um assert que "passa por acaso".
 *
 * Parse com regexes direcionadas, não AST de markdown (mesma regra do
 * scan-surfaces-contract): se o formato dos headers driftar, a extração
 * falha com mensagem clara e o extrator é atualizado junto com o doc —
 * falhar alto, nunca ignorar silenciosamente.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const DOC = path.join(process.cwd(), "docs", "gates-proofs.md")

/**
 * Parse a numbered markdown header line into its numeric tuple:
 *   `## 1. Tabela`      -> [1]
 *   `## 8.1 Custo`      -> [8,1]
 *   `### 8.3.1 A prova` -> [8,3,1]
 * Returns null for any other line (non-header, unnumbered header, prose).
 * The trailing period of top-level headers (`## 1.`) is OPTIONAL in the
 * regex so both `## N.` and `## N.M` forms parse identically.
 */
export function parseSectionNumber(line: string): number[] | null {
  const m = line.match(/^#{2,4} (\d+(?:\.\d+)*)\.?(?=\s|$)/)
  if (!m) return null
  return m[1].split(".").map(Number)
}

/** All numbered headers in doc order: [{ line, num, text }]. */
export function numberedSections(doc: string): Array<{ line: number; num: number[]; text: string }> {
  const out: Array<{ line: number; num: number[]; text: string }> = []
  doc.split(/\r?\n/).forEach((l, i) => {
    const num = parseSectionNumber(l)
    if (num) out.push({ line: i + 1, num, text: l.trim() })
  })
  return out
}

/**
 * Lexicographic tuple comparison: -1 / 0 / 1. Shorter tuples compare with
 * -1 padding (a parent `[11]` precedes any child `[11,1]`), so the whole
 * mixed-depth sequence is comparable as one monotonic stream.
 */
export function compareTuples(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1
    const y = b[i] ?? -1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Ordering violations: every section whose tuple is NOT strictly greater
 * than its predecessor (== duplicate or < out-of-order), with the context
 * of the previous section for a precise failure message.
 */
export function orderingViolations(doc: string): Array<{
  line: number
  num: number[]
  text: string
  prevLine: number
  prevNum: number[]
}> {
  const sections = numberedSections(doc)
  const violations: Array<{ line: number; num: number[]; text: string; prevLine: number; prevNum: number[] }> = []
  for (let i = 1; i < sections.length; i++) {
    if (compareTuples(sections[i - 1].num, sections[i].num) >= 0) {
      violations.push({
        line: sections[i].line,
        num: sections[i].num,
        text: sections[i].text,
        prevLine: sections[i - 1].line,
        prevNum: sections[i - 1].num,
      })
    }
  }
  return violations
}

function docText(): string {
  return fs.readFileSync(DOC, "utf8")
}

describe("gates-proofs.md <-> numeração monotônica das seções (doc structure contract)", () => {
  const doc = docText()

  it("the doc file exists and is non-empty (the contract anchor)", () => {
    expect(doc.length).toBeGreaterThan(10_000)
  })

  it("CONTRACT: every numbered header appears in STRICTLY increasing tuple order (the reorder class)", () => {
    const violations = orderingViolations(doc)
    const msg = violations
      .map(
        (v) =>
          `line ${v.line}: [${v.num.join(".")}] "${v.text}" comes after [${v.prevNum.join(".")}] (line ${v.prevLine}) - section out of order: move it to its numeric place (11.x must stay before 12)`,
      )
      .join("\n")
    expect(violations, msg).toEqual([])
  })

  it("ANCHORS: the first numbered section is 1 and the LAST is 12 (nothing may follow Referências)", () => {
    const sections = numberedSections(doc)
    expect(sections.length).toBeGreaterThan(10)
    expect(sections[0].num).toEqual([1])
    expect(sections[sections.length - 1].num).toEqual([12])
  })

  it("MUTATION: a section APPENDED after `## 12. Referências` trips the guard (the exact 11.9/11.10/11.11 incident)", () => {
    const mutated = doc + "\n## 11.13 Fuzz futuristico — anexado depois do fim (a classe proibida)\n"
    const violations = orderingViolations(mutated)
    expect(violations.length).toBe(1)
    expect(violations[0].num).toEqual([11, 13])
    expect(violations[0].prevNum).toEqual([12])
  })

  it("MUTATION: swapped sibling order (11.11 before 11.10) trips the guard", () => {
    // Positional swap of the two header LINES: the sequence becomes
    // ..., 11.9, 11.11, 11.10, 11.12, 12. The ONLY disordered pair is
    // 11.11 -> 11.10, and orderingViolations reports on the SECOND element
    // of the pair -> violations[0].num is [11,10] with prevNum [11,11].
    const line10 = doc.match(/^## 11\.10 .*$/m)![0]
    const line11 = doc.match(/^## 11\.11 .*$/m)![0]
    expect(line10).not.toBe(line11)
    const swapped = doc
      .replace(line10, "__SWAP_A__")
      .replace(line11, "__SWAP_B__")
      .replace("__SWAP_A__", line11)
      .replace("__SWAP_B__", line10)
    const violations = orderingViolations(swapped)
    expect(violations.length).toBe(1)
    expect(violations[0].num).toEqual([11, 10])
    expect(violations[0].prevNum).toEqual([11, 11])
  })

  it("MUTATION: parseSectionNumber handles all three header depths and ignores prose/unnumbered headers", () => {
    expect(parseSectionNumber("## 1. Tabela resumo")).toEqual([1])
    expect(parseSectionNumber("## 12. Referências")).toEqual([12])
    expect(parseSectionNumber("## 8.1 Custo por push")).toEqual([8, 1])
    expect(parseSectionNumber("## 11.12 Fuzz:ci BATCHADO")).toEqual([11, 12])
    expect(parseSectionNumber("### 8.3.1 A prova VITEST")).toEqual([8, 3, 1])
    expect(parseSectionNumber("### 11.2.1 Política")).toEqual([11, 2, 1])
    expect(parseSectionNumber("## 8.10 O loader")).toEqual([8, 10])
    // non-headers / unnumbered headers -> null
    expect(parseSectionNumber("# Title H1")).toBeNull()
    expect(parseSectionNumber("### Sem número")).toBeNull()
    expect(parseSectionNumber("prose line with ## 8.1 inside")).toBeNull()
    expect(parseSectionNumber("")).toBeNull()
  })

  it("MUTATION: compareTuples orders parents before children and across sections (11.x before 12)", () => {
    expect(compareTuples([11], [11, 1])).toBe(-1) // parent before child
    expect(compareTuples([11, 12], [12])).toBe(-1) // ALL of 11.x before 12
    expect(compareTuples([11, 12], [11, 12])).toBe(0)
    expect(compareTuples([12], [11, 13])).toBe(1)
    expect(compareTuples([8], [8, 1])).toBe(-1)
  })
})
