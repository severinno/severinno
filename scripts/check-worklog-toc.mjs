#!/usr/bin/env node

// =============================================================================
// check-worklog-toc.mjs
//
// Description: CI guard (node-puro, <1s) de SINCRONIA do índice (TOC) do
//   worklog.md — todo Task ID/Stage DEVE ter uma linha no índice com âncora
//   e resumo, e toda linha do índice DEVE resolver para uma entrada real.
//   Um worklog de 30+ entradas sem índice vira navegação manual; uma entrada
//   nova sem linha no TOC (ou uma linha stale) quebra a navegação rápida.
//
// Usage:
//   node scripts/check-worklog-toc.mjs               # escaneia ./worklog.md
//   node scripts/check-worklog-toc.mjs --root DIR    # escaneia DIR/worklog.md
//
// Exit codes:
//   0 — TOC consistente (todo Task ID indexado + todo link resolve + âncoras ok)
//   1 — entrada sem linha no índice OU link do índice sem âncora/entrada real
//
// Contrato de sincronia (bidirecional, espelha o check-readme-toc):
//   → (forward)  todo link `- [ID](#slug)` do TOC DEVE resolver para um
//                `<a id="slug">` real (âncora de entrada no worklog);
//   ← (reverse)  todo Task ID/Stage do worklog DEVE ter uma linha no TOC —
//                entrada nova sem índice falha o PR;
//   ≡ (anchor)   toda âncora `<a id="...">` de entrada DEVE ser o slug do
//                seu Task ID (mesmo algoritmo github-slugger do guard de
//                âncoras — slugify reutilizado por import, sem drift).
//
// O TOC é um bloco markdown (linhas `- [ID](#slug) — resumo`) dentro de uma
// seção `## Índice de Task IDs` no head do arquivo (antes do 1º separador).
// A extração de TOC é FENCE-AWARE (``` não conta) e ignora linhas de tabela.
// As funções puras são exportadas para testes unitários (padrão dos guards).
// =============================================================================

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { slugify } from "./check-readme-anchors.mjs"
import { splitEntries } from "./check-worklog.mjs"

/** Header de entrada: 'Task ID: <id>' ou 'Stage: <id>' (espaços tolerados). */
export const ENTRY_ID_RE = /^\s*(?:Task ID|Stage):\s*(.+?)\s*$/
/** Linha do TOC: `- [ID](#slug) — resumo` (slug sem espaço/`)`). */
export const TOC_ENTRY_RE = /^\s*-\s+\[([^\]]+)\]\(#([^)\s]+)\)(?:\s*[—-]?\s*(.*))?$/
/** Âncora de entrada: `<a id="slug"></a>` (qualquer atributo/posição). */
export const ANCHOR_RE = /<a\s+id="([^"]+)"[^>]*>\s*<\/a>/g

/**
 * Extrai as entradas (Task ID/Stage) do worklog em ordem: { id, line }.
 * Head do arquivo e blocos de fence são ignorados.
 */
export function extractEntries(content) {
  const entries = []
  let inFence = false
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(ENTRY_ID_RE)
    if (m && m[1].trim()) {
      entries.push({ id: m[1].trim(), line: i + 1 })
    }
  }
  return entries
}

/**
 * Extrai as linhas do TOC (bloco `- [ID](#slug)` fora de fence): { id, slug, summary, line }.
 * Só o HEAD do arquivo (antes do 1º separador `---`) é escaneado — o índice é
 * por definição a seção `## Índice de Task IDs` no topo; um `- [x](#y)` num
 * Work Log do corpo NUNCA é linha de índice (escopo fecha falsos positivos).
 */
export function extractTocRows(content) {
  const rows = []
  let inFence = false
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^\s*---+$/.test(trimmed)) break // head termina no 1º separador
    if (trimmed.startsWith("|")) continue // tabela não é TOC de bullets
    const m = line.match(TOC_ENTRY_RE)
    if (m) {
      rows.push({ id: m[1].trim(), slug: m[2], summary: (m[3] ?? "").trim(), line: i + 1 })
    }
  }
  return rows
}

/**
 * Extrai as âncoras `<a id="...">` do arquivo em ordem.
 */
export function extractAnchors(content) {
  const anchors = []
  for (const m of content.matchAll(ANCHOR_RE)) {
    anchors.push({ id: m[1], index: m.index ?? 0 })
  }
  return anchors
}

/**
 * Valida o TOC do worklog nas TRÊS direções:
 *   forward  — todo link do TOC resolve para uma âncora real;
 *   reverse  — todo Task ID/Stage tem linha no TOC;
 *   anchor   — toda âncora de entrada é o slug do seu Task ID.
 */
export function checkWorklogToc(content) {
  const violations = []
  const entries = extractEntries(content)
  const rows = extractTocRows(content)
  const anchors = new Set(extractAnchors(content).map((a) => a.id))

  const rowById = new Map(rows.map((r) => [r.id, r]))
  const entryIds = new Set(entries.map((e) => e.id))

  // forward: todo link do TOC precisa de âncora real
  for (const row of rows) {
    if (!anchors.has(row.slug)) {
      violations.push({
        type: "forward",
        line: row.line,
        id: row.id,
        slug: row.slug,
        message: `TOC '${row.id}' → #${row.slug} sem âncora <a id="${row.slug}"> no worklog`,
      })
    }
    // resumo: requisito explícito do usuário — linha do índice SEM resumo
    // (vazia, só espaços, ou placeholder '— —' do gerador antigo) é violação.
    // O resumo é derivado da linha Task: de cada entrada pelo gerador
    // (bun run gen:worklog-toc); sem ele a navegação perde o contexto.
    if (!row.summary || /^[\s—-]+$/.test(row.summary)) {
      violations.push({
        type: "empty-summary",
        line: row.line,
        id: row.id,
        message: `linha do índice "${row.id}" sem resumo — derive da Task: (ou rode 'bun run gen:worklog-toc')`,
      })
    }
  }

  // reverse: todo Task ID/Stage precisa de linha no TOC
  for (const entry of entries) {
    if (!rowById.has(entry.id)) {
      violations.push({
        type: "reverse",
        line: entry.line,
        id: entry.id,
        message: `entrada "${entry.id}" (linha ${entry.line}) sem linha no índice — adicione '- [${entry.id}](#${slugify(entry.id)}) — resumo'`,
      })
    }
  }

  // stale: linha do índice sem entrada real (o slug da própria row está no
  // próprio set — a condição se reduz a `!entryIds.has(row.id)`)
  for (const row of rows) {
    if (!entryIds.has(row.id)) {
      violations.push({
        type: "stale",
        line: row.line,
        id: row.id,
        message: `linha do índice "${row.id}" sem entrada real no worklog (stale)`,
      })
    }
  }
  // anchor: âncora extra (não referenciada) OU slug ≠ slugify(id)
  for (const entry of entries) {
    const expected = slugify(entry.id)
    const row = rowById.get(entry.id)
    if (row && row.slug !== expected) {
      violations.push({
        type: "anchor",
        line: entry.line,
        id: entry.id,
        slug: row.slug,
        expected,
        message: `âncora do TOC de "${entry.id}": #${row.slug} ≠ slug esperado #${expected}`,
      })
    }
  } // glued: bloco (separado por '---') com 2+ headers de ID = entradas COLADAS
  // sem separador — a regressão que o reparo desta task corrigiu (43 IDs em
  // 37 blocos). O reverse/forward não pegam quando a linha do TOC foi
  // adicionada à mão; esta checagem estrutura o worklog por bloco.
  // FENCE-AWARE: linhas `Task ID:`/`Stage:` DENTRO de ``` (amostras de código
  // num Work Log) NÃO contam como headers — extractEntryHeaders não pula
  // fences, então a contagem usa um scan próprio com estado de fence.
  const blocks = splitEntries(content)
  blocks.forEach((block, idx) => {
    if (idx === 0) return // head (prosa + TOC) não é entrada
    const idLines = fenceAwareIdLines(block)
    if (idLines.length > 1) {
      const glued = idLines
        .slice(1)
        .map((l) => l.id)
        .join('", "')
      violations.push({
        type: "glued",
        entry: idx + 1,
        id: idLines[0].id,
        glued,
        message: `entradas coladas no bloco ${idx + 1}: "${idLines[0].id}" seguido de "${glued}" sem separador '---' — cada Task ID precisa de bloco próprio`,
      })
    }
  })

  return violations
}

/**
 * Linhas de ID (Task ID/Stage) de um bloco FORA de fences — usado pela
 * checagem glued. Ao contrário de extractEntryHeaders (que varre TODAS as
 * linhas com regex), aqui ``` desativa a contagem: um snippet de código com
 * `Task ID: AMOSTRA` dentro de um Work Log não vira bloco "colado".
 */
export function fenceAwareIdLines(block) {
  const ids = []
  let inFence = false
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(ENTRY_ID_RE)
    if (m && m[1].trim()) ids.push({ id: m[1].trim() })
  }
  return ids
}

function main() {
  const args = process.argv.slice(2)
  const rootArg = args.indexOf("--root")
  const root = rootArg !== -1 && args[rootArg + 1] ? resolve(args[rootArg + 1]) : process.cwd()
  const target = join(root, "worklog.md")

  let content
  try {
    content = readFileSync(target, "utf8")
  } catch (e) {
    console.error(`❌ Não foi possível ler ${target}: ${e.message}`)
    process.exit(1)
  }

  const violations = checkWorklogToc(content)
  if (violations.length > 0) {
    console.error(`❌ worklog.md TOC inconsistente (${violations.length}):\n`)
    for (const v of violations) {
      console.error(`   - ${v.message}`)
    }
    console.error(
      `\n   Ação: toda entrada nova do worklog precisa de linha no índice` +
        ` (com âncora #slug e resumo) e todo link do índice precisa resolver.` +
        ` O slug usa o algoritmo github-slugger (mesmo das âncoras do README).`,
    )
    process.exit(1)
  }

  const entryCount = extractEntries(content).length
  const rowCount = extractTocRows(content).length
  console.log(
    `✅ worklog.md TOC sincronizado (${entryCount} entrada(s), ${rowCount} linha(s) de índice, forward + reverse + anchor ok).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
