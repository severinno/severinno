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
//      → E, se a entry invocar `scripts/X`, verifica que scripts/X EXISTE
//        (par TRANSITIVO fechado — espelho do `bun run test:mutation-X` do
//        check-mutation-jobs.mjs: entry apontando para script deletado
//        falharia no runtime do job; o guard pega no review)
//   3. Reusable workflows — `uses: ./.github/workflows/X.yml`
//      → verifica que X.yml EXISTE e tem `on: workflow_call`
//   4. Composite actions locais — `uses: ./.github/actions/<name>`
//      → verifica que .github/actions/<name>/action.yml EXISTE
//   5. Consistência INTERNA do package.json (modo --pkg-internal) — TODA
//      entry que invoca `scripts/X` deve ter X existente em scripts/, MESMO
//      que nenhum workflow a referencie. Cobre hooks locais e runs manuais
//      `bun run <entry>`: um script deletado quebraria o hook local no
//      runtime, e o scan workflow-only não enxerga entries órfãs de workflow.
//
// Por que existe: consolidações como a matrix 2×2 do seed-guards.yml deletam
// e renomeiam workflows/scripts em lote (ex.: seed-dev-bootstrap.yml →
// seed-guards.yml). Uma referência quebrada só falharia no JOB que a executa
// — com custo de runner já pago e mensagem de "command not found" confusa.
// Este guard roda em <1s (node-puro, sem deps) e falha o PR no início, com a
// referência exata (arquivo:linha) e o artefato faltante.
//
// Escopo:
//   - Ignora comentário — a LINHA toda e o de FIM DE LINHA (`run: # ...`): os
//     dois não executam nada, e uma ref vinda de um comentário valida código
//     morto. Mesma leitura do `check-forge-parity` (`executableLines`).
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
//   node scripts/check-workflow-refs.mjs                 # workflow-only scan
//   node scripts/check-workflow-refs.mjs --pkg-internal  # + interna do pkg
// Exit codes:
//   0 — nenhuma referência quebrada (pass)
//   1 — pelo menos uma referência quebrada (fail)
// =============================================================================

import { existsSync, readdirSync, readFileSync } from "node:fs"

import {
  FORGE_ACTIONS_DIRS,
  allWorkflowFiles,
  defaultsRunLines,
  existingWorkflowDirs,
} from "./forge-workflows.mjs"
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

/**
 * Alvo de scripts/ DENTRO do valor de uma entry de package.json (ex.: o
 * valor `bash scripts/test-seed-prod-e2e.sh --skip-docker` → alvo
 * `test-seed-prod-e2e.sh`). Não-global (sem /g) de propósito — usado com
 * .exec()/.match() repetidamente; um regex /g compartilhado com lastIndex
 * avançando entre chamadas produziria falsos negativos intermitentes.
 */
const PKG_TARGET_RE =
  /\b(?:node|bun|bash|sh|python3|python)\b\s+(?:\.\/)?scripts\/([A-Za-z0-9_./-]+)/

/**
 * Reusable workflow local: `uses: ./<forge>/workflows/<file>.yml` — o `forge`
 * é curinga de propósito (`.github`, `.gitea`, ou a próxima forja): a ref
 * aponta para o arquivo, e o guard valida contra o conjunto de workflows de
 * TODAS as forjas. O grupo de captura continua sendo só o nome do arquivo, para
 * não mudar o contrato das funções puras já testadas.
 */
const USES_LOCAL_RE = /uses:\s*\.\/\.[A-Za-z0-9_.-]+\/workflows\/([A-Za-z0-9_.-]+\.yml)/g

/** Composite action local: `uses: ./<forge>/actions/<name>`. */
const USES_ACTION_RE = /uses:\s*\.\/\.[A-Za-z0-9_.-]+\/actions\/([A-Za-z0-9_.-]+)/g

/**
 * Expressão DINÂMICA do GitHub Actions (`${{ ... }}`) — não resolvível
 * estaticamente. É REMOVIDA da linha antes do scan (não pula a linha toda).
 */
const DYNAMIC_EXPR_RE = /\$\{\{[^}]*\}\}/g

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Prepara uma linha para scan: retorna a linha com comentário de FIM DE LINHA e
 * ${{ }} removidos, ou `null` se for linha de comentário (#), vazia ou só
 * contiver expressões dinâmicas.
 *
 * O comentário de FIM DE LINHA entra pela MESMA razão que a linha inteira de
 * comentário: `- run: # node scripts/x.mjs` não executa nada (em YAML, `#`
 * depois de espaço inicia comentário, e o `run:` fica vazio) — e uma ref
 * extraída daí VALIDA um script que a pipeline nunca roda. A direção do erro é
 * pior que a de uma ref não validada: o guard afirma conserto sobre código
 * morto. É a MESMA leitura do `check-forge-parity` (`executableLines`), que já
 * ignorava comentário de fim de linha — uma régua só para "o que executa".
 */
function scannableLine(trimmed) {
  if (trimmed === "" || trimmed.startsWith("#")) return null
  const semComentario = trimmed.replace(/(^|\s)#.*$/, "$1").trim()
  const stripped = semComentario.replace(DYNAMIC_EXPR_RE, "").trim()
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
  // `defaults.run` e DECLARACAO (o shell default do escopo), nao passo: uma ref
  // achada ali aponta para um script que a pipeline NUNCA executa — validar (ou
  // deixar de validar) por ela e medir o que nao roda.
  const defaults = defaultsRunLines(content)
  for (let i = 0; i < lines.length; i++) {
    if (defaults.has(i + 1)) continue
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
  // `defaults.run` e DECLARACAO (o shell default do escopo), nao passo: uma ref
  // achada ali aponta para um script que a pipeline NUNCA executa — validar (ou
  // deixar de validar) por ela e medir o que nao roda.
  const defaults = defaultsRunLines(content)
  for (let i = 0; i < lines.length; i++) {
    if (defaults.has(i + 1)) continue
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
 * Extrai os reusable workflows locais (`uses: ./<forge>/workflows/X.yml`).
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, ref: string, text: string }[]}  ref = nome do arquivo .yml
 */
export function extractWorkflowUses(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  // `defaults.run` e DECLARACAO (o shell default do escopo), nao passo: uma ref
  // achada ali aponta para um script que a pipeline NUNCA executa — validar (ou
  // deixar de validar) por ela e medir o que nao roda.
  const defaults = defaultsRunLines(content)
  for (let i = 0; i < lines.length; i++) {
    if (defaults.has(i + 1)) continue
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
 * Extrai os composite actions locais (`uses: ./<forge>/actions/<name>`).
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, ref: string, text: string }[]}  ref = nome da action
 */
export function extractActionUses(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  // `defaults.run` e DECLARACAO (o shell default do escopo), nao passo: uma ref
  // achada ali aponta para um script que a pipeline NUNCA executa — validar (ou
  // deixar de validar) por ela e medir o que nao roda.
  const defaults = defaultsRunLines(content)
  for (let i = 0; i < lines.length; i++) {
    if (defaults.has(i + 1)) continue
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
 * Extrai o ALVO de scripts/ do valor de uma entry de package.json — ex.: o
 * valor `bash scripts/test-seed-prod-e2e.sh --skip-docker` → alvo
 * `test-seed-prod-e2e.sh`. Retorna null quando a entry não invoca scripts/
 * (ex.: `eslint .`, `bunx prisma generate`) — não há alvo a validar.
 *
 * @param {string|null|undefined} entryValue  valor cru da entry (ex.: "bash
 *   scripts/foo.sh --ci"; null/undefined são normalizados para "" — a
 *   função é defensiva de propósito, validada no teste unitário)
 * @returns {string|null} nome do script alvo (sem scripts/) ou null
 */
export function extractPkgScriptTarget(entryValue) {
  const m = String(entryValue ?? "").match(PKG_TARGET_RE)
  return m ? m[1] : null
}

/**
 * Consistência INTERNA do package.json (modo --pkg-internal): TODA entry
 * cujo valor invoca `scripts/X` deve ter X existente em scripts/ — MESMO que
 * NENHUM workflow a referencie. O checkWorkflowFile só avalia entries
 * REFERENCIADAS por um workflow (escopo workflow→artefato); uma entry órfã
 * de workflow (ex.: usada por hook local `bun run <entry>` ou manualmente)
 * com o script deletado quebraria no runtime SEM este modo.
 *
 * @param {Record<string,string>} pkgEntries  package.json > scripts (entry → valor)
 * @param {Set<string>} scripts               nomes existentes em scripts/
 * @returns {{ file: string, line: number, kind: string, ref: string, text: string, detail: string }[]}
 */
export function checkPkgInternalTargets(pkgEntries = {}, scripts) {
  const violations = []
  for (const [entry, value] of Object.entries(pkgEntries)) {
    const target = extractPkgScriptTarget(value)
    if (!target) continue // entry sem invocação de scripts/ — sem alvo a validar
    if (scripts.has(target)) continue
    violations.push({
      file: "package.json",
      line: 0, // main() preenche a linha real (pkgEntryLine) antes de imprimir
      kind: "package.json",
      ref: entry,
      detail: `entry '${entry}' invoca scripts/${target} que NÃO existe (consistência INTERNA — mesmo sem workflow referenciando)`,
      text: value,
    })
  }
  return violations
}

/**
 * Linha (1-based) da CHAVE `"<entry>":` no texto cru do package.json — para
 * o diagnóstico do modo --pkg-internal apontar arquivo:linha como o restante
 * do guard (falha de infra não é possível: o JSON já foi parseado com sucesso).
 * Casa SÓ a posição de chave (`"<entry>"\s*:`) — um valor que contenha a
 * string `"<entry>"` escapada (ex.: `"a": "echo \"lint\" && ..."` com a
 * entry `lint` real em outra linha) não pode gerar falso match de linha.
 *
 * @param {string} rawText  conteúdo cru do package.json
 * @param {string} entry    nome da entry
 * @returns {number} linha 1-based (0 se não encontrada — defensivo)
 */
export function pkgEntryLine(rawText, entry) {
  const lines = String(rawText ?? "").split(/\r?\n/)
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const keyRe = new RegExp(`"${escapeRe(entry)}"\\s*:`)
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) return i + 1
  }
  return 0
}

/**
 * Verifica UM arquivo de workflow contra o contexto de artefatos disponíveis.
 *
 * @param {string} name     nome do workflow (ex.: "pr-check.yml")
 * @param {string} content  conteúdo do workflow
 * @param {{ scripts: Set<string>, pkgScripts: Set<string>, pkgTargets?: Map<string,string>, workflows: Set<string>, workflowCall: Set<string>, actions: Set<string> }} ctx
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
      continue
    }
    // Par TRANSITIVO fechado (espelho do check-mutation-jobs): a entry EXISTE,
    // mas o ALVO dela (scripts/X) não — `run: bun run <entry>` falharia no
    // runtime do job com 'bash: scripts/X: No such file'. Só avalia entries
    // REFERENCIADAS pelo workflow (o escopo do guard é workflow→artefato).
    const target = ctx.pkgTargets?.get(r.ref)
    if (target && !ctx.scripts.has(target)) {
      violations.push({
        file: name,
        line: r.line,
        kind: "package.json",
        ref: r.ref,
        detail: `entry '${r.ref}' aponta para scripts/${target} que NÃO existe`,
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
 * @param {{ scripts: Set<string>, pkgScripts: Set<string>, pkgTargets?: Map<string,string>, workflows: Set<string>, workflowCall: Set<string>, actions: Set<string> }} ctx
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

/**
 * Lê as entries de package.json > scripts (exit 1 se package.json ilegível)
 * e devolve: os NOMES das entries (Set), o ALVO de scripts/ de cada entry
 * que invoca scripts/ (Map<entry, alvo>), as entries CRUAS (entry → valor,
 * para o modo --pkg-internal) e o texto cru (para linha de diagnóstico).
 */
function readPkgScripts(cwd) {
  try {
    const rawText = readFileSync(join(cwd, "package.json"), "utf8")
    const pkg = JSON.parse(rawText)
    const entries = pkg.scripts || {}
    const pkgScripts = new Set(Object.keys(entries))
    const pkgTargets = new Map()
    for (const [entry, value] of Object.entries(entries)) {
      const target = extractPkgScriptTarget(value)
      if (target) pkgTargets.set(entry, target)
    }
    return { pkgScripts, pkgTargets, pkgEntries: entries, rawText }
  } catch (e) {
    console.error(`❌ Não foi possível ler package.json: ${e.message}`)
    process.exit(1)
  }
}

function main() {
  const args = process.argv.slice(2)
  const pkgInternal = args.includes("--pkg-internal")

  const cwd = process.cwd()
  const dirs = existingWorkflowDirs(cwd)

  // ── Contexto: artefatos disponíveis ──────────────────────────────────
  // Leitura única de TODAS as forjas. O conjunto `workflows` é a UNIÃO dos
  // basenames: uma ref `uses: ./<forge>/workflows/X.yml` resolve se X.yml
  // existir em qualquer forja (o nome é o contrato; a forja é o endereço).
  const all = allWorkflowFiles(cwd)
  const read = all.map((w) => ({
    dir: w.dir,
    name: w.name,
    content: readFileSync(join(cwd, w.path), "utf8"),
  }))
  const scripts = new Set(listDir(join(cwd, "scripts")))
  const { pkgScripts, pkgTargets, pkgEntries, rawText } = readPkgScripts(cwd)
  const workflows = new Set(read.map((f) => f.name))

  // Composite actions locais: <forge>/actions/<name>/action.yml existentes
  // (diretório pode não existir — ex.: repositório sem actions locais; nesse
  // caso qualquer `uses: ./<forge>/actions/X` é dangling e é reportado).
  const actions = new Set(
    FORGE_ACTIONS_DIRS.flatMap((rel) => {
      const abs = join(cwd, rel)
      return existsSync(abs)
        ? listDir(abs).filter((d) => existsSync(join(abs, d, "action.yml")))
        : []
    }),
  )

  // Reusa o conteúdo já lido (não re-lê os arquivos para o check de workflow_call)
  const workflowCall = new Set(
    read.filter((f) => /workflow_call/.test(f.content)).map((f) => f.name),
  )
  // Scaneia por forja para que a violação diga em QUAL pipeline ela está.
  const violations = []
  for (const dir of dirs) {
    const files = read.filter((f) => f.dir === dir).map(({ name, content }) => ({ name, content }))
    for (const v of scanWorkflows(files, {
      scripts,
      pkgScripts,
      pkgTargets,
      workflows,
      workflowCall,
      actions,
    })) {
      violations.push({ ...v, file: `${dir}/${v.file}` })
    }
  }

  // ── Modo --pkg-internal: consistência INTERNA do package.json ────────
  // Valida TODAS as entries que invocam scripts/ (mesmo sem workflow
  // referenciando — hooks locais/manuais). Preenche a linha real da entry no
  // package.json para o diagnóstico apontar arquivo:linha (como o restante).
  if (pkgInternal) {
    for (const v of checkPkgInternalTargets(pkgEntries, scripts)) {
      violations.push({ ...v, line: pkgEntryLine(rawText, v.ref) || 0 })
    }
  }

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
