/**
 * check-readme-anchors.test.ts
 *
 * Testes unitários das funções PURAS de scripts/check-readme-anchors.mjs
 * (guard que valida os links internos `#slug` do README contra o slug REAL
 * gerado pelo algoritmo do GitHub slugger aplicado aos headings — falhando o
 * PR se um heading for renomeado sem atualizar os links).
 *
 * Cobre:
 *   - slugify: lowercase, pontuação removida, ACENTOS preservados (é/ó),
 *     em dash (—) removido, espaços→hífens SEM colapso nem trim
 *   - extractHeadings: fence-aware (comentários bash `# ...` em code blocks
 *     NÃO são headings), sufixo -1/-2 para headings duplicados
 *   - extractInternalLinks: fence-aware, spans de código inline ignorados,
 *     imagens `![...]` ignoradas, links de arquivo/URL ignorados
 *   - checkAnchors: link válido → sem violação; heading renomeado → violação
 *     com sugestão do heading mais próximo (Levenshtein)
 *   - tokenize (reverse): stopwords PT/EN, acentos preservados, prosa vazia
 *   - checkAnchorSemantics (reverse): label ↔ heading — link aponta para o
 *     heading errado mas resolve → violação com sugestão; label de prosa
 *     exento; breadcrumb (ex.: 'Encoding Guards → X') sem falso positivo
 *   - Regressão REAL do README: TODAS as âncoras atuais resolvem (ground
 *     truth — incluindo #por-que-o-guard-de-crlf-é-sh-only-... e
 *     #evidência-empírica-log-real-do-act--bug-do-setup-bun) e o reverse
 *     tem 0 falsos positivos nos 13 links reais
 */

import { describe, it, expect } from "vitest"
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  slugify,
  extractHeadings,
  extractInternalLinks,
  checkAnchors,
  checkAnchorSemantics,
  tokenize,
  levenshtein,
  jaccard,
  discoverDocTargets,
} from "../../../scripts/check-readme-anchors.mjs"

// ── slugify (algoritmo github-slugger) ─────────────────────────────────────

describe("slugify (github-slugger)", () => {
  it("lowercase + espaços → hífens", () => {
    expect(slugify("CRLF Guard")).toBe("crlf-guard")
  })

  it("preserva ACENTOS (é/ó) — âncora real do README", () => {
    expect(slugify("Auditoria histórica de blobs CRLF")).toBe("auditoria-histórica-de-blobs-crlf")
  })

  it("regressão real: heading .sh-only com backticks, pontos e parênteses", () => {
    // ### Por que o guard de CRLF é `.sh`-only (decisão ESCOPO INTENCIONAL)
    const text = "Por que o guard de CRLF é `.sh`-only (decisão ESCOPO INTENCIONAL)"
    expect(slugify(text)).toBe("por-que-o-guard-de-crlf-é-sh-only-decisão-escopo-intencional")
  })

  it("em dash (—) é REMOVIDO e NÃO colapsa hífens — âncora real com --", () => {
    // #### Evidência empírica (log real do act — bug do setup-bun)
    const text = "Evidência empírica (log real do act — bug do setup-bun)"
    expect(slugify(text)).toBe("evidência-empírica-log-real-do-act--bug-do-setup-bun")
  })

  it("regressão real: path em backticks vira slug sem pontuação", () => {
    // ### Medição real do setup-bun no CI (`scripts/bench-setup-bun.sh`)
    const text = "Medição real do setup-bun no CI (`scripts/bench-setup-bun.sh`)"
    expect(slugify(text)).toBe("medição-real-do-setup-bun-no-ci-scriptsbench-setup-bunsh")
  })

  it("regressão real: 'out=' remove o '='", () => {
    expect(slugify("Single-line out= Guard")).toBe("single-line-out-guard")
  })

  it("NÃO trima hífens das pontas e NÃO colapsa espaços duplos", () => {
    // dois espaços seguidos → dois hífens (github-slugger não colapsa)
    expect(slugify("a  b")).toBe("a--b")
  })
})

// ── levenshtein ────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("0 para strings iguais, tamanhos para strings vazias", () => {
    expect(levenshtein("abc", "abc")).toBe(0)
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })

  it("conta edições simples", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
    // crlf-guard → crlf-gate: "guard"→"gate" = u del + r→t + d→e = 3
    expect(levenshtein("crlf-guard", "crlf-gate")).toBe(3)
  })
})

// ── jaccard (similaridade de tokens — ranking da sugestão reverse) ─────────

describe("jaccard", () => {
  it("1.0 para conjuntos idênticos, 0.0 para disjuntos", () => {
    expect(jaccard(["crlf", "guard"], ["crlf", "guard"])).toBe(1)
    expect(jaccard(["crlf"], ["normalizador"])).toBe(0)
  })

  it("frações para sobreposição parcial (|A∩B| / |A∪B|)", () => {
    expect(jaccard(["crlf", "guard"], ["crlf", "guard", "alfa"])).toBeCloseTo(2 / 3)
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3)
  })

  it("ORDEM-INSENSÍVEL: reordenação não muda o score (a vantagem sobre Levenshtein)", () => {
    expect(jaccard(["crlf", "guard"], ["guard", "crlf"])).toBe(1)
  })

  it("aceita Set como entrada e trata dois vazios como idênticos", () => {
    expect(jaccard(new Set(["crlf", "guard"]), ["guard", "crlf"])).toBe(1)
    expect(jaccard([], [])).toBe(1)
    expect(jaccard(["a"], [])).toBe(0)
  })
})

// ── extractHeadings ────────────────────────────────────────────────────────

describe("extractHeadings", () => {
  it("extrai headings ATX com nível e slug", () => {
    const headings = extractHeadings("# Título\n## Seção A\n### Sub A")
    expect(headings).toHaveLength(3)
    expect(headings[0]).toMatchObject({ line: 1, level: 1, slug: "título" })
    expect(headings[1]).toMatchObject({ line: 2, level: 2, slug: "seção-a" })
    expect(headings[2]).toMatchObject({ line: 3, level: 3, slug: "sub-a" })
  })

  it("ignora linhas `# ...` DENTRO de fences (comentários bash não são headings)", () => {
    const content = [
      "## Quick Start",
      "```bash",
      "# 1. Install dependencies",
      "# 2. Start infrastructure",
      "bun install",
      "```",
      "## Depois",
    ].join("\n")
    const headings = extractHeadings(content)
    expect(headings).toHaveLength(2)
    expect(headings.map((h) => h.slug)).toEqual(["quick-start", "depois"])
  })

  it("headings duplicados ganham sufixo -1, -2 (como o GitHub)", () => {
    const headings = extractHeadings("## X\n## X\n## X")
    expect(headings.map((h) => h.slug)).toEqual(["x", "x-1", "x-2"])
  })
})

// ── extractInternalLinks ───────────────────────────────────────────────────

describe("extractInternalLinks", () => {
  it("extrai links inline [label](#slug) com a linha", () => {
    const links = extractInternalLinks(
      "Veja [CRLF Guard](#crlf-guard) e [Normalizador](#normalizador).",
    )
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ line: 1, slug: "crlf-guard", label: "CRLF Guard" })
  })

  it("ignora links dentro de fences e spans de código inline", () => {
    const content = [
      "Texto",
      "```text",
      "[fake](#nao-existe)",
      "```",
      "`[tambem-nao](#code-span)`",
    ].join("\n")
    const links = extractInternalLinks(content)
    expect(links).toEqual([])
  })

  it("ignora imagens ![alt](#...) e links de arquivo/URL", () => {
    const content = "![img](#figura) [x](docs/foo.md#bar) [y](https://x.com/#z) [ok](#real)"
    const links = extractInternalLinks(content)
    expect(links).toHaveLength(1)
    expect(links[0].slug).toBe("real")
  })
})

// ── tokenize (normalização semântica do reverse) ───────────────────────────

describe("tokenize", () => {
  it("lowercase + remove pontuação/backticks, preserva acentos PT", () => {
    expect(tokenize("CRLF Guard")).toEqual(["crlf", "guard"])
    expect(tokenize("Por que é `.sh`-only?")).toEqual(["sh", "only"])
  })

  it("remove stopwords PT/EN", () => {
    expect(tokenize("fluxo de medição")).toEqual(["fluxo", "medição"])
    expect(tokenize("the Encoding Guards of")).toEqual(["encoding", "guards"])
  })

  it("label vazio/prosa genérica → tokens vazios", () => {
    expect(tokenize("de e em a")).toEqual([])
  })
})

// ── checkAnchorSemantics (reverse: label ↔ heading) ───────────────────────

describe("checkAnchorSemantics", () => {
  it("label presente no heading resolvido → sem violações", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    expect(checkAnchorSemantics(content)).toEqual([])
  })

  it("link para heading ERRADO mas que resolve → violação com sugestão", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)", // aponta para o heading errado
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Normalizador",
    ].join("\n")
    const violations = checkAnchorSemantics(content)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      line: 3,
      slug: "normalizador",
      label: "CRLF Guard",
      heading: "Normalizador",
    })
    // sugere o heading que contém o label
    expect((violations[0] as { suggestion: string }).suggestion).toBe("crlf-guard")
  })

  it("sugestão rankeia por JACCARD (tokens) e não por Levenshtein puro — reordenação vence tokens extras", () => {
    // Label 'CRLF Guard' (tokens {crlf, guard}) aponta para #normalizador.
    // Dois headings casam: 'Guard de CRLF' (tokens {guard, crlf} — Jaccard
    // 1.0, mas Levenshtein alto por reordenação ~12) e 'CRLF Guard Alfa'
    // (tokens {crlf, guard, alfa} — Jaccard 2/3, mas Levenshtein 5 por ser
    // quase prefixo). ANTES (Levenshtein puro) a sugestão seria
    // 'crlf-guard-alfa'; AGORA o Jaccard (ordem-insensível) elege
    // 'guard-de-crlf' — o semanticamente idêntico ao label.
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)",
      "",
      "### Guard de CRLF",
      "### Normalizador",
      "### CRLF Guard Alfa",
    ].join("\n")
    const violations = checkAnchorSemantics(content)
    expect(violations).toHaveLength(1)
    expect((violations[0] as { suggestion: string }).suggestion).toBe("guard-de-crlf")
  })

  it("sugestão: Jaccard EMPATADO → Levenshtein de texto como desempate", () => {
    // Ambos os candidatos têm Jaccard 1.0 ({crlf, guard}) — o desempate é o
    // texto mais próximo por caracteres: 'CRLF Guard' (distância 0) sobre
    // 'Guard de CRLF' (reordenação).
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)",
      "",
      "### Guard de CRLF",
      "### Normalizador",
      "### CRLF Guard",
    ].join("\n")
    const violations = checkAnchorSemantics(content)
    expect(violations).toHaveLength(1)
    expect((violations[0] as { suggestion: string }).suggestion).toBe("crlf-guard")
  })

  it("label de PROSA que não casa com nenhum heading → exento", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [abaixo](#crlf-guard)", // prosa: 'abaixo' não é heading
      "",
      "### CRLF Guard",
    ].join("\n")
    expect(checkAnchorSemantics(content)).toEqual([])
  })

  it("label com tokens extras (ex.: breadcrumb 'Encoding Guards → X') não é falso positivo", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [Encoding Guards → Por que -only?](#por-que-o-guard-de-crlf-é-sh-only-decisão-escopo-intencional)",
      "",
      "### Por que o guard de CRLF é `.sh`-only (decisão ESCOPO INTENCIONAL)",
    ].join("\n")
    // label contém tokens que NÃO estão no heading, mas o conjunto completo
    // do label ('encoding guards only') não casa com nenhum heading inteiro —
    // e os tokens do heading ('only') estão no label → sem violação
    expect(checkAnchorSemantics(content)).toEqual([])
  })

  it("regressão REAL do README: 0 falsos positivos nos 13 links atuais", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o README — pula
    const readme = readFileSync(readmePath, "utf8")
    const violations = checkAnchorSemantics(readme)
    expect(violations, JSON.stringify(violations)).toEqual([])
  })
})

// ── checkAnchorSemantics (strict: --reverse-strict) ───────────────────────

describe("checkAnchorSemantics (strict)", () => {
  it("modo NORMAL: label de UM token não-stopword inexistente em qualquer heading → prosa → exento (brecha)", () => {
    // 'Guard' reduz a 1 token não-stopword que NÃO existe em NENHUM heading —
    // sem a flag strict isso cai na regra 3 (prosa → exento) e escapa.
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#normalizador)", // label single-token, heading sem o token
      "",
      "### Normalizador",
    ].join("\n")
    expect(checkAnchorSemantics(content)).toEqual([])
  })

  it("STRICT: label single-token sem o token em nenhum heading → violação strict", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#normalizador)",
      "",
      "### Normalizador",
    ].join("\n")
    const violations = checkAnchorSemantics(content, { strict: true })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      line: 3,
      slug: "normalizador",
      label: "Guard",
      heading: "Normalizador",
      strict: true,
    })
    // sem sugestão (nenhum heading contém o token — nada a sugerir)
    expect((violations[0] as { suggestion?: string }).suggestion).toBeUndefined()
  })

  it("STRICT: token CURTO (< minSingleTokenLen default 3) é genérico legítimo → permitido", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [OK](#normalizador)", // 'ok' tem 2 chars < threshold 3
      "",
      "### Normalizador",
    ].join("\n")
    expect(checkAnchorSemantics(content, { strict: true })).toEqual([])
  })

  it("STRICT: threshold customizável (minSingleTokenLen 2) passa a sinalizar 'OK'", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [OK](#normalizador)",
      "",
      "### Normalizador",
    ].join("\n")
    const violations = checkAnchorSemantics(content, { strict: true, minSingleTokenLen: 2 })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ label: "OK", strict: true })
  })

  it("STRICT: token que EXISTE em outro heading → regra 4 sinaliza com sugestão (sem violação dupla)", () => {
    // 'Guard' existe no heading 'CRLF Guard' → o strict NÃO dispara (exists
    // elsewhere); a regra 4 (label casa com outro heading) acusa com sugestão.
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#normalizador)",
      "",
      "### CRLF Guard",
      "### Normalizador",
    ].join("\n")
    const violations = checkAnchorSemantics(content, { strict: true })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      line: 3,
      slug: "normalizador",
      label: "Guard",
      heading: "Normalizador",
      suggestion: "crlf-guard",
    })
    // não é a violação strict (tem sugestão e não carrega a flag)
    expect((violations[0] as { strict?: boolean }).strict).toBeUndefined()
  })

  it("STRICT: README limpo (labels corretos) → sem violações", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    expect(checkAnchorSemantics(content, { strict: true })).toEqual([])
  })

  it("STRICT: label single-token cujo token ESTÁ no heading resolvido → regra 2 precede o strict (exento)", () => {
    // 'Guard' é um token não-stopword SIGNIFICATIVO (len 5 >= 3) — mas o token
    // ESTÁ no heading resolvido ('CRLF Guard'), então a regra 2 (label inteiro
    // presente → OK) continua precedendo o bloco strict. Trava a ordem das
    // regras contra uma futura reordenação.
    const content = ["## Encoding Guards", "", "- [Guard](#crlf-guard)", "", "### CRLF Guard"].join(
      "\n",
    )
    expect(checkAnchorSemantics(content, { strict: true })).toEqual([])
  })
})

// ── discoverDocTargets (auto-descoberta de docs/*.md no scan default) ────

describe("discoverDocTargets", () => {
  it("docs/ existe → retorna docs/*.md ORDENADOS, ignorando não-.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "cra-docs-"))
    try {
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(dir, "docs/z.md"), "", "utf8")
      writeFileSync(join(dir, "docs/a.md"), "", "utf8")
      writeFileSync(join(dir, "docs/nota.txt"), "", "utf8")
      expect(discoverDocTargets(dir)).toEqual(["docs/a.md", "docs/z.md"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("docs/ AUSENTE → [] (skip silencioso — fixtures de mutation/CLI em temp dirs)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cra-nodocs-"))
    try {
      writeFileSync(join(dir, "README.md"), "ok", "utf8")
      expect(discoverDocTargets(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── checkAnchors ───────────────────────────────────────────────────────────

const FIXTURE_OK = [
  "## Encoding Guards",
  "",
  "- [CRLF Guard](#crlf-guard)",
  "- [Auditoria histórica](#auditoria-histórica)",
  "- [Single-line out=](#single-line-out)",
  "",
  "### CRLF Guard",
  "### Auditoria histórica",
  "### Single-line out=",
].join("\n")

describe("checkAnchors", () => {
  it("todos os links válidos → sem violações", () => {
    expect(checkAnchors(FIXTURE_OK)).toEqual([])
  })

  it("heading renomeado sem atualizar link → violação com sugestão do mais próximo", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-gard)", // typo/renomeação
      "",
      "### CRLF Guard",
    ].join("\n")
    const violations = checkAnchors(content)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 3, slug: "crlf-gard", label: "CRLF Guard" })
    // sugere o heading mais próximo por Levenshtein
    expect(violations[0].closest).toBe("crlf-guard")
    expect(violations[0].distance).toBe(1)
  })

  it("link totalmente órfão → violação sem closest", () => {
    const violations = checkAnchors("Veja [fantasma](#nao-existe-nenhum-heading).")
    expect(violations).toHaveLength(1)
    expect(violations[0].closest).toBeUndefined()
  })

  it("link duplicado (heading #x e #x-1) resolve — sufixo do GitHub", () => {
    const content = ["## X", "## X", "", "veja [#x](#x) e [#x-1](#x-1)"].join("\n")
    expect(checkAnchors(content)).toEqual([])
  })

  it("regressão REAL do README: todas as âncoras atuais resolvem", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o README — pula
    const readme = readFileSync(readmePath, "utf8")
    const violations = checkAnchors(readme)
    expect(violations, JSON.stringify(violations)).toEqual([])
  })

  it("regressão REAL: TODAS as âncoras internas de docs/*.md resolvem (ground truth)", () => {
    const docsDir = join(process.cwd(), "docs")
    if (!existsSync(docsDir)) return // ambiente sem docs/ — pula
    const docs = readdirSync(docsDir)
      .filter((n) => n.endsWith(".md"))
      .sort()
    expect(docs.length).toBeGreaterThan(0)
    for (const name of docs) {
      const content = readFileSync(join(docsDir, name), "utf8")
      const violations = checkAnchors(content)
      expect(violations, `docs/${name}: ${JSON.stringify(violations)}`).toEqual([])
    }
  })
})
