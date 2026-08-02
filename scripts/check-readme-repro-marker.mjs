#!/usr/bin/env node

// =============================================================================
// check-readme-repro-marker.mjs
//
// CI guard (fast gate, <1s) que impede DOCS STALE: falha se o README mencionar
// comandos de repro de bugs JÁ CORRIGIDOS sem o marcador temporal (ex.:
// "hoje não é reproduzível em main").
//
// Contexto: bugs já migrados/corrigidos ficam documentados na seção
// "### Bugs conhecidos" do README, junto com o comando de repro (ex.:
// `bun run repro:setup-bun`). Sem um marcador temporal, um leitor futuro
// (ou o autor) não sabe se o repro ainda se aplica ao main atual — o texto
// vira stale quando o bug é corrigido e ninguém atualiza a doc.
//
// Regra (por bloco que contém um comando de repro):
//   - se o bloco SINALIZA que o bug foi corrigido/migrado (migra, corrigid,
//     fix, não é reproduzível, composite local, era aceitável, ...) → um
//     marcador temporal (hoje, atual, na época, num checkout anterior,
//     anterior ao commit, pré-migração, ...) é OBRIGATÓRIO no mesmo bloco;
//   - sem o marcador → violação com a linha e o trecho do bloco.
//
// Blocos de código (```) são ignorados — comandos lá dentro são logs/exemplos,
// não afirmações de doc. Um comando de repro SEM sinal de bug corrigido passa
// (não há como saber que o bug é stale — a regra só dispara quando a própria
// doc afirma a correção e omite o "quando").
//
// Usage:
//   node scripts/check-readme-repro-marker.mjs            # escaneia README.md
//   node scripts/check-readme-repro-marker.mjs docs/x.md  # escaneia outro(s)
//
// Exit codes:
//   0 — nenhuma violação (pass)
//   1 — pelo menos uma violação, ou arquivo ilegível (fail-closed)
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** Comando de repro — o gatilho da regra. */
export const REPRO_COMMAND_RE =
  /(repro:[a-z0-9_-]+|Repro automatizado|Para reproduzir|reproduzir o bug|act-repro-setup-bun\.sh)/i

/** Sinais de que o bug já foi corrigido/migrado (torna o marcador obrigatório). */
export const FIXED_SIGNAL_RE =
  /(migra|corrigid|resolvid|não é reproduzível|nao e reproduzivel|não reproduzível|nao reproduzivel|era aceitável|\bantigo\b|composite local|cache-hit=true|fix\b)/i

/** Marcadores temporais — âncoras de "quando" que evitam o docs stale. */
export const TEMPORAL_MARKER_RE =
  /(\bhoje\b|\batual\b|na época|num checkout anterior|anterior ao commit|antes da migração|pré-migra|pre-migra|históric|já não|já nao|não é reproduzível em|nao e reproduzivel em|não reproduzível em|nao reproduzivel em)/i

/**
 * Divide o conteúdo em blocos escaneáveis: linhas de tabela (uma linha `|` =
 * um bloco) e parágrafos (linhas consecutivas até vazio/cabeçalho/fence).
 * Regiões dentro de ``` (fenced code) são ignoradas.
 *
 * @param {string} content
 * @returns {{ startLine: number, endLine: number, text: string }[]}
 */
export function splitBlocks(content) {
  const lines = content.split(/\r?\n/)
  const blocks = []
  let i = 0
  let inFence = false
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      i++
      continue
    }
    if (inFence || trimmed === "" || trimmed.startsWith("#")) {
      i++
      continue
    }
    // Linha de tabela — cada linha `|` é um bloco próprio
    if (trimmed.startsWith("|")) {
      blocks.push({ startLine: i + 1, endLine: i + 1, text: line })
      i++
      continue
    }
    // Parágrafo — junta linhas consecutivas (até vazio, cabeçalho, tabela, fence)
    const start = i
    let text = trimmed
    i++
    while (i < lines.length) {
      const t = lines[i].trim()
      if (t === "" || t.startsWith("|") || t.startsWith("#") || t.startsWith("```")) break
      text += " " + t
      i++
    }
    blocks.push({ startLine: start + 1, endLine: i, text })
  }
  return blocks
}

/**
 * Retorna os blocos que contêm um comando de repro.
 *
 * @param {string} content
 * @returns {{ startLine: number, endLine: number, text: string }[]}
 */
export function extractReproBlocks(content) {
  return splitBlocks(content).filter((b) => REPRO_COMMAND_RE.test(b.text))
}

/**
 * Aplica a regra do marcador temporal a cada bloco com comando de repro.
 *
 * @param {string} content
 * @returns {{ startLine: number, endLine: number, excerpt: string }[]} violações
 */
export function checkReproMarkers(content) {
  const violations = []
  for (const block of extractReproBlocks(content)) {
    const fixed = FIXED_SIGNAL_RE.test(block.text)
    const marker = TEMPORAL_MARKER_RE.test(block.text)
    if (fixed && !marker) {
      violations.push({
        startLine: block.startLine,
        endLine: block.endLine,
        excerpt: block.text.slice(0, 160),
      })
    }
  }
  return violations
}

/** Nome padrão do arquivo escaneado quando nenhum caminho é passado. */
export const DEFAULT_PATH = "README.md"

function main() {
  const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [DEFAULT_PATH]
  const allViolations = []

  for (const target of targets) {
    const path = join(process.cwd(), target)
    let content
    try {
      content = readFileSync(path, "utf8")
    } catch (e) {
      console.error(`❌ Não foi possível ler ${target}: ${e.message}`)
      process.exit(1)
    }
    const violations = checkReproMarkers(content)
    for (const v of violations) {
      allViolations.push({ file: target, ...v })
    }
  }

  if (allViolations.length > 0) {
    console.error(`❌ Comando(s) de repro de bug CORRIGIDO sem marcador temporal (docs stale):\n`)
    for (const v of allViolations) {
      const line = v.startLine === v.endLine ? `${v.startLine}` : `${v.startLine}-${v.endLine}`
      console.error(`   - ${v.file}:${line}`)
      console.error(`     → ${v.excerpt}${v.excerpt.length >= 160 ? "…" : ""}\n`)
    }
    console.error(
      `   Ação: adicione um marcador temporal no mesmo bloco (ex.: "hoje não é\n` +
        `   reproduzível em main", "num checkout anterior ao commit de migração",\n` +
        `   "na época", "No main atual") para que o leitor saiba QUANDO o repro\n` +
        `   se aplica — senão a doc vira stale quando o bug é corrigido.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Nenhum comando de repro de bug corrigido sem marcador temporal (${targets.join(", ")}).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
