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
// A validação é BIDIRECIONAL:
//   → (forward)  guard real dos hooks SEM a linha correspondente na tabela =
//                drift de doc (guard novo não documentado) — exit 1.
//   ← (reverse)  linha da tabela SEM guard real invocado por NENHUM hook =
//                linha STALE (guard removido dos hooks, linha esquecida) —
//                exit 1. Linhas DESCRITIVAS (sem chave de script, ex.:
//                'Snapshots (cond.)') são exceções documentadas em
//                DESCRIPTIVE_ROW_EXCEPTIONS — cada exceção carrega uma
//                ÂNCORA de hook que DEVE existir nos hooks (se o bloco
//                documentado sumir, a linha vira stale e falha).
//
// Usage:
//   node scripts/check-hooks-symmetry.mjs       # check; exit 1 on drift
//
// Exit codes:
//   0 — tabela sincronizada com os hooks (pass)
//   1 — guard sem linha na tabela OU linha da tabela sem guard real
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

/**
 * Preixo de chave SINTÉTICA para linhas DESCRITIVAS da tabela — linhas que
 * documentam blocos dos hooks que NÃO são um guard `scripts/X` nem um
 * comando mapeado (ex.: 'Snapshots (quando .snap/snapshot tests alterados)',
 * que é um bloco condicional inline do pre-commit). A reverse exige que toda
 * linha descritiva esteja documentada em DESCRIPTIVE_ROW_EXCEPTIONS — se a
 * exceção sumir (ou a âncora de hook sumir), a linha vira stale e falha.
 */
const DESCRIPTIVE_KEY_PREFIX = "@desc:"

/**
 * Exceções DOCUMENTADAS para linhas descritivas da tabela — cada uma tem:
 *   - descNeedle:  substring (case-insensitive) da DESCRIÇÃO da linha na
 *                  tabela (ex.: "snapshots" casa 'Snapshots (quando ...)');
 *   - hookAnchor:  substring que DEVE existir em .husky/pre-commit e/ou
 *                  .husky/pre-push (case-sensitive) — a prova de que a linha
 *                  descreve um BLOCO REAL do hook. Se o bloco for removido
 *                  do hook, a âncora some e a linha descritiva vira stale.
 *
 * Regra: adicionar uma linha descritiva nova à tabela = adicionar a exceção
 * AQUI com a âncora do bloco correspondente; remover o bloco do hook =
 * remover a exceção E a linha (o guard falha enquanto a âncora faltar).
 */
export const DESCRIPTIVE_ROW_EXCEPTIONS = [
  {
    // 'Snapshots (cond.)' — bloco condicional inline do pre-commit:
    // STAGED_SNAP=$(git diff --cached ... | grep -E '\.snap$|snapshot...') e
    // só roda `bun test:snapshots` quando há arquivos de snapshot alterados.
    descNeedle: "snapshots",
    hookAnchor: "bun test:snapshots",
  },
]

/** Comandos diretos dos hooks que não são `node|bash scripts/...`. */
const HOOK_KEY_BY_CMD = {
  "bun run typecheck": "typecheck",
  "bun run check:direct-rtl-import": "check-direct-rtl-import",
  "bun run check:no-npx-playwright": "check-no-npx-playwright.mjs",
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
      // Linhas DESCRITIVAS (sem chave de script) entram com chave sintética
      // @desc: — a reverse as valida contra DESCRIPTIVE_ROW_EXCEPTIONS. Sem
      // isso, uma linha descritiva STALE (bloco removido do hook) ficaria
      // invisível para o guard.
      rows.set(key ?? `${DESCRIPTIVE_KEY_PREFIX}${desc}`, {
        desc,
        preCommit: preCommit !== "—",
        prePush: prePush !== "—",
      })
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
/**
 * Validação REVERSA: toda linha da tabela DEVE corresponder a um guard real
 * invocado por algum hook (pre-commit, pre-push ou runner compartilhado) —
 * detecta linhas STALE (guard removido dos hooks mas linha esquecida na
 * tabela). Linhas DESCRITIVAS (chave `@desc:`) são válidas apenas se
 * estiverem em DESCRIPTIVE_ROW_EXCEPTIONS E a âncora de hook existir nos
 * hooks reais.
 *
 * @param {{ preCommit: string[], prePush: string[], shared: string[] }} actual
 * @param {Map<string, {desc: string, preCommit: boolean, prePush: boolean}>} rows
 * @param {string} preCommitContent  conteúdo de .husky/pre-commit (para âncoras)
 * @param {string} prePushContent    conteúdo de .husky/pre-push (para âncoras)
 * @returns {string[]} violações (vazio = sincronizado)
 */
export function checkReverseSymmetry(
  actual,
  rows,
  preCommitContent,
  prePushContent,
  exceptions = DESCRIPTIVE_ROW_EXCEPTIONS,
) {
  const violations = []
  const real = new Set([...actual.shared, ...actual.preCommit, ...actual.prePush])
  const hooksJoined = `${preCommitContent}\n${prePushContent}`

  for (const [key, row] of rows) {
    if (!key.startsWith(DESCRIPTIVE_KEY_PREFIX)) {
      // linha com chave de guard — precisa existir em ALGUM hook real
      if (!real.has(key)) {
        violations.push(
          `linha '${row.desc}' (guard '${key}') sem guard real em NENHUM hook — linha stale (guarde removido ou linha órfã); remova a linha ou re-adicione o guard`,
        )
      }
      continue
    }
    // linha DESCRITIVA — precisa de exceção documentada com âncora real
    const lower = row.desc.toLowerCase()
    const exc = exceptions.find((e) => lower.includes(e.descNeedle.toLowerCase()))
    if (!exc) {
      violations.push(
        `linha descritiva '${row.desc}' sem exceção em DESCRIPTIVE_ROW_EXCEPTIONS — ou é linha stale, ou documente a exceção com a âncora do bloco no hook`,
      )
      continue
    }
    if (!hooksJoined.includes(exc.hookAnchor)) {
      violations.push(
        `linha descritiva '${row.desc}' (exceção '${exc.descNeedle}') com âncora '${exc.hookAnchor}' AUSENTE dos hooks — bloco removido? linha stale`,
      )
    }
  }

  return violations
}

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

  const preCommitContent = readFileSync(preCommitPath, "utf8")
  const prePushContent = readFileSync(prePushPath, "utf8")
  const actual = {
    preCommit: [...preCommit.keys()],
    prePush: [...prePush.keys()],
    shared,
  }

  const violations = [
    // forward: guard real sem linha na tabela
    ...checkSymmetry(actual, rows),
    // reverse: linha da tabela sem guard real (stale) / descritiva sem âncora
    ...checkReverseSymmetry(actual, rows, preCommitContent, prePushContent),
  ]

  if (violations.length > 0) {
    console.error(
      `❌ Tabela '## Git Hooks' do README dessincronizada dos hooks reais (${violations.length}):\n`,
    )
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   A simetria é BIDIRECIONAL: adicionar um guard novo a .husky/pre-commit` +
        `\n   ou pre-push exige a linha correspondente na tabela; e remover um guard` +
        `\n   dos hooks exige remover a linha (linha órfã = stale, falha o CI).` +
        `\n   Linhas descritivas (ex.: Snapshots) exigem exceção com âncora em` +
        `\n   DESCRIPTIVE_ROW_EXCEPTIONS.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Tabela '## Git Hooks' sincronizada com os hooks reais (${shared.length} compartilhados + reverse ok).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
