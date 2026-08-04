/**
 * check-readme-toc.test.ts
 *
 * Testes unitários das funções PURAS de scripts/check-readme-toc.mjs — o
 * guard BIDIRECIONAL dos TOCs (índices de seção) do README:
 *
 *   → (forward)  todo link `- [label](#slug)` de um bloco de TOC DEVE
 *                resolver para um heading real (slugs com sufixo -1/-2 de
 *                duplicados inclusos);
 *   ← (reverse)  em toda SEÇÃO que declara um TOC, TODOS os headings filhos
 *                diretos (nível pai+1) DEVEM estar listados — um heading novo
 *                fora do índice falha. Níveis mais profundos (pai+2+) são
 *                exentos (o índice cobre só os sub-blocos diretos).
 *
 * Cobre:
 *   - extractTocBlocks: bloco = run de >=2 bullets consecutivos; bullet
 *     isolado NÃO forma bloco; fence-aware (bullets dentro de ``` não
 *     contam); prosa entre bullets quebra o run
 *   - nearestHeadingAbove: pai mais próximo acima da linha do TOC
 *   - checkToc forward: link quebrado → violação com sugestão (Levenshtein);
 *     link para heading duplicado (#x-1) resolve
 *   - checkToc reverse: heading filho direto fora do índice → violação;
 *     nível mais profundo (pai+2+) é EXENTO; seção SEM TOC não exige nada
 *   - Regressão REAL do README: o mini-índice atual (8 sub-blocos da seção
 *     Encoding Guards) resolve E cobre todos os `###` filhos (ground truth)
 *   - Contrato de PRODUÇÃO do resolveIndexedLevel: blocos EXTRAÍDOS do README
 *     real — para cada bloco, o min calculado bate com o nível dos filhos
 *     diretos (pai + 1), provando que o padrão de nível único se mantém em
 *     produção (não só em fixtures)
 *   - checkToc deep-only guard: TOC sem nenhuma entrada no nível dos filhos
 *     diretos (pai+1) FALHA — deep-only (#### sob ##) rejeitado; seção
 *     profunda legítima (### → ####) e índice misto (### + ####) passam;
 *     TOC no topo do arquivo (sem pai) só forward, sem deep-only
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  extractTocBlocks,
  nearestHeadingAbove,
  resolveIndexedLevel,
  checkToc,
} from "../../../scripts/check-readme-toc.mjs"
import { extractHeadings, discoverDocTargets } from "../../../scripts/check-readme-anchors.mjs"

/** Forma mínima das violações do checkToc (props restantes opcionais). */
type TocViolation = {
  type?: string
  line?: number
  slug?: string
  label?: string
  heading?: string
  suggestion?: string
  closest?: string
  distance?: number
  level?: number
  section?: string
}

// ── extractTocBlocks ───────────────────────────────────────────────────────

describe("extractTocBlocks", () => {
  it("bloco = run de >=2 bullets consecutivos `- [label](#slug)`", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard) — working tree",
      "- [Normalizador](#normalizador) — fix",
      "- [Blob CRLF Guard](#blob-crlf-guard)",
    ].join("\n")
    const blocks = extractTocBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].line).toBe(3)
    expect(blocks[0].entries).toHaveLength(3)
    expect(blocks[0].entries[0]).toMatchObject({ line: 3, slug: "crlf-guard", label: "CRLF Guard" })
  })

  it("bullet ISOLADO em prosa NÃO forma bloco (mínimo 2 consecutivos)", () => {
    const content = ["## Seção", "", "Veja [- CRLF Guard](#crlf-guard) isolado."].join("\n")
    // linha NÃO começa com `- [` — não é bullet; e um bullet só não forma TOC
    const single = ["## Seção", "", "- [Só um bullet](#unico)"].join("\n")
    expect(extractTocBlocks(content)).toEqual([])
    expect(extractTocBlocks(single)).toEqual([])
  })

  it("fence-aware: bullets dentro de ``` NÃO formam bloco", () => {
    const content = [
      "## Exemplo",
      "```bash",
      "- [fake](#nao-e-toc)",
      "- [fake2](#tambem-nao)",
      "```",
    ].join("\n")
    expect(extractTocBlocks(content)).toEqual([])
  })

  it("prosa ou heading ENTRE bullets quebra o run (blocos separados)", () => {
    const content = ["- [A](#a)", "- [B](#b)", "texto no meio", "- [C](#c)", "- [D](#d)"].join("\n")
    const blocks = extractTocBlocks(content)
    expect(blocks).toHaveLength(2)
    expect((blocks[0].entries as Array<{ slug: string }>).map((e) => e.slug)).toEqual(["a", "b"])
    expect((blocks[1].entries as Array<{ slug: string }>).map((e) => e.slug)).toEqual(["c", "d"])
  })
})

// ── nearestHeadingAbove ────────────────────────────────────────────────────

describe("nearestHeadingAbove", () => {
  const headings = [
    { line: 1, level: 1, slug: "titulo", text: "Título" },
    { line: 5, level: 2, slug: "secao", text: "Seção" },
    { line: 9, level: 3, slug: "sub", text: "Sub" },
  ]

  it("retorna o heading mais próximo acima da linha (exclusivo)", () => {
    expect((nearestHeadingAbove(headings, 7) as { slug?: string } | null)?.slug).toBe("secao")
    expect((nearestHeadingAbove(headings, 10) as { slug?: string } | null)?.slug).toBe("sub")
  })

  it("null quando o TOC está ANTES de qualquer heading (topo do arquivo)", () => {
    expect(nearestHeadingAbove(headings, 1)).toBeNull()
  })
})

// ── resolveIndexedLevel (regra do min — TOC multi-nível) ───────────────────

describe("resolveIndexedLevel (TOC multi-nível — regra do min)", () => {
  const headings = [
    { line: 1, level: 2, slug: "secao", text: "Seção" },
    { line: 5, level: 3, slug: "filho-a", text: "Filho A" },
    { line: 6, level: 4, slug: "filho-a-1", text: "Filho A.1" },
    { line: 7, level: 3, slug: "filho-b", text: "Filho B" },
  ]

  it("índice MISTO (### + ####): min entre as resolvidas = nível da seção dona (3)", () => {
    const block = {
      line: 3,
      entries: [
        { line: 3, slug: "filho-a", label: "Filho A" },
        { line: 4, slug: "filho-a-1", label: "Filho A.1" }, // entrada profunda (####)
      ],
    }
    expect(resolveIndexedLevel(block, headings)).toBe(3)
  })

  it("só entradas PROFUNDAS (####) → min = 4 (heurística; o guard REJEITA deep-only no checkToc)", () => {
    const block = {
      line: 3,
      entries: [{ line: 3, slug: "filho-a-1", label: "Filho A.1" }],
    }
    expect(resolveIndexedLevel(block, headings)).toBe(4)
  })

  it("nenhuma entrada resolve → null (fallback nominal do pai no reverse)", () => {
    const block = {
      line: 3,
      entries: [{ line: 3, slug: "nao-existe", label: "X" }],
    }
    expect(resolveIndexedLevel(block, headings)).toBeNull()
  })

  it("link para nível MAIS RASO desloca o min para baixo (ex.: entrada ## no índice → min 2)", () => {
    // Edge documentado no JSDoc ('não ocorre em TOC de seção bem-formado'):
    // uma entrada apontando para um heading mais raso que a seção dona baixa
    // o min — travado para que uma mudança futura não mude a semântica em
    // silêncio.
    const block = {
      line: 3,
      entries: [
        { line: 3, slug: "secao", label: "Seção" }, // nível 2 — mais raso
        { line: 4, slug: "filho-a", label: "Filho A" }, // nível 3
      ],
    }
    expect(resolveIndexedLevel(block, headings)).toBe(2)
  })
})

// ── checkToc (forward + label + reverse) ───────────────────────────────────

describe("checkToc forward", () => {
  it("todos os links do TOC resolvem → sem violações", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("link de TOC quebrado → violação forward com sugestão do mais próximo", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-gard)", // typo/renomeação
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    // A violação reverse TAMBÉM é esperada: com o typo, o heading real
    // 'crlf-guard' também fica fora do índice — o guard acerta nas duas
    // direções de uma vez (contrato correto, não duplicação de bug).
    const forward = violations.filter((v) => v.type === "forward")
    expect(forward).toHaveLength(1)
    expect(forward[0]).toMatchObject({ type: "forward", line: 3, slug: "crlf-gard" })
    expect(forward[0].closest).toBe("crlf-guard")
    expect(forward[0].distance).toBe(1)
    expect(violations.some((v) => v.type === "reverse")).toBe(true)
  })

  it("link para heading duplicado (#x-1) resolve — sufixo do GitHub", () => {
    const content = ["## X", "## X", "", "- [segundo X](#x-1)"].join("\n")
    expect(checkToc(content)).toEqual([])
  })
})

// ── checkToc label (LABEL do bullet ↔ heading resolvido) ──────────────────

describe("checkToc label", () => {
  it("label casa com o heading resolvido → sem violação", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("renomeação que MANTÉM o slug (CRLF Guard → CRLF-Guard) não é falsa violação", () => {
    // O texto do heading mudou ('CRLF Guard' → 'CRLF-Guard') mas o slug
    // permanece 'crlf-guard' (espaço→hífen vs hífen slugificam iguais) — o
    // label do TOC continua correspondendo semanticamente ao novo texto.
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF-Guard",
      "### Auditoria histórica",
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("label de PROSA (não casa com NENHUM heading) → exento", () => {
    const content = [
      "## Seção",
      "",
      "- [abaixo](#crlf-guard)",
      "- [fluxo de medição](#fluxo-de-medição)",
      "",
      "### CRLF Guard",
      "### Fluxo de medição",
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("label casa com OUTRO heading → violação label com sugestão do heading certo", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#normalizador)", // resolve (forward ok) mas o label é de outro
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Normalizador",
      "### Auditoria histórica",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    const label = violations.filter((v) => v.type === "label")
    expect(label).toHaveLength(1)
    expect(label[0]).toMatchObject({
      type: "label",
      line: 3,
      slug: "normalizador",
      label: "CRLF Guard",
      heading: "Normalizador",
      suggestion: "crlf-guard",
    })
    // o heading 'crlf-guard' também fica fora do índice → reverse TAMBÉM
    // acusa (contrato correto: as três direções trabalham juntas)
    expect(violations.some((v) => v.type === "reverse" && v.slug === "crlf-guard")).toBe(true)
  })

  it("label genérico de UM token apontando para heading errado → violação (heurística)", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [Guard](#normalizador)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### Guard",
      "### Normalizador",
      "### Auditoria histórica",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    const label = violations.filter((v) => v.type === "label")
    expect(label).toHaveLength(1)
    expect(label[0]).toMatchObject({ type: "label", label: "Guard", suggestion: "guard" })
  })
})

describe("checkToc reverse", () => {
  it("heading filho direto (nível pai+1) fora do índice → violação reverse", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Normalizador", // NOVO heading — não está no TOC
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      type: "reverse",
      slug: "normalizador",
      level: 3,
      section: "Encoding Guards",
    })
    expect(violations[0].line).toBe(8)
  })

  it("nível mais PROFUNDO (pai+2+, ex.: `####`) é EXENTO", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "",
      "### CRLF Guard",
      "#### Dois escopos (extendido)", // nível 4 — NÃO precisa de bullet
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("seção SEM TOC não exige completude de índice", () => {
    const content = ["## Sem Índice", "", "### A", "### B", "### C"].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("TOC no topo do arquivo (sem pai) → só forward aplica", () => {
    const content = [
      "- [A](#a)", // bloco sem pai (antes de qualquer heading)
      "- [B](#b)",
      "",
      "## A",
      "## B",
      "## C", // não precisa estar no TOC — sem seção-pai derivável
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("ROBUSTEZ: parágrafo→heading ANTES do índice NÃO rouba o pai — heading novo é flagrado", () => {
    // CENÁRIO REAL de conversão: um parágrafo de introdução da seção vira
    // `### Camadas de proteção` (heading) ENTRE a seção `##` e os bullets do
    // índice. O pai do TOC DEVE continuar sendo `## Encoding Guards` (nível
    // derivado das entradas resolvidas = 3), não o `###` novo — e o heading
    // convertido fica fora do índice → violação reverse. (Bug real: o
    // nearest-heading-ingênuo fazia o pai virar o `###` e o novo heading
    // escapava silenciosamente do check.)
    const content = [
      "## Encoding Guards",
      "### Camadas de proteção", // parágrafo convertido em heading
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      type: "reverse",
      slug: "camadas-de-proteção",
      level: 3,
      section: "Encoding Guards",
    })
  })

  it("ROBUSTEZ: parágrafo→heading DEPOIS do índice também é flagrado", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
      "### Nota convertida", // parágrafo pós-índice vira heading — fora do TOC
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ type: "reverse", slug: "nota-convertida" })
  })

  it("ROBUSTEZ: TOC cujo pai nominal seria `###` (parágrafo virou heading) com entradas de nível 3", () => {
    // variante: o parágrafo convertido está ACIMA do índice e há um heading
    // `####` sob ele — o nível-alvo derivado (3) continua mandando; o `####`
    // é exento e o `###` convertido é flagrado
    const content = [
      "## Encoding Guards",
      "### Camadas de proteção",
      "#### Sub-nota", // nível 4 — exento
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ type: "reverse", slug: "camadas-de-proteção" })
  })
})

// ── checkToc reverse — TOC multi-nível (regra do min em ação) ──────────────

describe("checkToc reverse — TOC multi-nível (regra do min)", () => {
  it("índice MISTO (### + ####): entradas profundas NÃO enfraquecem o reverse — #### fora do índice é exento", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Normalizador](#normalizador)",
      "- [Detalhe](#detalhe-do-normalizador)", // link cruzado para um ####
      "",
      "### CRLF Guard",
      "### Normalizador",
      "#### Detalhe do Normalizador", // nível 4 — EXENTO do reverse mesmo com entrada no TOC
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("TOC MISTO: filho ### FALTANTE continua flagrado (a entrada #### não mascara)", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Detalhe](#detalhe-do-normalizador)", // índice só com um ### e um ####
      "",
      "### CRLF Guard",
      "### Normalizador", // NÃO listado — deve ser flagrado
      "#### Detalhe do Normalizador",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    const reverse = violations.filter((v) => v.type === "reverse")
    expect(reverse).toHaveLength(1)
    expect(reverse[0]).toMatchObject({ type: "reverse", slug: "normalizador", level: 3 })
    // Isolamento: a entrada #### do índice NÃO produz ruído em forward/label —
    // o único sinal é o reverse do filho ### faltante (contrato do min).
    expect(violations.filter((v) => v.type !== "reverse")).toEqual([])
  })
})

// ── Regressão REAL do README ───────────────────────────────────────────────

describe("regressão real do README", () => {
  it("mini-índice atual (8 sub-blocos) resolve E cobre os `###` filhos da seção", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o README — pula
    const readme = readFileSync(readmePath, "utf8")
    const violations = checkToc(readme)
    expect(violations, JSON.stringify(violations)).toEqual([])
  })
})

// ── Regressão real dos docs/*.md (paridade com o guard de âncoras) ────────
// A auto-descoberta (discoverDocTargets — a MESMA do check-readme-anchors)
// faz o default escanear README.md + TODOS os docs/*.md. Este teste trava
// que TODOS os docs reais do repo passam no checkToc — o mesmo contrato do
// guard de âncoras (que já exige links válidos nos docs). Se um doc ganhar
// um TOC inconsistente, este teste falha ANTES do CI.

describe("regressão real dos docs/*.md (auto-descoberta)", () => {
  it("todos os docs/*.md do repo passam no checkToc (paridade com as âncoras)", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o repo — pula
    const targets = discoverDocTargets(process.cwd())
    expect(targets.length).toBeGreaterThan(0) // o repo TEM docs/*.md
    for (const t of targets) {
      const doc = readFileSync(join(process.cwd(), t), "utf8")
      const violations = checkToc(doc)
      expect(violations, `${t}: ${JSON.stringify(violations)}`).toEqual([])
    }
  })
})

// ── Contrato de PRODUÇÃO: resolveIndexedLevel sobre o README real ─────────
//
// Este teste é propositalmente MAIS FORTE que o guard: trava que o padrão de
// nível ÚNICO do repo se mantém em produção. Um TOC sem pai (topo do arquivo)
// ou multi-nível (ex.: entrada cruzada para `####`) NÃO falharia o checkToc
// (o guard os documenta como suportados), mas FALHARIA este contrato — sinal
// intencional de que o padrão de TOC do repo mudou, não um bug do guard.

describe("resolveIndexedLevel com TOC real do README (contrato de nível único)", () => {
  it("para cada bloco, o min calculado bate com o nível dos filhos diretos (pai + 1)", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o README — pula
    const readme = readFileSync(readmePath, "utf8")
    const headings = extractHeadings(readme) as Array<{
      line: number
      level: number
      slug: string
      text: string
    }>
    const blocks = extractTocBlocks(readme) as Array<{
      line: number
      entries: Array<{ line: number; slug: string; label: string }>
    }>

    // pré-condição do contrato: o README tem pelo menos um TOC de verdade
    expect(blocks.length).toBeGreaterThan(0)

    for (const block of blocks) {
      const where = `bloco TOC na linha ${block.line}`
      // pai da seção = heading mais próximo ACIMA do bloco
      const parent = nearestHeadingAbove(headings, block.line) as { level: number } | null
      expect(parent, `${where} sem pai derivado`).not.toBeNull()

      // CONTRATO: o min (nível mais raso das entradas resolvidas) é o nível
      // dos filhos diretos da seção = pai.level + 1. Se um TOC multi-nível
      // (ex.: #### cruzado) ou um parágrafo→heading antes do índice quebrar
      // o padrão de nível único, o min diverge e o teste falha em produção.
      const min = resolveIndexedLevel(block, headings)
      expect(min, where).toBe((parent as { level: number }).level + 1)

      // reforço do padrão: TODAS as entradas resolvem para o MESMO nível —
      // nenhum link cruzado para #### escondido no índice do README real
      const entryLevels = block.entries
        .map((e) => headings.find((h) => h.slug === e.slug)?.level)
        .filter((l): l is number => l !== undefined)
      expect(entryLevels.length, where).toBe(block.entries.length)
      expect(new Set(entryLevels).size, where).toBe(1)
      expect(entryLevels[0], where).toBe((parent as { level: number }).level + 1)
    }
  })
})

// ── checkToc deep-only guard (TOC sem filho direto indexado) ───────────────

describe("checkToc deep-only guard", () => {
  it("PASS: TOC de nível único indexa os filhos diretos (pai+1) — o padrão do repo", () => {
    const content = [
      "## Encoding Guards",
      "",
      "- [CRLF Guard](#crlf-guard)",
      "- [Auditoria histórica](#auditoria-histórica)",
      "",
      "### CRLF Guard",
      "### Auditoria histórica",
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("PASS: seção profunda LEGÍTIMA (### com filhos ####) indexa pai+1", () => {
    const content = [
      "## Seção",
      "",
      "### Sub-seção profunda",
      "",
      "- [Detalhe A](#detalhe-a)",
      "- [Detalhe B](#detalhe-b)",
      "",
      "#### Detalhe A",
      "#### Detalhe B",
    ].join("\n")
    // o pai do TOC é a `###` (nível 3) e as entradas apontam para os `####`
    // (nível 4 = pai+1) — single-level em profundidade legítima → sem violação
    expect(checkToc(content)).toEqual([])
  })

  it("FAIL: TOC deep-only (#### sob ## sem ###) — nenhuma entrada no nível dos filhos diretos", () => {
    const content = [
      "## Seção",
      "",
      "- [Detalhe A](#detalhe-a)",
      "- [Detalhe B](#detalhe-b)",
      "",
      "### Filho direto A",
      "### Filho direto B",
      "#### Detalhe A",
      "#### Detalhe B",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    const deep = violations.filter((v) => v.type === "deep-only")
    expect(deep).toHaveLength(1)
    expect(deep[0]).toMatchObject({
      type: "deep-only",
      line: 3,
      slug: "detalhe-a",
      section: "Seção",
    })
  })

  it("PASS: TOC MISTO (### + ####) — a entrada ### (pai+1) satisfaz o guard", () => {
    const content = [
      "## Seção",
      "",
      "- [Filho A](#filho-a)",
      "- [Detalhe](#detalhe-a)",
      "",
      "### Filho A",
      "#### Detalhe A",
    ].join("\n")
    expect(checkToc(content)).toEqual([])
  })

  it("TOC no topo do arquivo (sem pai) NÃO recebe o deep-only — só forward", () => {
    const content = [
      "- [Detalhe A](#detalhe-a)",
      "- [Detalhe B](#detalhe-b)",
      "",
      "## Seção",
      "#### Detalhe A",
      "#### Detalhe B",
    ].join("\n")
    expect((checkToc(content) as TocViolation[]).filter((v) => v.type === "deep-only")).toEqual([])
  })

  it("TOC com TODAS as entradas QUEBRADAS → só forward, NÃO deep-only (falso positivo)", () => {
    // indexedLevel === null: nenhuma entrada resolve (ex.: PR renomeou todos
    // os headings da seção). O forward acusa os links quebrados; o deep-only
    // NÃO deve disparar — um TOC 100% quebrado não é deep-only, e a sugestão
    // 'adicione um bullet de nível X' seria enganosa.
    const content = [
      "## Seção",
      "",
      "- [Filho A](#filho-a-renomeado)",
      "- [Filho B](#filho-b-renomeado)",
      "",
      "### Filho A",
      "### Filho B",
    ].join("\n")
    const violations = checkToc(content) as TocViolation[]
    expect(violations.some((v) => v.type === "forward")).toBe(true)
    expect(violations.filter((v) => v.type === "deep-only")).toEqual([])
  })

  it("regressão REAL do README: mini-índice indexa pai+1 → sem deep-only", () => {
    const readmePath = join(process.cwd(), "README.md")
    if (!existsSync(readmePath)) return // ambiente sem o README — pula
    const readme = readFileSync(readmePath, "utf8")
    expect((checkToc(readme) as TocViolation[]).filter((v) => v.type === "deep-only")).toEqual([])
  })
})
