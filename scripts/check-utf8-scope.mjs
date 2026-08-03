#!/usr/bin/env node

// =============================================================================
// check-utf8-scope.mjs
//
// CI guard que TRAVA a decisão de escopo do check-utf8.sh: as chamadas a
// check-utf8.sh e check_utf8.py (nos hooks, no CI e no próprio script) devem
// SEMPRE passar o diretório `src/` como argumento de varredura — NUNCA
// remover o argumento (escopo removido = varre o diretório de trabalho
// inteiro, potencialmente varrendo node_modules/ ou .next/) nem trocar para
// outro diretório.
//
// Por que existe: o check_utf8.py usa `os.walk(search_dir)` com default
// `search_dir = "src"` se nenhum argumento for passado. O shell wrapper
// check-utf8.sh passa `$@` para o Python. Se o argumento `src/` for removido
// de um call site (ex.: utf8-check.yml rodar `bash scripts/check-utf8.sh --ci`
// sem `src/`), o Python escaneia o diretório de trabalho INTEIRO — incluindo
// node_modules/ (milhares de arquivos desnecessários) e subdiretórios que
// não são código-fonte. O escopo INTENCIONAL é `src/` (`.ts`/`.tsx` do
// código-fonte). Este guard trava essa decisão no código, não apenas na doc.
//
// Escopo validado: lê scripts/check-utf8.sh, scripts/check_utf8.py,
// scripts/run-encoding-guards.sh, .github/workflows/utf8-check.yml,
// .github/workflows/utf8-auto-fix.yml, .github/workflows/pr-check.yml —
// detecta todas as chamadas a check-utf8.sh / check_utf8.py e valida que o
// argumento de diretório é `src/` ou `src` (sem trailing slash).
//
// Usage:
//   node scripts/check-utf8-scope.mjs
//
// Exit codes:
//   0 — escopo do check-utf8 travado em src/ (pass)
//   1 — escopo removido (sem argumento de diretório) ou trocado (ex.: ./
//       scripts/ outro diretório) — fail
//   2 — erro de infra (arquivo de guard ausente)
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** Arquivos onde o escopo do check-utf8 é travado por este guard. */
export const UTF8_SCOPE_FILES = [
  "scripts/check-utf8.sh",
  "scripts/check_utf8.py",
  "scripts/run-encoding-guards.sh",
  ".github/workflows/utf8-check.yml",
  ".github/workflows/utf8-auto-fix.yml",
  ".github/workflows/pr-check.yml",
]

/** Único valor de diretório permitido como argumento de varredura. */
export const ALLOWED_UTF8_SCOPE_DIR = "src"

/** Regex que detecta chamada a check-utf8.sh ou check_utf8.py (fora de comentários). */
const CALL_RE =
  /(?:^|\s|\|\|\s)(?:bash\s+scripts\/check-utf8\.sh|python3\s+scripts\/check_utf8\.py|scripts\/check-utf8\.sh|scripts\/check_utf8\.py|check-utf8\.sh|check_utf8\.py)(?:\s|$|\|)/

/** Regex que extrai o argumento de diretório (após flags, antes de pipe/;/$). */
const DIR_ARG_RE = /(?:^|\s)(src\/?|[a-zA-Z._/-]+)\s*(?:[;&|]|$|&&)/

/** Linha de código (não comentário)? Comentários são `#`/`//`/`*` iniciais. */
export function isCommentLine(line) {
  const t = line.trim()
  return t.startsWith("#") || t.startsWith("//") || t.startsWith("*")
}

/**
 * Extrai as chamadas a check-utf8 com argumento de diretório de um arquivo.
 * Ignora:
 *   - linhas de comentário (#, //, *)
 *   - menções em prosa (ex.: docstrings)
 *   - variáveis de atribuição (ex.: PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py")
 *   - echos e variáveis (ex.: echo "check-utf8: done")
 *
 * @param {string} content  conteúdo do arquivo
 * @returns {{line: number, dir: string|null}[]} chamadas encontradas
 */
export function extractUtf8CallSites(content) {
  const found = []
  const lines = content.split(/\r?\n/)
  let inDocstring = false
  let docstringQuote = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    // Docstring de Python ("""...""" ou '''...''')
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
      const after = raw.slice(raw.indexOf(quote) + 3)
      if (!after.includes(quote)) {
        inDocstring = true
        docstringQuote = quote
      }
      continue
    }

    if (!CALL_RE.test(raw)) continue
    if (isCommentLine(raw)) continue

    // Ignora variáveis de atribuição: PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py"
    // ou FOO=scripts/check_utf8.py
    if (/^[A-Z_]+=/.test(raw.trim())) continue
    // Ignora echos e variáveis echo/printf
    if (/^\s*(?:echo|printf|\$)/.test(raw.trim())) continue

    // Extrai o diretório APENAS dentro da chamada a check-utf8 (antes de ||, &&, |, ;)
    // Separa a linha pelo primeiro operador de pipeline/controle
    const beforePipe = raw.split(/\s*(?:\|\||&&|[|;])\s*/)[0]
    // Remove redirecionamentos (>>, >) e o que vem depois
    const beforeRedirect = beforePipe.replace(/\s+>>?\s*\S+/g, "").trim()

    const tokens = beforeRedirect.split(/\s+/)
    let dir = null
    // Procura UM token que não é --flag nem o script nem bash/python3
    for (let j = tokens.length - 1; j >= 0; j--) {
      const t = tokens[j]
      if (t.startsWith("--")) continue
      if (t.startsWith("$")) continue
      if (t === "check-utf8.sh" || t === "check_utf8.py") continue
      if (t === "scripts/check-utf8.sh" || t === "scripts/check_utf8.py") continue
      if (t === "bash" || t === "python3" || t === "||") continue
      if (t === "echo" || t === "printf") continue
      if (/^[\|&>;]/.test(t)) continue
      // operadores
      if (t === "&&" || t === "|" || t === ">" || t === ">>" || t === "2>&1") continue
      dir = t.replace(/\/$/, "") // remove trailing slash
      break
    }

    found.push({ line: lineNo, dir })
  }

  // Caso especial: default `search_dir = "src"` no check_utf8.py main()
  const pyDefaultMatch = content.match(/search_dir\s*=\s*"([^"]+)"/)
  if (pyDefaultMatch) {
    found.push({ line: 0, dir: pyDefaultMatch[1] })
  }

  return found
}

/**
 * Valida o escopo de TODAS as chamadas a check-utf8 no arquivo.
 *
 * @param {string} file      caminho do arquivo
 * @param {string} content   conteúdo do arquivo
 * @returns {{violations: string[], hasSrcScoped: boolean}}
 */
export function checkUtf8Scope(file, content) {
  const violations = []
  let hasSrcScoped = false

  for (const { line, dir } of extractUtf8CallSites(content)) {
    // Linha 0 = default do Python, validado separadamente
    if (line === 0) {
      if (dir === ALLOWED_UTF8_SCOPE_DIR) {
        hasSrcScoped = true
      } else {
        violations.push(
          `${file}: default search_dir = "${dir}" — deve ser "${ALLOWED_UTF8_SCOPE_DIR}" (decisão ESCOPO INTENCIONAL)`,
        )
      }
      continue
    }

    if (dir === null) {
      violations.push(
        `${file}:${line}: chamada 'check-utf8' SEM argumento de diretório — o escopo UTF-8 deve ser 'src/' (evita varrer node_modules/ ou .next/). Veja check-utf8-scope.mjs.`,
      )
      continue
    }

    if (dir !== ALLOWED_UTF8_SCOPE_DIR) {
      violations.push(
        `${file}:${line}: escopo UTF-8 trocado para '${dir}' — deve ser '${ALLOWED_UTF8_SCOPE_DIR}/' (decisão ESCOPO INTENCIONAL). Veja check-utf8-scope.mjs.`,
      )
      continue
    }

    if (dir === ALLOWED_UTF8_SCOPE_DIR) {
      hasSrcScoped = true
    }
  }

  return { violations, hasSrcScoped }
}

function main() {
  const cwd = process.cwd()
  const violations = []
  let anySrcScoped = false
  let infraError = false

  for (const rel of UTF8_SCOPE_FILES) {
    const abs = join(cwd, rel)
    if (!existsSync(abs)) {
      console.error(`❌ Arquivo de escopo UTF-8 ausente: ${rel}`)
      infraError = true
      continue
    }
    const content = readFileSync(abs, "utf8")
    const res = checkUtf8Scope(rel, content)
    violations.push(...res.violations)
    if (res.hasSrcScoped) anySrcScoped = true
  }

  if (infraError) {
    process.exit(2)
  }

  // Fail-closed: sem nenhuma chamada com escopo src/ em nenhum arquivo, o
  // filtro foi removido por completo — o guard não pode garantir o escopo
  // travado.
  if (!anySrcScoped) {
    violations.push(
      "nenhuma chamada a check-utf8.sh/check_utf8.py com escopo 'src/' encontrada — argumento de diretório removido de todos os call sites?",
    )
  }

  if (violations.length > 0) {
    console.error(`❌ Escopo do check-utf8 VIOLADO (${violations.length}):\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Decisão ESCOPO INTENCIONAL: check-utf8.sh/check_utf8.py devem SEMPRE` +
        `\n   receber 'src/' como argumento de diretório — evita varrer node_modules/` +
        `\n   ou .next/ (milhares de arquivos não-fonte). O default do Python` +
        `\n   (search_dir = "src") também é travado.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Escopo do check-utf8 travado: apenas 'src/' (${UTF8_SCOPE_FILES.length} arquivos auditados).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
