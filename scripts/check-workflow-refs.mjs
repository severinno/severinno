#!/usr/bin/env node

// =============================================================================
// check-workflow-refs.mjs
//
// CI guard que detecta referências QUEBRADAS (dangling references) entre os
// workflows de .github/workflows/ e os artefatos que eles chamam:
//
//   1. Scripts — `run:` invocando `node|bun|bash|sh|python3|python scripts/X`
//      → verifica que scripts/X EXISTE em scripts/
//   2. package.json — `run:` invocando `bun|npm|pnpm|yarn run <entry>`
//      → verifica que a entry EXISTE em package.json > scripts
//   3. Reusable workflows — `uses: ./.github/workflows/X.yml`
//      → verifica que X.yml EXISTE e tem `on: workflow_call`
//   4. Composite actions locais — `uses: ./.github/actions/<name>`
//      → verifica que .github/actions/<name>/action.yml EXISTE
//
// Por que existe: consolidações como a matrix 2×2 do seed-guards.yml deletam
// e renomeiam workflows/scripts em lote (ex.: seed-dev-bootstrap.yml →
// seed-guards.yml). Uma referência quebrada só falharia no JOB que a executa
// — com custo de runner já pago e mensagem de "command not found" confusa.
// Este guard roda em <1s (node-puro, sem deps) e falha o PR no início, com a
// referência exata (arquivo:linha) e o artefato faltante.
//
// Escopo:
//   - Ignora linhas de comentário (#) e linhas em branco
//   - REMOVE expressões ${{ ... }} (DINÂMICAS — não resolvíveis estaticamente)
//     mas continua validando refs ESTÁTICAS na mesma linha (ex.:
//     `node scripts/run-benchmark.mjs ${{ matrix.type }}` valida o script)
//   - O prefixo `node|bash|bun|...` antes de `scripts/` evita falsos positivos
//     de menções em texto (ex.: "veja scripts/foo.mjs" não casa)
//   - `bunx prisma generate` NÃO casa (bunx ≠ bun run) — npx-style é ignorado
//
// Complementa scripts/validate-workflows.py (YAML syntax + orphan + anchors),
// que NÃO está ligado ao CI e não cobre scripts/ nem package.json.
//
// Usage:
//   node scripts/check-workflow-refs.mjs
//
// Exit codes:
//   0 — nenhuma referência quebrada (pass)
//   1 — pelo menos uma referência quebrada (fail)
// =============================================================================

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// ---------------------------------------------------------------------------
// Config — padrões de referência
// ---------------------------------------------------------------------------

/** Invocação de script: `node|bun|bash|sh|python3|python scripts/<file>`. */
const SCRIPT_INVOKE_RE =
  /\b(?:node|bun|bash|sh|python3|python)\b\s+(?:\.\/)?scripts\/([A-Za-z0-9_./-]+)/g

/** Entry de package.json: `bun|npm|pnpm|yarn run <entry>`. */
const PKG_RUN_RE = /\b(?:bun|npm|pnpm|yarn)\b\s+run\s+([A-Za-z0-9_:.-]+)/g

/** Reusable workflow local: `uses: ./.github/workflows/<file>.yml`. */
const USES_LOCAL_RE = /uses:\s*\.\/\.github\/workflows\/([A-Za-z0-9_.-]+\.yml)/g

/** Composite action local: `uses: ./.github/actions/<name>`. */
const USES_ACTION_RE = /uses:\s*\.\/\.github\/actions\/([A-Za-z0-9_.-]+)/g

/**
 * Expressão DINÂMICA do GitHub Actions (`${{ ... }}`) — não resolvível
 * estaticamente. É REMOVIDA da linha antes do scan (não pula a linha toda).
 */
const DYNAMIC_EXPR_RE = /\$\{\{[^}]*\}\}/g

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Prepara uma linha para scan: retorna a linha com ${{ }} removidos, ou
 * `null` se for comentário (#), vazia ou só contiver expressões dinâmicas.
 */
function scannableLine(trimmed) {
  if (trimmed === "" || trimmed.startsWith("#")) return null
  const stripped = trimmed.replace(DYNAMIC_EXPR_RE, "").trim()
  return stripped === "" ? null : stripped
}

/**
 * Extrai as invocações de scripts (`node|bash|bun scripts/X`) de `content`.
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, ref: string, text: string }[]}  ref = nome do arquivo (sem scripts/)
 */
export function extractScriptRefs(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const scan = scannableLine(trimmed)
    if (scan === null) continue
    // matchAll clona a regex /g — lastIndex do módulo nunca avança (seguro).
    for (const m of scan.matchAll(SCRIPT_INVOKE_RE)) {
      refs.push({ line: i + 1, ref: m[1], text: trimmed.slice(0, 80) })
    }
  }
  return refs
}

/**
 * Extrai as entries de package.json (`bun|npm|pnpm|yarn run <entry>`).
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, ref: string, text: string }[]}  ref = nome da entry
 */
export function extractPkgScriptRefs(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const scan = scannableLine(trimmed)
    if (scan === null) continue
    // matchAll clona a regex /g — lastIndex do módulo nunca avança (seguro).
    for (const m of scan.matchAll(PKG_RUN_RE)) {
      refs.push({ line: i + 1, ref: m[1], text: trimmed.slice(0, 80) })
    }
  }
  return refs
}

/**
 * Extrai os reusable workflows locais (`uses: ./.github/workflows/X.yml`).
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, ref: string, text: string }[]}  ref = nome do arquivo .yml
 */
export function extractWorkflowUses(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const scan = scannableLine(trimmed)
    if (scan === null) continue
    // matchAll clona a regex /g — lastIndex do módulo nunca avança (seguro).
    for (const m of scan.matchAll(USES_LOCAL_RE)) {
      refs.push({ line: i + 1, ref: m[1], text: trimmed.slice(0, 80) })
    }
  }
  return refs
}

/**
 * Extrai os composite actions locais (`uses: ./.github/actions/<name>`).
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, ref: string, text: string }[]}  ref = nome da action
 */
export function extractActionUses(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const scan = scannableLine(trimmed)
    if (scan === null) continue
    // matchAll clona a regex /g — lastIndex do módulo nunca avança (seguro).
    for (const m of scan.matchAll(USES_ACTION_RE)) {
      refs.push({ line: i + 1, ref: m[1], text: trimmed.slice(0, 80) })
    }
  }
  return refs
}

/**
 * Verifica UM arquivo de workflow contra o contexto de artefatos disponíveis.
 *
 * @param {string} name     nome do workflow (ex.: "pr-check.yml")
 * @param {string} content  conteúdo do workflow
 * @param {{ scripts: Set<string>, pkgScripts: Set<string>, workflows: Set<string>, workflowCall: Set<string>, actions: Set<string> }} ctx
 * @returns {{ file: string, line: number, kind: string, ref: string, text: string, detail?: string }[]}
 */
export function checkWorkflowFile(name, content, ctx) {
  const violations = []

  for (const r of extractScriptRefs(content)) {
    if (!ctx.scripts.has(r.ref)) {
      violations.push({ file: name, line: r.line, kind: "script", ref: r.ref, text: r.text })
    }
  }

  for (const r of extractPkgScriptRefs(content)) {
    if (!ctx.pkgScripts.has(r.ref)) {
      violations.push({
        file: name,
        line: r.line,
        kind: "package.json",
        ref: r.ref,
        text: r.text,
      })
    }
  }

  for (const r of extractWorkflowUses(content)) {
    if (!ctx.workflows.has(r.ref)) {
      violations.push({ file: name, line: r.line, kind: "workflow", ref: r.ref, text: r.text })
    } else if (!ctx.workflowCall.has(r.ref)) {
      violations.push({
        file: name,
        line: r.line,
        kind: "workflow",
        ref: r.ref,
        detail: "arquivo existe mas NÃO tem 'on: workflow_call'",
        text: r.text,
      })
    }
  }

  for (const r of extractActionUses(content)) {
    if (!ctx.actions.has(r.ref)) {
      violations.push({ file: name, line: r.line, kind: "action", ref: r.ref, text: r.text })
    }
  }

  return violations
}

/**
 * Escaneia um conjunto de arquivos de workflow de uma vez.
 *
 * @param {{ name: string, content: string }[]} files
 * @param {{ scripts: Set<string>, pkgScripts: Set<string>, workflows: Set<string>, workflowCall: Set<string>, actions: Set<string> }} ctx
 * @returns {{ file: string, line: number, kind: string, ref: string, text: string, detail?: string }[]}
 */
export function scanWorkflows(files, ctx) {
  return files.flatMap((f) => checkWorkflowFile(f.name, f.content, ctx))
}

// ---------------------------------------------------------------------------
// Main — varre .github/workflows/*.yml contra scripts/ + package.json
// ---------------------------------------------------------------------------

/** Lista os arquivos de um diretório (exit 1 com mensagem se ilegível). */
function listDir(dir) {
  try {
    return readdirSync(dir).sort()
  } catch (e) {
    console.error(`❌ Não foi possível ler ${dir}: ${e.message}`)
    process.exit(1)
  }
}

/** Lê as entries de package.json > scripts (exit 1 se package.json ilegível). */
function readPkgScripts(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))
    return new Set(Object.keys(pkg.scripts || {}))
  } catch (e) {
    console.error(`❌ Não foi possível ler package.json: ${e.message}`)
    process.exit(1)
  }
}

function main() {
  const cwd = process.cwd()
  const wfDir = join(cwd, ".github", "workflows")

  // ── Contexto: artefatos disponíveis ──────────────────────────────────
  const names = listDir(wfDir).filter((f) => f.endsWith(".yml"))
  const scripts = new Set(listDir(join(cwd, "scripts")))
  const pkgScripts = readPkgScripts(cwd)
  const workflows = new Set(names)

  // Composite actions locais: .github/actions/<name>/action.yml existentes
  // (diretório pode não existir — ex.: repositório sem actions locais; nesse
  // caso qualquer `uses: ./.github/actions/X` é dangling e é reportado).
  const actionsDir = join(cwd, ".github", "actions")
  const actions = new Set(
    existsSync(actionsDir)
      ? listDir(actionsDir).filter((d) => existsSync(join(actionsDir, d, "action.yml")))
      : [],
  )

  const files = names.map((n) => ({ name: n, content: readFileSync(join(wfDir, n), "utf8") }))
  // Reusa o conteúdo já lido (não re-lê os arquivos para o check de workflow_call)
  const workflowCall = new Set(
    files.filter((f) => /workflow_call/.test(f.content)).map((f) => f.name),
  )
  const violations = scanWorkflows(files, { scripts, pkgScripts, workflows, workflowCall, actions })

  if (violations.length > 0) {
    console.error(`❌ Referência(s) quebrada(s) entre workflows e scripts/package.json:\n`)
    for (const v of violations) {
      const detail = v.detail ? ` (${v.detail})` : ""
      console.error(`   - ${v.file}:${v.line}  [${v.kind}] ${v.ref}${detail}`)
      console.error(`     → ${v.text}`)
    }
    console.error(
      `\n   Ação: restaure o artefato removido OU atualize a referência no workflow.` +
        `\n   Referências dinâmicas (expressões \${{ }}) e comentários são ignorados pelo guard.`,
    )
    process.exit(1)
  }

  console.log("✅ Nenhuma referência quebrada entre workflows e scripts/package.json.")
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
