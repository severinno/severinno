#!/usr/bin/env node
// =============================================================================
// check-no-leaked-imports.mjs — Guard de RESOLUÇÃO DE IMPORTS (fronteira)
// =============================================================================
//
// Usage:
//   node scripts/check-no-leaked-imports.mjs           # repo atual
//   node scripts/check-no-leaked-imports.mjs --root X  # fixture (testes)
//   node scripts/check-no-leaked-imports.mjs --json    # output JSON estruturado
//
// Exit codes:
//   0 — todos os imports bare resolvem DENTRO de <root>/node_modules (pass)
//   1 — pelo menos um import resolve para FORA do root (leak) — fail
//   2 — infra: root inválido/ilegível (fail-closed)
//
// O BUG QUE ESTE GUARD BLOQUEIA: worktree aninhado no projeto pai (ex.:
// C:/PROJETOS/severinno/.freebuff/worktrees/<wt>/), o tsc local resolve um
// import de um pacote NÃO DECLARADO no package.json contra o node_modules do
// PAI (o Node sobe a árvore até achar node_modules/<pkg>). No CI (checkout
// limpo), o pacote não existe → o job de typecheck quebra o merge — mas
// localmente o erro fica MASCARADO pelo vazamento, meses a fio (caso real:
// `z-ai-web-dev-sdk` importado em src/app/api/chat/route.ts sem estar no
// package.json — descoberto só na medição via act com container limpo).
//
// COMO DETECTA: para cada specifier BARE (não-relativo, não-alias @/, não
// node:/bun: builtin, não subpath scoped) em TODO o código do repo (src/,
// scripts/, e2e/, mini-services/, configs, hooks, Dockerfiles — mesmas
// regras do check-unused-deps), resolve o pacote a partir do ARQUIVO com
// require.resolve({ paths: [dir] }) e verifica que o path resolvido está
// DENTRO de <root>/node_modules/. Se resolve para FORA (ex.: o node_modules
// do pai), o import vaza do worktree — falha (exit 1) citando arquivo+dep.
//
// Por que require.resolve e não o tsc: o tsc local é vítima do MESMO
// vazamento (resolução de módulos do Node sobe a árvore) — o guard usa o
// caminho REAL de resolução e compara com a fronteira do root, então o
// vazamento é detectado exatamente onde ocorre. ~200ms local (fast), não
// roda o tsc (que é o job typecheck paralelo do pr-check).
//
// Casos tratados:
//   - specifiers relativos (./x, ../x), alias de tsconfig (@/...),
//     builtins (node:fs, bun:test, fs) e JSON (import com assert) — pulados
//   - subpath scoped (@scope/pkg/sub) — resolve o pacote raiz @scope/pkg
//   - imports dinâmicos (import("x")) e require() — cobertos
//   - pacote em node_modules do PAI via require.resolve (leak real) — fail
//   - --json para CI/report estruturado
//
// ALLOWLIST (uso que NÃO resolve via node_modules mas é legítimo):
//   - server-only, client-only — implementados no NÍVEL DO COMPILADOR do
//     Next.js (node_modules/next/types/global.d.ts: "We implement the
//     behavior of 'import server-only' and 'import client-only' on the
//     compiler level") — o pacote físico nem precisa existir; o tsc resolve
//     via os types do next. NÃO são leak (o CI limpo também passa).
//
// FALSOS POSITIVOS evitados: strings/template literals/heredocs são
// MASCARADOS antes do parse (um teste que grava 'import x from "y"' como
// STRING não pode acusar leak); comentários não são parseados.
//
// Caso "não resolve em lugar nenhum": o pacote não está em NENHUM
// node_modules alcançável (worktree ou pai) — antes de acusar, verifica se
// está DECLARADO num package.json do repo (raiz OU subdirs tipo
// mini-services/*): declarado = bun install pendente (mensagem orienta),
// não-declarado = dep realmente vazando/inexistente (fail — o tsc do CI
// limpo falharia TS2307 para código no include do tsconfig; para código
// fora do include — examples/, mini-services/ — o tsc NEM VALIDA, então o
// guard é a ÚNICA rede).
// =============================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** O próprio arquivo do guard — auto-excluído do scan (não é código de app). */
const SELF = fileURLToPath(import.meta.url)

// ---------------------------------------------------------------------------
// Config (espelho do check-unused-deps.mjs — MESMAS regras de arquivos)
// ---------------------------------------------------------------------------

const IGNORE_PREFIX = ["_", ".tmp", "dev.", "run-", "keep-", "start-", "supervisor"]

const JSON_CONFIG_FILES = new Set([
  "package.json",
  "components.json",
  ".prettierrc",
  ".eslintrc.json",
  "playwright.config.json",
  "tsconfig.json",
  "next.config.json",
  "tailwind.config.json",
])

const CODE_FILE_NAMES = new Set([
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
  "tailwind.config.ts",
  "tailwind.config.mjs",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
  "playwright.config.ts",
  "vitest.config.ts",
  "vitest.config.unit.ts",
  "vitest.setup.ts",
  "eslint.config.mjs",
  "eslint.config.js",
  "prisma.config.ts",
  "tsconfig.json",
])

const ALWAYS_IGNORE = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
  "build",
  ".turbo",
  ".husky/_",
  "docs",
  "tool-results",
  ".opencode",
])

const ALWAYS_IGNORE_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".gitignore",
  ".dockerignore",
  ".prettierignore",
  ".editorconfig",
  "LICENSE",
  "output.txt",
  "worklog.md",
  "CHANGELOG.md",
  "verify-screenshot.png",
])

/** Extensões de código que PODEM ter imports (o resto não é varrido). */
const IMPORT_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"])

/**
 * Coleta os arquivos de código do root (recursivo) — espelho do
 * collectCodeFiles do check-unused-deps.mjs (mesmas exclusões).
 *
 * @param {string} root
 * @returns {string[]} paths relativos ao root
 */
export function collectCodeFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = relative(root, full).split("\\").join("/")
      if (e.isDirectory()) {
        if (!ALWAYS_IGNORE.has(e.name) && !ALWAYS_IGNORE.has(rel)) walk(full)
        continue
      }
      if (ALWAYS_IGNORE_FILES.has(e.name)) continue
      if (IGNORE_PREFIX.some((p) => e.name.startsWith(p))) continue
      if (full === SELF) continue
      const ext = "." + (e.name.includes(".") ? e.name.split(".").pop() : "")
      if (IMPORT_EXTENSIONS.has(ext)) {
        out.push(rel)
        continue
      }
      if (JSON_CONFIG_FILES.has(e.name) || CODE_FILE_NAMES.has(e.name)) {
        out.push(rel)
        continue
      }
      if (e.name.startsWith("Dockerfile") || rel.startsWith(".husky/")) out.push(rel)
    }
  }
  walk(root)
  return out.sort()
}

/**
 * Computa os RANGES [start, end) das strings (aspas simples/duplas e
 * template literals) de um arquivo. Usado para FILTRAR os matches do regex
 * de import por POSIÇÃO: um import dentro de uma string (fixture de teste,
 * template literal) NÃO é import real; o import real tem o `import`/`require`
 * FORA da string.
 *
 * Num template, os trechos LITERAIS é que são string: o miolo de `${...}` é
 * código e fica FORA dos ranges (ver `consomeLiteral`). E os LITERAIS DE REGEX
 * (`/…/`) também são literais: entram aqui, porque um backtick ou uma chave
 * dentro deles não é código (ver `abreRegex`).
 *
 * @param {string} content
 * @returns {Array<[number, number]>}
 */
export function stringRanges(content) {
  const ranges = []
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch === "'" || ch === '"' || ch === "`") {
      i = consomeLiteral(content, i, ranges)
      continue
    }
    if (ch === "/" && abreRegex(content, i)) {
      const fim = fimDeRegex(content, i)
      if (fim !== -1) {
        ranges.push([i, fim])
        i = fim
        continue
      }
    }
    i++
  }
  return ranges
}

/** O que pode estar antes de um `/` que ABRE regex (e não uma divisão). */
const ANTES_DE_REGEX = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await",
])

/**
 * O `/` em `i` abre um LITERAL DE REGEX (e não uma divisão)? A diferença não é
 * léxica, é de contexto: depois de um VALOR (identificador, número, `)`, `]`) o
 * `/` divide; depois de operador, `(`, `,`, `=`, `}` ou palavra-chave, abre regex.
 *
 * POR QUE ISTO FAZ PARTE DA RÉGUA DE STRINGS: o texto de um regex é LITERAL, não
 * código — e a régua o lia como código. Medido (21/09/2026): o
 * `scripts/forge-doctor.mjs` tem `if (/["'`$|&;<>()\\\\*?]/.test(command))`, e o
 * BACKTICK dentro do regex fazia a régua abrir um template ali: o "template"
 * engolia código até o próximo backtick do arquivo, o mascaramento mentia e a
 * régua de TLA do `check-tla-closure` deixava de ver o `if (IS_DIRECT_RUN) await
 * main()` do FIM do arquivo (falso NEGATIVO — a régua cega). Um regex com `//`
 * (`/https:\/\//`) fazia o mesmo com o `stripComments`.
 *
 * @param {string} content
 * @param {number} i
 * @returns {boolean}
 */
export function abreRegex(content, i) {
  let j = i - 1
  while (j >= 0 && /\s/.test(content[j])) j--
  if (j < 0) return false
  const c = content[j]
  if (/[\w$)\]}]/.test(c)) {
    const palavra = (content.slice(0, j + 1).match(/([\w$]+)$/) ?? [])[1] ?? ""
    return ANTES_DE_REGEX.has(palavra)
  }
  return true
}

/**
 * O índice DEPOIS do regex que começa em `i` — ou `-1` quando ele não fecha na
 * MESMA linha (aí o `/` é divisão: um regex de verdade não atravessa linha).
 *
 * @param {string} content
 * @param {number} i
 * @returns {number}
 */
export function fimDeRegex(content, i) {
  let j = i + 1
  let classe = false
  while (j < content.length) {
    const c = content[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === "\n") return -1
    if (c === "[") classe = true
    else if (c === "]") classe = false
    else if (c === "/" && !classe) {
      j++
      while (j < content.length && /[a-z]/.test(content[j])) j++ // flags
      return j
    }
    j++
  }
  return -1
}

/**
 * Consome UM literal a partir de `i` (a citação está em `content[i]`): grava os
 * TRECHOS literais em `ranges` e devolve o índice depois do fechamento (ou o fim
 * do arquivo, se ele não fechar).
 *
 * Num TEMPLATE o miolo de `${...}` é CÓDIGO, não texto: os trechos literais vão
 * para `ranges` (é o que maskStrings apaga) e a interpolação é atravessada com a
 * mesma régua — chaves balanceadas, aspas e templates ANINHADOS inclusos.
 *
 * SEM ISSO a leitura mentia, e não só num caso de borda: um template com
 * interpolação terminava no PRIMEIRO backtick do miolo e o resto do arquivo era
 * lido como CÓDIGO. Medido (21/09/2026) com a régua de TLA do
 * `check-tla-closure.mjs`, que conta `await` de nível de módulo sobre este
 * mascaramento: 36 módulos "com top-level await" em vez dos 9 reais — 27
 * acusações falsas, todas nascidas deste trecho.
 *
 * @param {string} content
 * @param {number} i
 * @param {Array<[number, number]>} [ranges]
 * @returns {number} índice depois do literal
 */
export function consomeLiteral(content, i, ranges = []) {
  const n = content.length
  const quote = content[i]
  const ehTemplate = quote === "`"
  let j = i + 1
  let trecho = i
  while (j < n) {
    const c = content[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (ehTemplate && c === "$" && content[j + 1] === "{") {
      if (j > trecho) ranges.push([trecho, j])
      j = consomeInterpolacao(content, j + 2, ranges)
      trecho = j
      continue
    }
    if (c === quote) {
      ranges.push([trecho, j + 1])
      return j + 1
    }
    if (c === "\n" && !ehTemplate) break // literal de aspas não atravessa linha
    j++
  }
  if (n > trecho) ranges.push([trecho, n])
  return n
}

/**
 * Atravessa o MIOLO de um `${...}` — que é CÓDIGO: chaves balanceadas e
 * literais aninhados com a mesma régua. Devolve o índice depois do `}` que
 * fecha a interpolação.
 *
 * @param {string} content
 * @param {number} i primeiro caractere depois do `${`
 * @param {Array<[number, number]>} ranges
 * @returns {number}
 */
function consomeInterpolacao(content, i, ranges) {
  const n = content.length
  let prof = 1
  let j = i
  while (j < n && prof > 0) {
    const c = content[j]
    if (c === "{") {
      prof++
      j++
      continue
    }
    if (c === "}") {
      prof--
      j++
      continue
    }
    if (c === "'" || c === '"' || c === "`") {
      j = consomeLiteral(content, j, ranges)
      continue
    }
    j++
  }
  return j
}

/**
 * Mascara o conteúdo de STRINGS com espaços (exportado p/ testes).
 *
 * @param {string} content
 * @returns {string}
 */
export function maskStrings(content) {
  const ranges = stringRanges(content)
  let out = content
  for (const [s, e] of ranges) {
    out = out.slice(0, s) + " ".repeat(e - s) + out.slice(e)
  }
  return out
}

/**
 * Remove COMENTÁRIOS (linha // e bloco slash-asterisco) de um arquivo de
 * código, preservando strings — um import/require citado em DOC (ex.:
 * "import x from \"pkg\"" num comentário de header de guard) não pode
 * acusar leak. Roda ANTES do extractBareSpecifiers.
 *
 * @param {string} content
 * @returns {string} conteúdo sem comentários
 */
export function stripComments(content) {
  let out = ""
  let i = 0
  const n = content.length
  while (i < n) {
    const ch = content[i]
    const next = content[i + 1]
    if (ch === "'" || ch === '"' || ch === "`") {
      // literal (template incluso): preservado ÍNTEGRO — o `//` dentro do MIOLO
      // de um template não é comentário, é texto do template, e o miolo de uma
      // interpolação `${...}` continua código (consomeLiteral sabe a diferença).
      const fim = consomeLiteral(content, i)
      out += content.slice(i, fim)
      i = fim
      continue
    }
    if (ch === "/" && next === "/") {
      // comentário de linha: até o \n (não consome o \n)
      while (i < n && content[i] !== "\n") i++
      continue
    }
    if (ch === "/" && next !== "*" && abreRegex(content, i)) {
      // REGEX: preservado ÍNTEGRO — o `//` de `/https:\/\//` não abre comentário
      // e o backtick de `/["'`$|…/` não abre template.
      const fim = fimDeRegex(content, i)
      if (fim !== -1) {
        out += content.slice(i, fim)
        i = fim
        continue
      }
    }
    if (ch === "/" && next === "*") {
      // comentário de bloco: até */ (não encontrado = até o fim)
      i += 2
      while (i < n && !(content[i] === "*" && content[i + 1] === "/")) i++
      i = Math.min(i + 2, n)
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Extrai os specifiers BARE de um arquivo de código: linhas com import,
 * require() ou import() dinâmico. O regex roda no conteúdo SEM comentários
 * (a âncora import/require está FORA de strings e fora de DOC) e os matches
 * DENTRO de strings (fixtures/templates) são descartados por posição.
 *
 * @param {string} content
 * @returns {string[]} specifiers bare (sem linha/contexto)
 */
export function extractBareSpecifiers(content) {
  const out = new Set()
  const code = stripComments(content)
  const ranges = stringRanges(code)
  // import x from "pkg" | import "pkg" | require("pkg") | import("pkg")
  // export ... from "pkg" | export ... from "pkg" com type
  const re =
    /(?:import\s+(?:[^"'\n]*?\s+from\s*)?|export\s+[^"'\n]*?\s+from\s*|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g
  for (const m of code.matchAll(re)) {
    if (ranges.some(([s, e]) => m.index >= s && m.index < e)) continue
    const spec = m[1]
    if (isBareSpecifier(spec)) out.add(spec)
  }
  return [...out]
}

/**
 * Define se um specifier é BARE (nome de pacote) — não-relativo, não-alias,
 * não-builtin. Os NÃO-bare são ignorados (resolvem dentro do projeto ou são
 * runtime do Node/Bun).
 *
 * @param {string} spec
 * @returns {boolean}
 */
export function isBareSpecifier(spec) {
  if (!spec) return false
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) return false
  if (spec.startsWith("@/") || spec.startsWith("~/")) return false // alias tsconfig
  if (spec.startsWith("node:") || spec.startsWith("bun:")) return false
  // builtins do node sem prefixo (fs, path, http...)
  if (NODE_BUILTINS.has(spec)) return false
  return true
}

/** Builtins do Node (sem prefixo node:) — não são pacotes a resolver. */
const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
])

/** Normaliza o specifier para o pacote raiz (subpath scoped → @scope/pkg). */
export function pkgFromSpec(spec) {
  const parts = spec.split("/")
  if (spec.startsWith("@") && parts.length >= 2) return parts.slice(0, 2).join("/")
  return parts[0]
}

/**
 * Pacotes implementados fora de node_modules (compilador Next ou runner k6) — nunca são
 * leak, mesmo sem o pacote físico instalado.
 */
const COMPILER_LEVEL = new Set(["server-only", "client-only", "k6"])

/**
 * Verifica se um pacote está DECLARADO em QUALQUER package.json do repo
 * (raiz ou subdirs tipo mini-services/*) — usado para distinguir "dep
 * declarada com install pendente" (orienta bun install) de "dep realmente
 * inexistente" (fail).
 *
 * @param {string} root
 * @param {string} pkg
 * @returns {string|null} path do package.json que declara, ou null
 */
export function findDeclaringPackageJson(root, pkg) {
  const seen = new Set()
  const walk = (dir) => {
    for (const name of ["package.json"]) {
      const p = join(dir, name)
      if (seen.has(p)) continue
      seen.add(p)
      try {
        const pkgJson = JSON.parse(readFileSync(p, "utf8"))
        const all = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) }
        if (pkg in all) return p
      } catch {
        /* ilegível — ignora */
      }
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (ALWAYS_IGNORE.has(e.name)) continue
      if (e.name.startsWith(".")) continue
      if (e.name === "node_modules") continue
      const found = walk(join(dir, e.name))
      if (found) return found
    }
    return null
  }
  return walk(root)
}

/**
 * Resolve um specifier bare a partir do ARQUIVO e verifica que cai DENTRO
 * de <root>/node_modules. O require.resolve reproduz a resolução real do
 * Node (a mesma que sobe para o node_modules do PAI no worktree aninhado).
 *
 * Casos:
 *   - resolve dentro do root → ok
 *   - resolve FORA do root → LEAK (o bug do z-ai: worktree aninhado no pai)
 *   - NÃO resolve em lugar nenhum: se o pacote é compiler-level (server-only)
 *     ou DECLARADO num package.json do repo (install pendente) → orienta
 *     bun install (não falha); se não declarado em NENHUM package.json →
 *     falha (dep inexistente — o tsc do CI limpo falharia; para código fora
 *     do include do tsconfig — examples/, mini-services/ — o tsc nem valida,
 *     o guard é a única rede).
 *
 * @param {string} spec  specifier bare (ex.: "zod", "@scope/pkg/sub")
 * @param {string} fromFile  caminho absoluto do arquivo que importa
 * @param {string} root  root do repo (fronteira)
 * @returns {{leaked: boolean, resolved: string|null, reason: string, kind: "ok"|"leak"|"pending-install"|"undeclared"}}
 */
export function resolveImport(spec, fromFile, root) {
  const req = createRequire(join(root, "package.json"))
  let resolved
  try {
    resolved = req.resolve(spec, { paths: [dirname(fromFile)] })
  } catch {
    // não resolve em lugar nenhum alcançável
    if (COMPILER_LEVEL.has(pkgFromSpec(spec))) {
      return {
        leaked: false,
        resolved: null,
        reason: "compiler-level (Next.js) — legítimo",
        kind: "ok",
      }
    }
    const declaring = findDeclaringPackageJson(root, pkgFromSpec(spec))
    if (declaring) {
      return {
        leaked: false,
        resolved: null,
        reason: `declarada em ${declaring} mas não instalada — rode bun install no diretório certo`,
        kind: "pending-install",
      }
    }
    return {
      leaked: true,
      resolved: null,
      reason:
        "não resolve em lugar nenhum e NÃO está declarada em nenhum package.json do repo — dep inexistente/vazando",
      kind: "undeclared",
    }
  }
  const normRoot = resolve(root).toLowerCase()
  const normResolved = resolve(resolved).toLowerCase()
  const rootPrefix = normRoot.endsWith(sep()) ? normRoot : normRoot + sep()
  if (normResolved.startsWith(rootPrefix)) {
    return { leaked: false, resolved, reason: "dentro do worktree", kind: "ok" }
  }
  return { leaked: true, resolved, reason: `resolve fora do worktree (${resolved})`, kind: "leak" }
}

function sep() {
  return process.platform === "win32" ? "\\" : "/"
}

/**
 * Varre o repo e reporta os imports que RESOLVEM PARA FORA do worktree
 * (leak) ou que não resolvem e não estão declarados (undeclared).
 *
 * @param {string} root
 * @returns {{leaks: Array<{file: string, spec: string, resolved: string|null, reason: string, kind: string}>, pending: Array<{file: string, spec: string, reason: string}>, scanned: number}}
 */
export function findLeakedImports(root) {
  const files = collectCodeFiles(root)
  const leaks = []
  const pending = []
  for (const f of files) {
    const full = join(root, f)
    let content
    try {
      content = readFileSync(full, "utf8")
    } catch {
      continue
    }
    for (const spec of extractBareSpecifiers(content)) {
      const r = resolveImport(spec, full, root)
      if (r.kind === "ok") continue
      if (r.kind === "pending-install") {
        pending.push({ file: f, spec, reason: r.reason })
        continue
      }
      leaks.push({ file: f, spec, resolved: r.resolved, reason: r.reason, kind: r.kind })
    }
  }
  return { leaks, pending, scanned: files.length }
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const rootIdx = args.indexOf("--root")
  if (rootIdx !== -1 && args[rootIdx + 1] === undefined) {
    console.error("check-no-leaked-imports: --root requer um path")
    process.exit(2)
  }
  const root = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd()

  if (!existsSync(join(root, "package.json"))) {
    console.error(`❌ check-no-leaked-imports: package.json ausente em ${root}`)
    console.error("   Rode na raiz do repo (ou passe --root <dir>).")
    process.exit(2)
  }

  const { leaks, pending, scanned } = findLeakedImports(root)

  if (json) {
    console.log(
      JSON.stringify(
        {
          scanned,
          leakCount: leaks.length,
          pendingInstall: pending.length,
          leaks: leaks.map((l) => ({
            file: l.file,
            spec: l.spec,
            resolved: l.resolved,
            reason: l.reason,
            kind: l.kind,
          })),
        },
        null,
        2,
      ),
    )
    process.exit(leaks.length > 0 ? 1 : 0)
  }

  if (leaks.length === 0) {
    const pendMsg =
      pending.length > 0
        ? ` (${pending.length} dep(s) declaradas com install pendente — rode bun install)`
        : ""
    console.log(
      `✅ check-no-leaked-imports: ${scanned} arquivos — todos os imports bare resolvem dentro de node_modules do worktree${pendMsg}.`,
    )
    process.exit(0)
  }

  console.error(
    `🔍 check-no-leaked-imports: ${leaks.length} import(s) que resolvem PARA FORA do worktree (leak do node_modules do projeto pai?):\n`,
  )
  for (const l of leaks) {
    console.error(`   • ${l.file}: "${l.spec}"`)
    console.error(`     ${l.reason}`)
  }
  console.error(
    `\n   Um import só deve resolver para node_modules DENTRO deste repo. Se a\n` +
      `   dep é real, adicione-a ao package.json e rode bun install (o CI limpo\n` +
      `   falharia o typecheck). Se é código local, use caminho relativo/@/.\n`,
  )
  process.exit(1)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
