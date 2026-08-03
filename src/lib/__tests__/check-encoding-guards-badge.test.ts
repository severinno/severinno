/**
 * check-encoding-guards-badge.test.ts
 *
 * Testes unitários das funções PURAS do scripts/check-encoding-guards-badge.mjs
 * (guard que valida que o badge "Encoding guards: N/N active" do README bate
 * com a contagem real de linhas de guard na tabela "## Encoding Guards" — a
 * fonte da verdade, derivada do conteúdo, nunca um literal).
 *
 * Cobre:
 *   - extractGuardRows: conta linhas `|` da tabela ignorando header +
 *     separator; para no fim da tabela; lança se a seção não existe
 *   - extractBadge: parseia o badge URL-encoded ("8%2F8"); null se ausente
 *   - checkBadge: badge sincronizado → []; divergente → violação com esperado;
 *     badge ausente → violação (fail-closed)
 *   - buildFixedBadge: reescreve URL + alt text com o count derivado
 */

import { describe, it, expect } from "vitest"
import {
  extractGuardRows,
  extractBadge,
  checkBadge,
  buildFixedBadge,
} from "../../../scripts/check-encoding-guards-badge.mjs"

// ── Fixtures (estrutura real do README) ───────────────────────────────────

const README_7_GUARDS = `# Severinno

  <img src="https://img.shields.io/badge/encoding%20guards-7%2F7%20active%20%E2%9C%85-2ea44f" alt="Encoding guards: 7/7 active">

## Encoding Guards

Quatro camadas de proteção previnem que arquivos com encoding corrompido cheguem ao repositório:

|         Camada          | Gatilho | Comando | Tempo | Bloqueia? |
| :---------------------: | ------- | ------- | :---: | :-------: |
|    🏠 **Pre-commit**    | a       | b       |  ~2s  | ✅ Exit 1 |
|     🚀 **Pre-push**     | c       | d       |  ~2s  | ✅ Exit 1 |
|      🔄 **CI/CD**       | e       | f       | <10s  | ✅ Exit 1 |
|     📋 **PR Check**     | g       | h       | <10s  | ✅ Exit 1 |
|    🔒 **CRLF Guard**    | i       | j       |  <1s  | ✅ Exit 1 |
|    📦 **Blob CRLF**     | k       | l       |  <1s  | ✅ Exit 1 |
| 🧨 **Single-line out=** | m       | n       |  <1s  | ✅ Exit 1 |

**748 arquivos escaneados**
`

// ── extractGuardRows ──────────────────────────────────────────────────────

describe("extractGuardRows", () => {
  it("conta 7 guards ignorando header + separator", () => {
    const rows = extractGuardRows(README_7_GUARDS)
    expect(rows).toHaveLength(7)
    // primeiro e último guard da tabela (ordem preservada)
    expect(rows[0]).toContain("Pre-commit")
    expect(rows[rows.length - 1]).toContain("Single-line out=")
    // CRLF Guard está na tabela → contado
    expect(rows.some((r) => r.includes("CRLF Guard"))).toBe(true)
  })

  it("conta guards adicionados (ex.: +1 novo guard → 8)", () => {
    const content = README_7_GUARDS.replace(
      "| 🧨 **Single-line out=** |",
      "| 🧨 **Single-line out=** |\n| 🆕 **Novo Guard** | o | p | <1s | ✅ Exit 1 |\n",
    )
    expect(extractGuardRows(content)).toHaveLength(8)
  })

  it("para no fim da tabela (linha não-vazia sem |)", () => {
    const rows = extractGuardRows(README_7_GUARDS)
    // a linha "**748 arquivos escaneados**" após a tabela não é contada
    expect(rows.some((r) => r.includes("748"))).toBe(false)
    expect(rows).toHaveLength(7)
  })

  it("lança quando a seção ## Encoding Guards não existe", () => {
    expect(() => extractGuardRows("# Sem a seção\n\n| a | b |")).toThrow(
      /seção '## Encoding Guards' não encontrada/,
    )
  })

  it("robusto a conversão parágrafo→heading ANTES da tabela: count não muda", () => {
    // um parágrafo de introdução vira `### ...` (heading) entre a seção e a
    // tabela — o extractor só conta linhas `|`, então o count permanece 7
    const content = README_7_GUARDS.replace(
      "Quatro camadas de proteção previnem que arquivos com encoding corrompido cheguem ao repositório:",
      "### Camadas de proteção (convertido de parágrafo)",
    )
    expect(extractGuardRows(content)).toHaveLength(7)
  })

  it("robusto a conversão parágrafo→heading DEPOIS da tabela: count não muda", () => {
    // bloco pós-tabela convertido em heading (antes era texto solto "**748...")
    const content = README_7_GUARDS.replace("**748 arquivos escaneados**", "### Nota pós-tabela")
    expect(extractGuardRows(content)).toHaveLength(7)
  })

  it("robusto a heading com a MESMA aparência de linha de tabela fora da tabela", () => {
    // heading convertido que CONTÉM um pipe no texto — ainda começa com `#`,
    // não com `|`, então não é contado como linha de guard
    const content = README_7_GUARDS.replace(
      "Quatro camadas de proteção previnem que arquivos com encoding corrompido cheguem ao repositório:",
      "### Camadas | com pipe no texto",
    )
    expect(extractGuardRows(content)).toHaveLength(7)
  })
})

// ── extractBadge ──────────────────────────────────────────────────────────

describe("extractBadge", () => {
  it("parseia o badge URL-encoded (7%2F7)", () => {
    expect(extractBadge(README_7_GUARDS)).toEqual({ current: 7, total: 7 })
  })

  it("parseia badge divergente (8%2F8)", () => {
    const content = README_7_GUARDS.replace("7%2F7", "8%2F8")
    expect(extractBadge(content)).toEqual({ current: 8, total: 8 })
  })

  it("retorna null quando o badge não existe", () => {
    expect(extractBadge("# Sem badge")).toBeNull()
  })
})

// ── checkBadge ────────────────────────────────────────────────────────────

describe("checkBadge", () => {
  it("badge sincronizado com a tabela → nenhuma violação", () => {
    expect(checkBadge(7, { current: 7, total: 7 })).toEqual([])
  })

  it("badge divergente → violação com o esperado", () => {
    const violations = checkBadge(7, { current: 8, total: 8 })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ badge: { current: 8, total: 8 }, expected: 7 })
  })

  it("badge ausente → violação (fail-closed)", () => {
    const violations = checkBadge(7, null)
    expect(violations).toHaveLength(1)
    // toMatchObject (em vez de acessar .error) para não depender de
    // narrowing de união de tipos no elemento do array (checkBadge retorna
    // { error } | { badge, expected })
    expect(violations[0]).toMatchObject({ error: expect.stringMatching(/não encontrado/) })
  })
})

// ── buildFixedBadge ───────────────────────────────────────────────────────

describe("buildFixedBadge", () => {
  it("reescreve URL e alt text com o count derivado", () => {
    const line =
      '  <img src="https://img.shields.io/badge/encoding%20guards-8%2F8%20active%20%E2%9C%85-2ea44f" alt="Encoding guards: 8/8 active">'
    const fixed = buildFixedBadge(line, 7)
    expect(fixed).toContain("encoding%20guards-7%2F7")
    expect(fixed).toContain('alt="Encoding guards: 7/7 active"')
    expect(fixed).not.toContain("8%2F8")
  })
})
