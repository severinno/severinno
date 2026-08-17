#!/usr/bin/env node

// =============================================================================
// check-fetch-timeout.mjs
//
// CI guard que impede o RETORNO de `fetch(` SEM `signal` de timeout em src/.
//
// Por que: um serviço que aceita TCP mas nunca responde deixa o fetch pendente
// para sempre, travando o fluxo chamador (criação de booking, logout, envio de
// alerta). Todos os fetches de src/ devem passar `signal` (via envTimeoutSignal
// ou AbortSignal.timeout). Este guard fecha a classe inteira de hangs por
// regressão: se alguém adicionar um fetch novo sem signal, o CI falha.
//
// Regras:
//   1. A chamada `fetch(...)` DEVE conter `signal` ou `AbortSignal` no próprio
//      bloco da chamada, OU
//   2. ser delegação pura `fetch(url, <identifier>)` — nesse caso o arquivo
//      inteiro DEVE conter `signal`/`AbortSignal` em algum lugar (o options
//      com timeout é construído em outra parte, ex.: src/lib/api.ts).
//
// Falsos positivos tratados:
//   - Comentários e strings são apagados antes do scan (menção em prosa não
//     conta, ex.: JSDoc que cita `fetch(`).
//   - Identificadores compostos (fetchProvidersData) não casam `fetch(`.
//
// LIMITE conhecido (trade-off do wrapper central src/lib/api.ts): a delegação
// pura `fetch(url, <ident>)` passa se o ARQUIVO contiver um timeout signal em
// qualquer lugar. Um dev futuro que adicionar um segundo `fetch(url, init)`
// sem signal num arquivo que já tem envTimeoutSignal em outra função não será
// pego — aceitável para um guard (é o padrão do api.ts); a revisão de código
// cobre o caso raro.
//
// Usage:
//   node scripts/check-fetch-timeout.mjs [--root DIR]
//     --root  diretório a varrer (default: cwd) — usado nos testes de fixture
//
// Exit codes:
//   0 — pass (nenhum fetch( sem signal)
//   1 — violações encontradas (lista arquivo:linha + texto)
//   2 — flag desconhecida
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Regex de um `fetch(` global (não casa fetchProvidersData). */
export const FETCH_CALL_RE = /\bfetch\s*\(/g

/**
 * O que CONTA como proteção de hang: o requisito é especificamente
 * `AbortSignal.timeout` (direto ou via envTimeoutSignal). Um `signal:` de
 * AbortController manual (que nunca aborta sozinho) NÃO fecha a classe de
 * hangs — é exatamente o padrão que routing.ts tinha antes do sweep.
 */
export const TIMEOUT_SIGNAL_RE = /AbortSignal\.timeout|envTimeoutSignal/

/** Regex de delegação pura: `fetch(<url>, <identificador>)`. */
const DELEGATED_CALL_RE = /^\([^,)]*,\s*[A-Za-z_$][\w$]*\s*\)$/

/** Apaga comentários e literais de string (preservando \n e comprimento). */
export function blankLiteralsAndComments(code) {
  let out = code
  // Bloco de comentário /* ... */
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
  // Linha de comentário // ...
  out = out.replace(/\/\/[^\r\n]*/g, (m) => " ".repeat(m.length))
  // Strings '...' e "..."
  out = out.replace(/'(\\.|[^'\\\n])*'/g, (m) => " ".repeat(m.length))
  out = out.replace(/"(\\.|[^"\\\n])*"/g, (m) => " ".repeat(m.length))
  // Template literals `...`
  out = out.replace(/`[\s\S]*?`/g, (m) => " ".repeat(m.length))
  return out
}

/**
 * Extrai o bloco da chamada a partir do `(` de um `fetch(`.
 * Faz parênteses balanceados, ignorando strings dentro do bloco.
 */
export function findCallBlock(code, openParenIndex) {
  let depth = 0
  let i = openParenIndex
  let quote = null
  while (i < code.length) {
    const ch = code[i]
    if (quote) {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      i++
      continue
    }
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth === 0) return code.slice(openParenIndex, i + 1)
    }
    i++
  }
  return code.slice(openParenIndex, openParenIndex + 400)
}

/** Arquivos de teste NÃO são varridos (mocks de fetch não precisam de signal). */
function isTestFile(rel) {
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel) ||
    rel.includes("__tests__") ||
    rel.endsWith("vi-test.spec.ts")
  )
}

/** src/lib/fetch-timeout.ts define o helper — não tem fetch próprio, só proteção. */
function isHelperFile(rel) {
  return rel.endsWith("src/lib/fetch-timeout.ts")
}

/** Lista arquivos .ts/.tsx sob um diretório, recursivamente. */
function listTsFiles(dir, root) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      out.push(...listTsFiles(abs, root))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push({ rel: abs.slice(root.length + 1).replace(/\\/g, "/"), abs })
    }
  }
  return out
}

/**
 * Varre um diretório raiz (repo ou fixture) — retorna violações por arquivo.
 *
 * @param {string} root  diretório raiz
 * @returns {{file: string, line: number, text: string}[]}
 */
export function scanFetchTimeouts(root) {
  const violations = []
  const srcDir = join(root, "src")
  if (!statSync(srcDir).isDirectory()) return violations

  for (const { rel, abs } of listTsFiles(srcDir, root)) {
    if (isTestFile(rel) || isHelperFile(rel)) continue

    const code = readFileSync(abs, "utf8")
    const sanitized = blankLiteralsAndComments(code)
    const fileHasTimeoutSignal = TIMEOUT_SIGNAL_RE.test(sanitized)

    let m
    FETCH_CALL_RE.lastIndex = 0
    while ((m = FETCH_CALL_RE.exec(sanitized)) !== null) {
      const block = findCallBlock(code, m.index + m[0].length - 1)
      const ok =
        TIMEOUT_SIGNAL_RE.test(block) ||
        (DELEGATED_CALL_RE.test(block.trim()) && fileHasTimeoutSignal)
      if (!ok) {
        const line = code.slice(0, m.index).split(/\r?\n/).length
        violations.push({
          file: rel,
          line,
          text: code.split(/\r?\n/)[line - 1].trim().slice(0, 90),
        })
      }
    }
  }
  return violations
}

function main() {
  const argv = process.argv.slice(2)
  let root = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = resolve(argv[++i])
    } else {
      console.error(`flag desconhecida: ${argv[i]} (use --root X)`)
      process.exit(2)
    }
  }

  const violations = scanFetchTimeouts(root)

  if (violations.length > 0) {
    console.error(`❌ ${violations.length} fetch( sem signal de timeout em src/:\n`)
    for (const v of violations) {
      console.error(`   - ${v.file}:${v.line}  ${v.text}`)
    }
    console.error(
      "\n   Todo fetch de src/ deve passar `signal` (AbortSignal.timeout), idealmente via" +
        "\n   envTimeoutSignal(env, fallbackMs) de src/lib/fetch-timeout.ts — fecha a classe" +
        "\n   de hangs quando o serviço aceita TCP mas nunca responde.",
    )
    process.exit(1)
  }

  console.log("✅ Nenhum fetch( sem signal de timeout em src/.")
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
