/**
 * check-readme-repro-marker.test.ts
 *
 * Testes unitários das funções PURAS do
 * scripts/check-readme-repro-marker.mjs (guard que falha se o README
 * mencionar comandos de repro de bugs JÁ CORRIGIDOS sem o marcador temporal
 * — ex.: "hoje não é reproduzível em main" — prevenindo docs stale quando um
 * bug é migrado).
 *
 * Cobre:
 *   - splitBlocks: parágrafos, linhas de tabela, fences ignorados, cabeçalhos
 *   - extractReproBlocks: só blocos com comando de repro (repro:, Repro
 *     automatizado, Para reproduzir, reproduzir o bug)
 *   - checkReproMarkers: bug corrigido + SEM marcador → violação; com
 *     marcador → ok; bug não-corrigido → ok; fence não conta
 *   - Regressão do caso REAL do README (setup-bun com "hoje não é
 *     reproduzível em main")
 */

import { describe, it, expect } from "vitest"
import {
  splitBlocks,
  extractReproBlocks,
  checkReproMarkers,
  REPRO_COMMAND_RE,
  FIXED_SIGNAL_RE,
  TEMPORAL_MARKER_RE,
} from "../../../scripts/check-readme-repro-marker.mjs"

// ── Fixtures ───────────────────────────────────────────────────────────────

const README_REAL_ROW = `| **\`oven-sh/setup-bun@v2\` lento** | Baixa o Bun do GitHub a cada execução | **Repro automatizado:** \`bun run repro:setup-bun\` — roda o job 2×. Use num checkout ANTERIOR ao commit de migração para reproduzir o bug. **Hoje o bug não é reproduzível em \`main\`:** o job usa o composite local. Na época era aceitável. |`

// ── splitBlocks ────────────────────────────────────────────────────────────

describe("splitBlocks", () => {
  it("junta parágrafo de múltiplas linhas em um bloco", () => {
    const blocks = splitBlocks("linha 1\nlinha 2\n\noutro bloco")
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ startLine: 1, endLine: 2 })
    expect(blocks[0].text).toContain("linha 1")
    expect(blocks[0].text).toContain("linha 2")
    expect(blocks[1].startLine).toBe(4)
  })

  it("cada linha de tabela é um bloco próprio", () => {
    const blocks = splitBlocks("| a | b |\n| c | d |")
    expect(blocks).toHaveLength(2)
    expect(blocks[0].startLine).toBe(1)
    expect(blocks[1].startLine).toBe(2)
  })

  it("ignora conteúdo dentro de fences (```)", () => {
    const blocks = splitBlocks("texto\n```\nrepro:setup-bun\n```\n\ndepois")
    // só "texto" e "depois" viram blocos — o fence inteiro é ignorado
    const texts = blocks.map((b) => b.text)
    expect(texts).not.toContain("repro:setup-bun")
    expect(texts).toContain("texto")
    expect(texts).toContain("depois")
  })

  it("cabeçalho # não inicia bloco", () => {
    const blocks = splitBlocks("# Título\n\nparágrafo")
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe("parágrafo")
  })
})

// ── extractReproBlocks ─────────────────────────────────────────────────────

describe("extractReproBlocks", () => {
  it("detecta bloco com 'Repro automatizado:'", () => {
    const blocks = extractReproBlocks(README_REAL_ROW)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].startLine).toBe(1)
  })

  it("detecta 'Para reproduzir' e 'repro:setup-bun'", () => {
    const blocks = extractReproBlocks(
      "Para reproduzir: num checkout anterior, rode\n`bun run repro:setup-bun`.",
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toContain("Para reproduzir")
  })

  it("não detecta blocos sem comando de repro", () => {
    expect(extractReproBlocks("apenas texto comum sobre setup-bun")).toEqual([])
  })

  it("não detecta repro dentro de fence", () => {
    expect(extractReproBlocks("```text\nrepro:setup-bun\n```")).toEqual([])
  })
})

// ── checkReproMarkers ──────────────────────────────────────────────────────

describe("checkReproMarkers", () => {
  it("regressão real do README: bug corrigido COM marcador → sem violação", () => {
    expect(checkReproMarkers(README_REAL_ROW)).toEqual([])
  })

  it("regressão real do README: intro da Evidência empírica (PRÉ-migração) → sem violação", () => {
    // O parágrafo real que menciona o repro script + 'estado PRÉ-migração'
    // (sinal de bug corrigido) deve passar — 'pré-migra' conta como marcador
    // temporal (âncora "quando": antes da migração).
    const content =
      "Log **real** capturado rodando `scripts/act-repro-setup-bun.sh` contra o estado\n" +
      "PRÉ-migração (`oven-sh/setup-bun@v2` no `pr-check.yml` do commit `867b520`)."
    expect(checkReproMarkers(content)).toEqual([])
  })

  it("falso positivo: 'atualizado' NÃO é marcador 'atual' (word boundary)", () => {
    // `\batual\b` não deve casar dentro de 'atualizado' — senão um bloco
    // "o script foi atualizado" satisfaria o marcador indevidamente.
    expect(TEMPORAL_MARKER_RE.test("o script foi atualizado")).toBe(false)
    expect(TEMPORAL_MARKER_RE.test("No main atual")).toBe(true)
  })

  it("falso positivo: 'antigamente' NÃO é sinal 'antigo' (word boundary)", () => {
    expect(FIXED_SIGNAL_RE.test("antigamente funcionava")).toBe(false)
    expect(FIXED_SIGNAL_RE.test("o action antigo")).toBe(true)
  })

  it("bug corrigido SEM marcador temporal → violação", () => {
    const content =
      "**Repro automatizado:** `bun run repro:setup-bun` — o bug foi corrigido na migração."
    const violations = checkReproMarkers(content)
    expect(violations).toHaveLength(1)
    expect(violations[0].startLine).toBe(1)
    expect(violations[0].excerpt).toContain("repro:setup-bun")
  })

  it("comando de repro sem sinal de bug corrigido → sem violação", () => {
    const content = "**Repro automatizado:** `bun run repro:setup-bun` — valida o cache."
    expect(checkReproMarkers(content)).toEqual([])
  })

  it("marcador 'na época' satisfaz a regra", () => {
    const content = "**Repro:** `bun run repro:setup-bun` — na época era aceitável."
    expect(checkReproMarkers(content)).toEqual([])
  })

  it("marcador 'num checkout anterior' satisfaz a regra", () => {
    const content =
      "**Repro:** `bun run repro:setup-bun` — use num checkout anterior ao commit de migração."
    expect(checkReproMarkers(content)).toEqual([])
  })

  it("múltiplos blocos: só o problemático é reportado", () => {
    const content = [
      "Para reproduzir: num checkout anterior, rode `bun run repro:setup-bun`.",
      "",
      "Para reproduzir: `bun run repro:setup-bun` — o bug foi corrigido.",
    ].join("\n")
    const violations = checkReproMarkers(content)
    expect(violations).toHaveLength(1)
    expect(violations[0].startLine).toBe(3)
  })
})

// ── Regras (sanidade dos padrões) ──────────────────────────────────────────

describe("padrões das regras", () => {
  it("REPRO_COMMAND_RE casa as formas documentadas", () => {
    expect(REPRO_COMMAND_RE.test("bun run repro:setup-bun")).toBe(true)
    expect(REPRO_COMMAND_RE.test("Repro automatizado:")).toBe(true)
    expect(REPRO_COMMAND_RE.test("Para reproduzir:")).toBe(true)
    expect(REPRO_COMMAND_RE.test("para reproduzir o bug")).toBe(true)
  })

  it("FIXED_SIGNAL_RE casa sinais de bug corrigido", () => {
    expect(FIXED_SIGNAL_RE.test("o bug foi corrigido")).toBe(true)
    expect(FIXED_SIGNAL_RE.test("após a migração")).toBe(true)
    expect(FIXED_SIGNAL_RE.test("não é reproduzível")).toBe(true)
  })

  it("TEMPORAL_MARKER_RE casa os marcadores temporais", () => {
    expect(TEMPORAL_MARKER_RE.test("hoje não é reproduzível em main")).toBe(true)
    expect(TEMPORAL_MARKER_RE.test("No main atual")).toBe(true)
    expect(TEMPORAL_MARKER_RE.test("num checkout anterior")).toBe(true)
    expect(TEMPORAL_MARKER_RE.test("na época")).toBe(true)
  })
})
