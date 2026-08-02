#!/usr/bin/env node

// =============================================================================
// check-crlf-scope.mjs
//
// CI guard que TRAVA a decisão de escopo dos guards CRLF: check-crlf.sh e
// check-blob-crlf.sh (e seus detectores .py) devem escanear APENAS
// *.sh/*.bash via `git ls-files` — NUNCA .ts/.tsx.
//
// Por que existe: a decisão 'ESCOPO INTENCIONAL' (documentada no header do
// check-crlf.sh) limita o guard de CRLF a scripts shell porque:
//   - .sh/.bash com CRLF QUEBRAM bash em containers Linux (act/CI) — o
//     working tree é copiado para o container, então o CRLF no disco vira
//     falha funcional ('set: pipefail: invalid option name').
//   - .ts/.tsx com CRLF NÃO quebram nada: tsc/next/bun/vitest aceitam CRLF;
//     os blobs são 100% LF (.gitattributes '*.ts text eol=lf'); prettier
//     (endOfLine: lf) + lint-staged normalizam no commit; e o git NÃO
//     enxerga o CRLF do working tree em .ts (o clean filter normaliza na
//     comparação — ex.: checkout Windows pré-normalização mostra w/crlf
//     sem o git status marcar os arquivos). Um guard de working tree para
//     .ts/.tsx falharia em CADA checkout Windows sem proteger nada — ruído.
//
// Este guard falha o PR se alguém adicionar '*.ts'/'*.tsx' (ou QUALQUER
// outra extensão fora de *.sh/*.bash) aos pathspecs do git ls-files nos
// guards CRLF — travando a decisão no código, não apenas na doc. Também
// falha se o filtro de extensão for REMOVIDO (um `git ls-files` sem glob
// escanearia o repo inteiro).
//
// Escopo: lê scripts/check-crlf.sh, scripts/check-blob-crlf.sh,
// scripts/check_crlf.py, scripts/check_blob_crlf.py — detecta invocações de
// ls-files (fora de comentários/docstrings) e valida as extensões glob.
//
// Usage:
//   node scripts/check-crlf-scope.mjs
//
// Exit codes:
//   0 — escopo dos guards CRLF limitado a *.sh/*.bash (pass)
//   1 — escopo estendido (ex.: '*.ts'/'*.tsx') ou filtro removido (fail)
//   2 — erro de infra (arquivo de guard ausente)
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** Arquivos dos guards CRLF cujo escopo de varredura é travado por este guard. */
export const CRLF_SCOPE_FILES = [
  "scripts/check-crlf.sh",
  "scripts/check-blob-crlf.sh",
  "scripts/check_crlf.py",
  "scripts/check_blob_crlf.py",
]

/** Únicas extensões permitidas nos pathspecs do git ls-files dos guards CRLF. */
export const ALLOWED_CRLF_SCOPE_EXTENSIONS = ["sh", "bash"]

/** Linha de código (não comentário)? Comentários são `#`/`//`/`*` iniciais. */
export function isCommentLine(line) {
  const t = line.trim()
  return t.startsWith("#") || t.startsWith("//") || t.startsWith("*")
}

/**
 * Extrai as extensões glob (`*.ext`) das invocações de ls-files de um arquivo.
 * Pula linhas dentro de docstrings de Python (""" ... """) e comentários —
 * menções em prosa (ex.: "`git ls-files --eol -z`") NÃO são invocações.
 *
 * @param {string} content  conteúdo do arquivo
 * @returns {{line: number, extensions: string[], bare: boolean}[]} invocações encontradas
 */
export function extractLsFilesScopes(content) {
  const found = []
  const lines = content.split(/\r?\n/)
  let inDocstring = false
  let docstringQuote = null
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    // Docstring de Python: rastreia QUAL aspas abriu (""" vs ''') e só fecha
    // na MESMA — uma linha interna com a outra variante (prosa) não pode
    // encerrar o bloco prematuramente (falso positivo em menção posterior).
    if (inDocstring) {
      if (raw.includes(docstringQuote)) {
        inDocstring = false
        docstringQuote = null
      }
      continue
    }
    const opener = raw.match(/^\s*("""|''')/)
    if (opener) {
      const quote = opener[1]
      // docstring de UMA linha (abre e fecha na mesma linha) — não entra em modo
      const after = raw.slice(raw.indexOf(quote) + 3)
      if (!after.includes(quote)) {
        inDocstring = true
        docstringQuote = quote
      }
      continue
    }

    if (!/\bls-files\b/.test(raw)) continue
    if (isCommentLine(raw)) continue

    const extensions = []
    for (const m of raw.matchAll(/\*\.([A-Za-z0-9]+)/g)) {
      if (!extensions.includes(m[1])) extensions.push(m[1])
    }
    // pathspecs QUOTADOS (ex.: 'scripts/', '*.sh') — um `git ls-files
    // 'scripts/'` escopa por DIRETÓRIO (sem extensão); só o `git ls-files`
    // BARE (zero args) é o caso fail-closed de escopo removido.
    const quoted = [...raw.matchAll(/['"]\S+['"]/g)].map((m) => m[0])
    found.push({ line: lineNo, extensions, bare: quoted.length === 0 })
  }
  return found
}

/**
 * Valida o escopo de ls-files de UM arquivo de guard CRLF.
 *
 * @param {string} file      caminho do arquivo (para mensagens file:line)
 * @param {string} content   conteúdo do arquivo
 * @returns {{violations: string[], hasShellScoped: boolean}}
 */
export function checkCrlfScope(file, content) {
  const violations = []
  let hasShellScoped = false

  for (const { line, extensions, bare } of extractLsFilesScopes(content)) {
    // `git ls-files` BARE (zero pathspecs) = filtro de extensão REMOVIDO —
    // escanearia o repo inteiro. Um pathspec de DIRETÓRIO ('scripts/') NÃO
    // é violação (escopo estrito, não extensão); só extensões glob contam.
    if (bare) {
      violations.push(
        `${file}:${line}: invocação 'git ls-files' BARE (sem pathspec) — o escopo CRLF deve ser '*.sh' '*.bash' (decisão ESCOPO INTENCIONAL, NÃO .ts/.tsx)`,
      )
      continue
    }
    if (extensions.length === 0) continue
    if (extensions.some((e) => ALLOWED_CRLF_SCOPE_EXTENSIONS.includes(e))) {
      hasShellScoped = true
    }
    for (const ext of extensions) {
      if (!ALLOWED_CRLF_SCOPE_EXTENSIONS.includes(ext)) {
        violations.push(
          `${file}:${line}: escopo CRLF estendido para '*.${ext}' — decisão ESCOPO INTENCIONAL: apenas *.sh/*.bash (NÃO .ts/.tsx). Ver header do check-crlf.sh.`,
        )
      }
    }
  }

  return { violations, hasShellScoped }
}

function main() {
  const cwd = process.cwd()
  const violations = []
  let anyShellScoped = false
  let infraError = false

  for (const rel of CRLF_SCOPE_FILES) {
    const abs = join(cwd, rel)
    if (!existsSync(abs)) {
      console.error(`❌ Arquivo de guard CRLF ausente: ${rel}`)
      infraError = true
      continue
    }
    const content = readFileSync(abs, "utf8")
    const res = checkCrlfScope(rel, content)
    violations.push(...res.violations)
    if (res.hasShellScoped) anyShellScoped = true
  }

  if (infraError) {
    process.exit(2)
  }

  // Fail-closed: sem nenhum ls-files com escopo *.sh/*.bash em nenhum guard
  // CRLF, o filtro foi removido por completo — o guard não pode garantir o
  // escopo travado.
  if (!anyShellScoped) {
    violations.push(
      "nenhum guard CRLF com invocação 'git ls-files' escopada a *.sh/*.bash encontrado — filtro de extensão removido?",
    )
  }

  if (violations.length > 0) {
    console.error(`❌ Escopo dos guards CRLF VIOLADO (${violations.length}):\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Decisão ESCOPO INTENCIONAL (header do check-crlf.sh): os guards CRLF` +
        `\n   escaneiam APENAS *.sh/*.bash — .ts/.tsx com CRLF NÃO quebram nada` +
        `\n   (tsc/bun/vitest aceitam CRLF; blobs 100% LF via .gitattributes;` +
        `\n   prettier+lint-staged normalizam). Um guard de working tree para` +
        `\n   .ts/.tsx falharia em CADA checkout Windows sem proteger nada.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Escopo dos guards CRLF travado: apenas *.sh/*.bash (${ALLOWED_CRLF_SCOPE_EXTENSIONS.join("/")}).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
