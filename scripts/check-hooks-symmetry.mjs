#!/usr/bin/env node

// =============================================================================
// check-hooks-symmetry.mjs
//
// CI guard (fast gate, <1s, node-puro) que valida que a tabela "## Git Hooks —
// Pre-commit vs Pre-push (simetria)" do README bate com o CONTEÚDO REAL de
// .husky/pre-commit e .husky/pre-push — falhando se um guard novo for
// adicionado a um hook sem atualizar a doc (o caso de drift que a tabela
// existe para prevenir).
//
// Fonte da verdade: os hooks (e o runner compartilhado
// scripts/run-encoding-guards.sh, expandido inline). Para cada guard
// efetivamente invocado por um hook, o README DEVE ter uma linha na tabela
// com o marcador correto na coluna do hook (✅ pre-commit / ✅ pre-push).
//
// Guards com sufixo (ex.: `check-bun-mirror.mjs --staged`) viram chaves
// DISTINTAS da versão global — a tabela já documenta a variante staged como
// linha própria.
//
// Usage:
//   node scripts/check-hooks-symmetry.mjs       # check; exit 1 on drift
//
// Exit codes:
//   0 — tabela sincronizada com os hooks (pass)
//   1 — guard invocado num hook sem a linha correspondente na tabela
//   2 — infra: hook/README ausente (fail-closed)
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** Chave canônica de um guard extraída de um comando de hook ou linha da tabela. */
const SCRIPT_RE = /scripts\/([a-z0-9._-]+\.(?:mjs|sh|ts|tsx))/i
/**
 * Variante ANCORADA à posição de COMANDO (node/bash/bun run/bun x) usada
 * nos hooks: `bash scripts/check-crlf.sh --ci`. Sem a âncora, o regex
 * casaria `scripts/foo.sh` DENTRO de uma string de comando (ex.:
 * SKIP_PATTERN='...scripts/foo.sh') e geraria guard fantasma — o que
 * aconteceu de verdade e foi travado em teste.
 */
const HOOK_COMMAND_RE = /^(?:node|bash|bun run|bun x)\s+scripts\/([a-z0-9._-]+\.(?:mjs|sh|ts|tsx))/i
/**
 * Nome de guard SEM o prefixo scripts/ na tabela do README. Só o backtick de
 * ABERTURA é exigido: a tabela cita o comando INTEIRO em \`check-utf8.sh
 * --dry-run --ci src/\` — exigir o backtick de FECHAMENTO colado ao nome
 * faria as linhas com flags falharem (bug real pego em teste). O backtick de
 * abertura evita casar `foo.sh` DENTRO de uma string de comando (ex.:
 * SKIP_PATTERN='...scripts/foo.sh'), que viraria guard fantasma.
 */
const BARE_SCRIPT_RE = /`([a-z0-9._-]+\.(?:mjs|sh|ts|tsx))/i

/** Linhas da tabela cujo comando não é um `scripts/*` (mapeadas por descrição). */
const ROW_KEY_BY_DESC = {
  "format + lint": "lint-staged",
  "testes unitários": "test:unit",
  "imports diretos": "check-direct-rtl-import",
  "barrel lint": "barrel-lint",
  typecheck: "typecheck",
}

/** Comandos diretos dos hooks que não são `node|bash scripts/...`. */
const HOOK_KEY_BY_CMD = {
  "bun run typecheck": "typecheck",
  "bun run check:direct-rtl-import": "check-direct-rtl-import",
  "bun run barrel-lint": "barrel-lint",
  "bun x lint-staged": "lint-staged",
  "bun run test:unit": "test:unit",
  "bun run fuzz:ci": "test:unit",
  "bun run fuzz": "test:unit",
}

/**
 * Extrai os guards invocados por um hook: linhas de comando `node|bash
 * scripts/X...` (com a variante `--staged` quando presente) + comandos
 * diretos mapeados. Flags de EXECUÇÃO (ex.: `--ci`, `--dry-run`, `--check`)
 * NÃO fazem parte da chave — só `--staged` cria uma variante distinta.
 *
 * @param {string} hookContent  conteúdo de .husky/pre-commit ou pre-push
 * @returns {Map<string, {hook: "pre-commit"|"pre-push"}[]>} chave → invocações
 */
export function extractHookGuards(hookContent) {
  const guards = new Map()
  const push = (key) => {
    if (!key) return
    const arr = guards.get(key) ?? []
    arr.push({})
    guards.set(key, arr)
  }
  for (const rawLine of hookContent.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) continue
    const m = line.match(HOOK_COMMAND_RE)
    if (m) {
      // o runner compartilhado NÃO é um guard — expande via extractRunnerGuards
      if (m[1] === "run-encoding-guards.sh") continue
      push(line.includes("--staged") ? `${m[1]} --staged` : m[1])
      continue
    }
    // comandos diretos (bun run X / bun x Y)
    for (const [cmd, key] of Object.entries(HOOK_KEY_BY_CMD)) {
      if (line.includes(cmd)) {
        push(key)
        break
      }
    }
  }
  return guards
}

/**
 * Extrai os guards do runner compartilhado (run-encoding-guards.sh) — os
 * "fast gates" que ambos os hooks rodam de forma IDÊNTICA.
 *
 * @param {string} runnerContent  conteúdo de scripts/run-encoding-guards.sh
 * @returns {string[]} chaves canônicas (sem duplicatas, na ordem)
 */
export function extractRunnerGuards(runnerContent) {
  const seen = new Set()
  for (const rawLine of runnerContent.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) continue
    const m = line.match(SCRIPT_RE)
    if (m) seen.add(m[1])
  }
  return [...seen]
}

/**
 * Extrai as linhas da tabela de simetria do README: descrição + marcadores
 * de pre-commit e pre-push, com a chave canônica do guard.
 *
 * @param {string} readmeContent  conteúdo do README.md
 * @returns {Map<string, {desc: string, preCommit: boolean, prePush: boolean}>}
 */
export function extractReadmeRows(readmeContent) {
  const lines = readmeContent.split(/\r?\n/)
  const headingIdx = lines.findIndex((l) => l.trim().startsWith("## Git Hooks"))
  if (headingIdx === -1) {
    throw new Error("seção '## Git Hooks' não encontrada no README")
  }
  const rows = new Map()
  let inTable = false
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith("|")) {
      if (!inTable) {
        inTable = true // header row — ignora
        continue
      }
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue // separator row — ignora
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim())
      if (cells.length < 3) continue
      const [desc, preCommit, prePush] = cells
      const key = rowKeyFromDesc(desc)
      if (key) {
        rows.set(key, {
          desc,
          preCommit: preCommit !== "—",
          prePush: prePush !== "—",
        })
      }
    } else if (inTable) {
      // fim da tabela — evita contagem de uma segunda tabela abaixo
      break
    }
  }
  return rows
}

/** Deriva a chave canônica de uma descrição de linha da tabela. */
export function rowKeyFromDesc(desc) {
  const lower = desc.toLowerCase()
  for (const [needle, key] of Object.entries(ROW_KEY_BY_DESC)) {
    if (lower.includes(needle)) return key
  }
  // a tabela usa o NOME do guard em \`backticks\`, sem o prefixo scripts/
  const m = desc.match(SCRIPT_RE) ?? desc.match(BARE_SCRIPT_RE)
  if (!m) return null
  // só a variante --staged cria chave distinta (ex.: check-bun-mirror.mjs
  // vs check-bun-mirror.mjs --staged); flags de execução (--ci, --dry-run,
  // --check) NÃO fazem parte da chave
  return desc.includes("--staged") ? `${m[1]} --staged` : m[1]
}

/**
 * Compara os guards reais dos hooks com a tabela do README.
 *
 * @param {{ preCommit: string[], prePush: string[], shared: string[] }} actual
 * @param {Map<string, {desc: string, preCommit: boolean, prePush: boolean}>} rows
 * @returns {string[]} violações (vazio = sincronizado)
 */
export function checkSymmetry(actual, rows) {
  const violations = []

  const expect = (key, hook) => {
    const row = rows.get(key)
    if (!row) {
      violations.push(
        `guard '${key}' invocado em ${hook} SEM linha na tabela '## Git Hooks' do README — adicione a linha com ✅ na coluna ${hook}`,
      )
      return
    }
    if (hook === "pre-commit" && !row.preCommit) {
      violations.push(
        `guard '${key}' roda no pre-commit mas a tabela marca '—' — atualize a coluna Pre-commit`,
      )
    }
    if (hook === "pre-push" && !row.prePush) {
      violations.push(
        `guard '${key}' roda no pre-push mas a tabela marca '—' — atualize a coluna Pre-push`,
      )
    }
  }

  for (const key of actual.shared) expect(key, "pre-commit")
  for (const key of actual.shared) expect(key, "pre-push")
  for (const key of actual.preCommit) expect(key, "pre-commit")
  for (const key of actual.prePush) expect(key, "pre-push")

  return violations
}

function main() {
  const cwd = process.cwd()
  const readmePath = join(cwd, "README.md")
  const preCommitPath = join(cwd, ".husky", "pre-commit")
  const prePushPath = join(cwd, ".husky", "pre-push")
  const runnerPath = join(cwd, "scripts", "run-encoding-guards.sh")

  for (const [label, p] of [
    ["README", readmePath],
    [".husky/pre-commit", preCommitPath],
    [".husky/pre-push", prePushPath],
    ["run-encoding-guards.sh", runnerPath],
  ]) {
    if (!existsSync(p)) {
      console.error(`❌ ${label} ausente: ${p}`)
      process.exit(2)
    }
  }

  const preCommit = extractHookGuards(readFileSync(preCommitPath, "utf8"))
  const prePush = extractHookGuards(readFileSync(prePushPath, "utf8"))
  const shared = extractRunnerGuards(readFileSync(runnerPath, "utf8"))

  let rows
  try {
    rows = extractReadmeRows(readFileSync(readmePath, "utf8"))
  } catch (e) {
    console.error(`❌ ${e.message}`)
    process.exit(2)
  }

  const violations = checkSymmetry(
    {
      preCommit: [...preCommit.keys()],
      prePush: [...prePush.keys()],
      shared,
    },
    rows,
  )

  if (violations.length > 0) {
    console.error(
      `❌ Tabela '## Git Hooks' do README dessincronizada dos hooks reais (${violations.length}):\n`,
    )
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Adicionar um guard novo a .husky/pre-commit ou pre-push exige a linha` +
        `\n   correspondente na tabela '## Git Hooks' do README — é a doc que` +
        `\n   previne o drift de simetria entre os hooks.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Tabela '## Git Hooks' sincronizada com os hooks reais (${shared.length} compartilhados).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
