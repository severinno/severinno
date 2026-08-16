#!/usr/bin/env node

// =============================================================================
// check-no-npx-playwright.mjs
//
// CI guard que impede o RETORNO de `npx playwright` em docs/scripts/package.json.
//
// Por que existe: no Windows, o `npx` resolve uma instância DIFERENTE de
// @playwright/test no grafo de módulos (os shims `.cmd`/shell do npm vs os
// symlinks do bun) e `npx playwright test` falhava em TODOS os specs do E2E
// com 'did not expect test.describe() to be called here' — enquanto `bunx`
// (e o CLI direto) funcionavam. O runner oficial é `bunx playwright` (ou
// `bun run e2e`) — documentado no Troubleshooting do README. Este guard
// trava a decisão no código: reintroduzir `npx playwright` em docs/README.md,
// docs/**/*.md, scripts/*.sh/*.bash ou package.json falha o PR, apontando
// para o bunx.
//
// Escopo (decisão ESCOPO INTENCIONAL):
//   - README.md + docs/**/*.md      → SÓ posição de COMANDO: linha iniciando
//     com `npx playwright` OU seguida de subcomando/flag do Playwright
//     (test, install, list, codegen, open, show, --*). Menções em PROSA
//     (ex.: o próprio Troubleshooting "`npx playwright` quebra no Windows")
//     são isentas — elas DOCUMENTAM a regressão e não executam nada.
//   - scripts/*.sh + scripts/*.bash → qualquer ocorrência fora de comentário
//     ou echo (contexto executável). Arquivos test-mutation-*.sh são
//     EXCLUÍDOS de propósito: mutation tests introduzem o padrão em fixtures
//     temporários (--root) para provar que o guard detecta a regressão.
//   - package.json                   → qualquer ocorrência (contexto de script).
//   - .github/workflows/ e Makefile  → FORA do escopo (por decisão; estenda
//     o guard se quiser cobri-los).
//
// Node puro, sem deps, <1s.
//
// Usage:
//   node scripts/check-no-npx-playwright.mjs           # repo atual
//   node scripts/check-no-npx-playwright.mjs --root X  # fixture (testes)
//
// Exit codes:
//   0 — nenhuma ocorrência em posição de comando (pass)
//   1 — pelo menos uma ocorrência (fail — mensagem aponta para bunx)
//   2 — flag desconhecida
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Regex do padrão proibido (runner npm do Playwright). */
export const NPX_PLAYWRIGHT_RE = /npx\s+playwright/i

/** Subcomandos/flags do Playwright que caracterizam POSIÇÃO DE COMANDO em docs. */
const PW_COMMAND_ARGS = "(?:test|install|list|codegen|open|show|--[a-z0-9-]+)"

/** Em docs (.md): comando = linha iniciando com o padrão OU com subcomando. */
const MD_COMMAND_RE = new RegExp(
  `(?:^\\s*npx\\s+playwright|npx\\s+playwright\\s+${PW_COMMAND_ARGS})`,
  "i",
)

/** Linha de comentário/echo (não executa) — isenta no scan de .sh. */
function isInertShellLine(line) {
  const t = line.trim()
  return t === "" || t.startsWith("#") || /^\s*(?:echo|printf)/.test(line)
}

/**
 * Encontra refs a `npx playwright` num conteúdo.
 *
 * @param {string} content  conteúdo do arquivo
 * @param {"sh"|"md"|"json"} kind  tipo de contexto (determina o que é comando)
 * @returns {{line: number, text: string}[]} refs (linha 1-based)
 */
export function findNpxPlaywrightRefs(content, kind) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let hit = false
    if (kind === "md") {
      hit = MD_COMMAND_RE.test(line)
    } else if (kind === "sh") {
      if (isInertShellLine(line)) continue
      hit = NPX_PLAYWRIGHT_RE.test(line)
    } else {
      hit = NPX_PLAYWRIGHT_RE.test(line)
    }
    if (hit) refs.push({ line: i + 1, text: line.trim().slice(0, 90) })
  }
  return refs
}

/** Arquivos de mutation test são EXCLUÍDOS (introduzem o padrão de propósito). */
function isMutationTestFile(name) {
  return /^test-mutation-.*\.(sh|bash)$/.test(name)
}

/** Lista .md recursivamente sob um diretório. */
function listMarkdownFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      out.push(...listMarkdownFiles(abs))
    } else if (name.endsWith(".md")) {
      out.push(abs)
    }
  }
  return out
}

/**
 * Varre um diretório raiz (repo ou fixture) — retorna violações por arquivo.
 *
 * @param {string} root  diretório raiz
 * @returns {{file: string, refs: {line: number, text: string}[]}[]}
 */
export function scanNpxPlaywright(root) {
  const violations = []

  const pushIfRefs = (rel, abs, kind) => {
    const refs = findNpxPlaywrightRefs(readFileSync(abs, "utf8"), kind)
    if (refs.length > 0) violations.push({ file: rel, refs })
  }

  // docs — README.md (raiz) + docs/**/*.md (posição de comando)
  const readme = join(root, "README.md")
  if (existsSync(readme)) pushIfRefs("README.md", readme, "md")

  const docsDir = join(root, "docs")
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
    for (const abs of listMarkdownFiles(docsDir)) {
      const rel = `docs/${abs.slice(docsDir.length + 1).replace(/\\/g, "/")}`
      pushIfRefs(rel, abs, "md")
    }
  }

  // scripts — *.sh/*.bash (fora test-mutation-*)
  const scriptsDir = join(root, "scripts")
  if (existsSync(scriptsDir) && statSync(scriptsDir).isDirectory()) {
    for (const name of readdirSync(scriptsDir)) {
      if (!/\.(sh|bash)$/.test(name)) continue
      if (isMutationTestFile(name)) continue
      const rel = `scripts/${name}`
      pushIfRefs(rel, join(scriptsDir, name), "sh")
    }
  }

  // package.json — contexto de script
  const pkg = join(root, "package.json")
  if (existsSync(pkg)) pushIfRefs("package.json", pkg, "json")

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

  const violations = scanNpxPlaywright(root)

  if (violations.length > 0) {
    console.error(`❌ 'npx playwright' encontrado em ${violations.length} arquivo(s):\n`)
    for (const v of violations) {
      for (const ref of v.refs) {
        console.error(`   - ${v.file}:${ref.line}  ${ref.text}`)
      }
    }
    console.error(
      `\n   Runner oficial do Playwright é 'bunx playwright' (ou 'bun run e2e').` +
        `\n   No Windows, o npx executa o shim .EXE do bun via cmd.exe e resolve uma` +
        `\n   instância DIFERENTE de @playwright/test no grafo de módulos (No tests` +
        `\n   found / 'did not expect test.describe() to be called here'). Para usar o` +
        `\n   npx mesmo assim, gere os shims do npm no worktree: npm install --no-save` +
        `\n   --no-package-lock @playwright/test@<versão do bun.lock> — veja o` +
        `\n   Troubleshooting do README. Substitua por 'bunx playwright'.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Nenhum 'npx playwright' em docs/scripts/package.json (runner oficial: bunx playwright).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
