#!/usr/bin/env node

// =============================================================================
// gen-worklog-toc.mjs
//
// Description: GERADOR do índice (TOC) do worklog.md — reescreve a seção
//   '## Índice de Task IDs' no head com UMA linha por entrada (ID + âncora
//   github-slugger + resumo), derivando o resumo da linha 'Task:' de cada
//   entrada, e normaliza a posição das âncoras `<a id="slug"></a>` para logo
//   após a linha do Task ID/Stage. O guard check-worklog-toc.mjs valida o
//   resultado (forward + reverse + anchor + stale); este script é a
//   ferramenta de MANUTENÇÃO que mantém o índice em sincronia ao adicionar
//   uma entrada nova ao worklog.
//
// Usage:
//   node scripts/gen-worklog-toc.mjs               # reescreve ./worklog.md
//   node scripts/gen-worklog-toc.mjs --root DIR    # reescreve DIR/worklog.md
//
// Exit codes:
//   0 — TOC regenerado com sucesso (e o guard check-worklog-toc passa)
//   1 — worklog.md ausente/ilegível OU o resultado não passa no guard
//
// O que o script FAZ por entrada (fence-aware, separador '---'):
//   1. extrai o ID (Task ID moderno OU Stage legado) e a descrição 'Task:';
//   2. gera a linha `- [ID](#slug) — resumo` (resumo truncado ~100 chars);
//   3. garante `<a id="slug"></a>` IMEDIATAMENTE após a linha do ID
//      (remove âncoras em posições antigas — o head antigo colocava antes
//      da linha do ID em algumas entradas).
// As funções puras são exportadas para testes unitários (padrão dos guards).
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { slugify } from "./check-readme-anchors.mjs"
import { extractEntryHeaders } from "./check-worklog.mjs"
import { checkWorklogToc } from "./check-worklog-toc.mjs"
import { checkWorklog } from "./check-worklog.mjs"

/** Linha de ID de entrada: 'Task ID: <id>' ou 'Stage: <id>' (para posicionar a âncora). */
export const ID_LINE_RE = /^\s*(?:Task ID|Stage):\s*/
/** Linha de âncora antiga: `<a id="..."></a>` (qualquer posição da entrada). */
export const ANCHOR_LINE_RE = /^\s*<a\s+id="[^"]*"[^>]*>\s*<\/a>\s*$/
/** Tamanho máximo do resumo no índice (o restante vira '…'). */
export const SUMMARY_MAX = 100

/**
 * Deriva o resumo de uma entrada a partir da descrição da linha 'Task:':
 * colapsa whitespace e trunca em SUMMARY_MAX chars com reticências.
 */
export function summarize(taskValue) {
  const clean = (taskValue ?? "").replace(/\s+/g, " ").trim()
  if (clean.length <= SUMMARY_MAX) return clean
  return `${clean.slice(0, SUMMARY_MAX - 1).trimEnd()}…`
}

/**
 * Extrai { id, slug, task } de uma entrada (linhas). Retorna null se a
 * entrada não tem Task ID/Stage — head/prosa ou bloco sem ID (não indexável).
 */
export function extractEntryInfo(entryLines) {
  const headers = extractEntryHeaders(entryLines.join("\n"))
  const idHeader = headers.find((h) => h.type === "Task ID" || h.type === "Stage")
  if (!idHeader || !idHeader.value.trim()) return null
  const id = idHeader.value.trim()
  const taskHeader = headers.find((h) => h.type === "Task")
  return { id, slug: slugify(id), task: taskHeader?.value ?? "" }
}

/**
 * Normaliza as âncoras de uma entrada: remove linhas `<a id=...>` antigas e
 * insere `<a id="${slug}"></a>` imediatamente após a linha do Task ID/Stage.
 */
export function normalizeAnchors(entryLines, slug) {
  const withoutAnchors = entryLines.filter((l) => !ANCHOR_LINE_RE.test(l))
  const idIdx = withoutAnchors.findIndex((l) => ID_LINE_RE.test(l))
  if (idIdx === -1) return withoutAnchors
  const anchor = `<a id="${slug}"></a>`
  if (withoutAnchors[idIdx + 1]?.trim() === anchor) return withoutAnchors
  return [...withoutAnchors.slice(0, idIdx + 1), anchor, ...withoutAnchors.slice(idIdx + 1)]
}

/**
 * Regenera o TOC do worklog completo:
 *   1. divide head (antes do 1º '---') e corpo (entradas separadas por '---',
 *      fence-aware — mesma lógica do check-worklog.mjs);
 *   2. para cada entrada: extrai id/slug/task e normaliza a âncora;
 *   3. reescreve a seção '## Índice de Task IDs' no head com as linhas novas
 *      (resumos derivados da linha Task: de cada entrada);
 *   4. revalida o resultado com checkWorklogToc — se o guard falhar, o
 *      script NÃO escreve o arquivo (fail-closed, nunca deixa o repo quebrado).
 *
 * @param {string} content  conteúdo atual do worklog.md
 * @returns {string} worklog.md regenerado (ou null se inválido)
 */
export function regenerateToc(content) {
  const lines = content.split(/\r?\n/)

  // 1. head/corpo no 1º separador (head não tem fences — busca simples)
  let headEnd = lines.findIndex((l) => /^\s*---+$/.test(l.trim()))
  if (headEnd === -1) throw new Error("worklog.md sem separador '---' (head/corpo)")
  const head = lines.slice(0, headEnd)
  const body = lines.slice(headEnd) // começa com o '---'

  // 2. entradas do corpo (fence-aware)
  const entries = []
  let current = []
  let inFence = false
  for (const line of body) {
    const t = line.trim()
    if (t.startsWith("```")) inFence = !inFence
    if (!inFence && /^\s*---+$/.test(t)) {
      if (current.length > 0) entries.push(current)
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) entries.push(current)

  // 3. linhas do TOC + entradas com âncora normalizada
  const rows = []
  const newEntries = entries.map((entryLines) => {
    const info = extractEntryInfo(entryLines)
    if (!info) return entryLines
    rows.push(`- [${info.id}](#${info.slug}) — ${summarize(info.task)}`)
    return normalizeAnchors(entryLines, info.slug)
  })

  // 4. novo head: prosa antes do heading + heading + linhas novas
  const tocHeading = "## Índice de Task IDs"
  const tocIdx = head.findIndex((l) => l.trim() === tocHeading)
  const prefix = tocIdx === -1 ? head : head.slice(0, tocIdx)
  const newHead = [...prefix, tocHeading, "", ...rows, ""]

  // 5. rejoin com SEPARADOR '---' entre as entradas (o split removeu os
  //    separadores; o rejoin deve re-inserí-los — sem isso as entradas
  //    ficariam coladas num bloco único e o check-worklog contaria 1)
  const bodyLines = newEntries.map((e) => e.join("\n")).join("\n---\n")
  const result = `${newHead.join("\n")}\n---\n${bodyLines}`

  // fail-closed: só escreve se AMBOS os guards validarem o resultado
  // (TOC sincronizado E estrutura de entradas íntegra — o segundo pega
  // regressão de separadores que o primeiro não vê por contar linhas de ID)
  const violations = checkWorklogToc(result)
  if (violations.length > 0) {
    throw new Error(
      `TOC regenerado NÃO passa no check-worklog-toc (${violations.length} violações) — não escrito:\n` +
        violations
          .slice(0, 5)
          .map((v) => `   - ${v.message}`)
          .join("\n"),
    )
  }
  const integrityViolations = checkWorklog(result)
  if (integrityViolations.length > 0) {
    throw new Error(
      `TOC regenerado NÃO passa no check-worklog (${integrityViolations.length} violações) — não escrito:\n` +
        integrityViolations
          .slice(0, 5)
          .map((v) => `   - ${v.message}`)
          .join("\n"),
    )
  }
  return result
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

  try {
    const regenerated = regenerateToc(content)
    writeFileSync(target, regenerated)
    const rowCount = (regenerated.match(/^\s*-\s+\[/gm) ?? []).length
    console.log(
      `✅ worklog.md TOC regenerado (${rowCount} linha(s) de índice com resumo derivado da Task:).`,
    )
  } catch (e) {
    console.error(`❌ ${e.message}`)
    process.exit(1)
  }
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar a reescrita.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
