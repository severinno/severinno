#!/usr/bin/env node

// =============================================================================
// check-worklog.mjs
//
// Description: CI guard (node-puro, <1s) de INTEGRIDADE do worklog.md — cada
//   entrada de auditoria DEVE ter o formato mínimo (Task ID/Agent/Task/Work
//   Log) e os Task IDs DEVEM ser únicos. Sem isso, o worklog vira uma pilha
//   de entradas sem contexto rastreável e IDs duplicados quebram referências
//   cruzadas de auditoria.
//
// Usage:
//   node scripts/check-worklog.mjs               # escaneia ./worklog.md
//   node scripts/check-worklog.mjs --root DIR    # escaneia DIR/worklog.md
//
// Exit codes:
//   0 — todas as entradas com o formato mínimo e IDs únicos
//   1 — alguma entrada incompleta OU Task ID duplicado
//
// Formato exigido por entrada (headers no início de linha, em ordem):
//   Task ID: <id>
//   Agent:  <descrição>
//   Task:   <descrição>
//   Work Log: (o corpo da entrada — pode ser um heading 'Work Log:' vazio)
//
// Regras:
//   - Task ID é OBRIGATÓRIO, não-vazio e ÚNICO (ids duplicados = violação).
//   - 'Agent:' e 'Task:' são OBRIGATÓRIOS (a linha imediatamente seguinte ao
//     Task ID, com o ':' no início — espaços/`**` antes de ':' são tolerados).
//   - 'Work Log:' é OBRIGATÓRIO dentro da mesma entrada (pode ter corpo vazio;
//     o que importa é o heading estar presente).
//   - 'Stage Summary:' é OPCIONAL (não é exigido).
//   - Entradas são separadas por linhas '---' (thematic break) fora de fence.
//   - O head do arquivo (antes do 1º '---') pode conter o título/prosa do
//     worklog sem ser uma entrada — prosa livre é isenta.
//
// As funções puras são exportadas para testes unitários (padrão dos guards:
// o CLI test importa e também roda via spawnSync com --root).
// =============================================================================

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Linha de Task ID: 'Task ID: <id>' (espaços tolerados). */
export const TASK_ID_RE = /^\s*Task ID:\s*(.+?)\s*$/
/** Header LEGADO de Task ID: 'Stage: <id>' (entradas antigas do worklog). */
export const LEGACY_STAGE_RE = /^\s*Stage:\s*(.+?)\s*$/
/** Header de entrada: 'Agent:', 'Task:' ou 'Work Log:' (com sufixo
 *  parentético opcional — ex.: 'Work Log (evidência lida no código):').
 *  O espaço entre o sufixo e o ':' é tolerado. */
export const HEADER_RE = /^\s*(Agent|Task|Work Log)(?:\s*\([^)]*\))?\s*:\s*/
/** Separador de entradas: linha '---' (thematic break). */
export const SEPARATOR_RE = /^\s*---+\s*$/

/**
 * Divide o conteúdo em ENTRIES (blocos entre separadores '---' fora de fence).
 * O head (antes do 1º separador) vira a entrada índice 0 — pode ser prosa.
 */
export function splitEntries(content) {
  const entries = []
  let current = []
  let inFence = false
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      current.push(line)
      continue
    }
    if (!inFence && SEPARATOR_RE.test(line)) {
      entries.push(current)
      current = []
      continue
    }
    current.push(line)
  }
  entries.push(current)
  return entries.map((lines) => lines.join("\n"))
}

/**
 * Extrai os headers de uma entrada (Task ID/Agent/Task/Work Log/Stage
 * Summary) na ordem em que aparecem. Retorna também o número da 1ª linha de
 * cada header (para diagnóstico no CLI).
 */
export function extractEntryHeaders(entry) {
  const headers = []
  const lines = entry.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const taskM = line.match(TASK_ID_RE)
    if (taskM) {
      headers.push({ type: "Task ID", value: taskM[1].trim(), line: i + 1 })
      continue
    }
    const stageM = line.match(LEGACY_STAGE_RE)
    if (stageM) {
      headers.push({ type: "Stage", value: stageM[1].trim(), line: i + 1 })
      continue
    }
    const headerM = line.match(HEADER_RE)
    if (headerM) {
      headers.push({
        type: headerM[1],
        value: line.replace(HEADER_RE, "").trim(),
        line: i + 1,
      })
    }
  }
  return headers
}

/**
 * Valida o worklog: para cada entrada, exige Task ID (único no arquivo),
 * Agent, Task e Work Log. O head do arquivo (entrada 0) é tratado como prosa
 * e isento, a menos que contenha headers de entrada.
 */
export function checkWorklog(content) {
  const violations = []
  const entries = splitEntries(content)
  const seenIds = new Map()

  entries.forEach((entry, idx) => {
    const headers = extractEntryHeaders(entry)
    // Task ID moderno OU Stage legado — ambos são identificadores de entrada.
    const idHeader = headers.find((h) => h.type === "Task ID" || h.type === "Stage")
    const agent = headers.find((h) => h.type === "Agent")
    const task = headers.find((h) => h.type === "Task")
    const workLog = headers.find((h) => h.type === "Work Log")

    // Head do arquivo (idx 0, antes do 1º '---') sem ID = prosa isenta.
    if (idx === 0 && !idHeader) return

    const prefix = `entry ${idx + 1}`
    if (!idHeader) {
      violations.push({
        type: "missing-task-id",
        entry: idx + 1,
        message: `${prefix} sem "Task ID:" (ou "Stage:" legado)`,
      })
      return
    }
    const id = idHeader.value
    const idLabel = idHeader.type === "Stage" ? "Stage" : "Task ID"
    if (!id) {
      violations.push({
        type: "empty-task-id",
        entry: idx + 1,
        message: `${prefix} com "${idLabel}:" vazio`,
      })
    }
    // Unicidade de ID no arquivo inteiro (Task ID e Stage compartilham o espaço).
    if (seenIds.has(id)) {
      violations.push({
        type: "duplicate-task-id",
        entry: idx + 1,
        id,
        previousEntry: seenIds.get(id),
        message: `Task ID/Stage "${id}" duplicado (entradas ${seenIds.get(id)} e ${idx + 1})`,
      })
    } else {
      seenIds.set(id, idx + 1)
    }
    if (!agent) {
      violations.push({
        type: "missing-agent",
        entry: idx + 1,
        id,
        message: `entrada "${id}" sem "Agent:"`,
      })
    }
    if (!task) {
      violations.push({
        type: "missing-task",
        entry: idx + 1,
        id,
        message: `entrada "${id}" sem "Task:"`,
      })
    }
    if (!workLog) {
      violations.push({
        type: "missing-work-log",
        entry: idx + 1,
        id,
        message: `entrada "${id}" sem "Work Log:"`,
      })
    }
  })

  return violations
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

  const violations = checkWorklog(content)
  if (violations.length > 0) {
    console.error(`❌ worklog.md com ${violations.length} violação(ões):\n`)
    for (const v of violations) {
      console.error(`   - ${v.message}`)
    }
    console.error(
      `\n   Ação: cada entrada do worklog precisa de Task ID/Agent/Task/Work Log` +
        ` (o mínimo auditável) e Task IDs únicos. Corrija no mesmo PR.`,
    )
    process.exit(1)
  }

  const entryCount = splitEntries(content).filter((e) =>
    extractEntryHeaders(e).some((h) => h.type === "Task ID" || h.type === "Stage"),
  ).length
  console.log(`✅ worklog.md íntegro — ${entryCount} entrada(s) com formato mínimo e IDs únicos.`)
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
