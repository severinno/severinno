#!/usr/bin/env node

// =============================================================================
// check-encoding-guards-badge.mjs
//
// CI guard (fast gate, <1s) que valida que o badge "Encoding guards: N/N
// active" no topo do README bate com a FONTE DA VERDADE: a contagem real de
// linhas de guard na tabela "## Encoding Guards" do próprio README.
//
// Por que derivação em vez de literal: o badge era atualizado MANUALMENTE a
// cada novo guard — e já derivou do estado real (badge 8/8 com apenas 7
// linhas na tabela). Este guard conta as linhas da tabela (header e
// separador excluídos) e falha se o badge divergir; --fix reescreve o badge
// automaticamente. Adicionar um guard novo à tabela (ex.: CRLF Guard) =
// o count ajusta sozinho, sem editar o badge à mão.
//
// Usage:
//   node scripts/check-encoding-guards-badge.mjs       # check; exit 1 on drift
//   node scripts/check-encoding-guards-badge.mjs --fix # reescreve o badge
//
// Exit codes:
//   0 — badge sincronizado com a tabela (pass)
//   1 — badge divergente ou seção/badge ausente (fail-closed)
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"

// O GERADO passa pelo formatador do repositório: o badge é uma LINHA do README,
// que é arquivo VERSIONADO e julgado pelo lint.
import { escreverFormatado } from "./prettier-format.mjs"
import { pathToFileURL } from "node:url"

/** Regex do badge no README (URL encoded: "encoding guards-8/8 active"). */
const BADGE_RE = /encoding%20guards-(\d+)%2F(\d+)/

/**
 * Extrai as linhas de guard da tabela "## Encoding Guards" do README.
 * Header (1ª linha `|`) e separator (`| :---: |`) são ignorados; a contagem
 * resultante é a fonte da verdade do badge.
 *
 * @param {string} content  conteúdo do README
 * @returns {string[]} linhas de guard (trimadas), na ordem da tabela
 */
export function extractGuardRows(content) {
  const lines = content.split(/\r?\n/)
  const headingIdx = lines.findIndex((l) => l.trim().startsWith("## Encoding Guards"))
  if (headingIdx === -1) {
    throw new Error("seção '## Encoding Guards' não encontrada no README")
  }
  const rows = []
  let inTable = false
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith("|")) {
      if (!inTable) {
        inTable = true // header row — ignora
        continue
      }
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue // separator row — ignora
      rows.push(trimmed)
    } else if (inTable) {
      // fim da tabela: qualquer linha sem `|` (inclusive em branco) encerra —
      // impede que uma SEGUNDA tabela abaixo (separada por linha em branco)
      // seja silenciosamente contada no badge
      break
    }
  }
  return rows
}

/**
 * Extrai o count atual do badge "Encoding guards: N/N" do README.
 *
 * @param {string} content
 * @returns {{ current: number, total: number } | null}
 */
export function extractBadge(content) {
  const m = content.match(BADGE_RE)
  if (!m) return null
  return { current: Number(m[1]), total: Number(m[2]) }
}

/**
 * Compara o badge com a contagem real da tabela.
 *
 * @param {number} rowCount  linhas de guard na tabela
 * @param {{ current: number, total: number } | null} badge
 * @returns {object[]} violações (vazio = sincronizado)
 */
export function checkBadge(rowCount, badge) {
  if (!badge) return [{ error: "badge 'encoding guards' não encontrado no README" }]
  const violations = []
  if (badge.current !== rowCount || badge.total !== rowCount) {
    violations.push({ badge, expected: rowCount })
  }
  return violations
}

/**
 * Reescreve a linha do badge com o count derivado (URL + alt text).
 *
 * @param {string} line  linha <img> do badge
 * @param {number} count  contagem correta
 * @returns {string}
 */
export function buildFixedBadge(line, count) {
  return line
    .replace(BADGE_RE, `encoding%20guards-${count}%2F${count}`)
    .replace(/Encoding guards: \d+\/\d+/, `Encoding guards: ${count}/${count}`)
}

function main() {
  const readmePath = join(process.cwd(), "README.md")
  let content
  try {
    content = readFileSync(readmePath, "utf8")
  } catch (e) {
    console.error(`❌ Não foi possível ler README.md: ${e.message}`)
    process.exit(1)
  }

  let rowCount
  try {
    rowCount = extractGuardRows(content).length
  } catch (e) {
    console.error(`❌ ${e.message}`)
    process.exit(1)
  }

  const badge = extractBadge(content)
  const violations = checkBadge(rowCount, badge)
  const fix = process.argv.includes("--fix")

  if (violations.length > 0) {
    if (fix) {
      const eol = content.includes("\r\n") ? "\r\n" : "\n"
      const fixed = content
        .split(/\r?\n/)
        .map((line) => (BADGE_RE.test(line) ? buildFixedBadge(line, rowCount) : line))
        .join(eol)
      escreverFormatado(readmePath, fixed)
      console.log(
        `✅ Badge de encoding guards reescrito: ${badge ? `${badge.current}/${badge.total}` : "ausente"} → ${rowCount}/${rowCount}`,
      )
      process.exit(0)
    }
    console.error(`❌ Badge de encoding guards divergente da tabela '## Encoding Guards':\n`)
    if (badge) {
      console.error(`   - badge atual: ${badge.current}/${badge.total}`)
    } else {
      console.error(`   - badge não encontrado no README`)
    }
    console.error(`   - tabela real: ${rowCount} linha(s) de guard\n`)
    console.error(`   Ação: node scripts/check-encoding-guards-badge.mjs --fix`)
    console.error(
      `   (ou ajuste a tabela se um guard foi adicionado/removido — o count deriva dela)`,
    )
    process.exit(1)
  }

  console.log(`✅ Badge de encoding guards sincronizado (${rowCount}/${rowCount}).`)
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
