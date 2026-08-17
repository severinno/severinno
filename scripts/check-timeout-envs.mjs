#!/usr/bin/env node

// =============================================================================
// check-timeout-envs.mjs
//
// CI guard (node-puro, <1s) de CONSISTÊNCIA da documentação das envs de
// timeout: todo `*_TIMEOUT_MS` consumido em src/ (via envTimeoutSignal /
// resolveTimeoutMs, ou constantes `X_ENV`/`X_DEFAULT_MS` como o par
// GLOBAL_FETCH_TIMEOUT_MS do fetch-timeout.ts) DEVE estar documentado com o
// MESMO default (ms) em TRÊS lugares: README (tabela "Fetch timeouts"),
// .env.example e os composes (docker-compose.yml + prod, serviço `app`).
//
// Usage:
//   node scripts/check-timeout-envs.mjs [--root DIR]
//     --root  diretório a varrer (default: cwd) — usado nos testes de fixture
//
// Exit codes:
//   0 — pass (toda env de timeout documentada e consistente nas 3 docs)
//   1 — violações encontradas (lista env + doc + valor divergente)
//   2 — flag desconhecida
//
// Por que: as 4 envs de clientes externos (LYTEX_TIMEOUT_MS,
// EVOLUTION_TIMEOUT_MS, GLITCHTIP_TIMEOUT_MS, ALERT_WEBHOOK_TIMEOUT_MS)
// existiam no código com default válido mas estavam INVISÍVEIS na doc —
// operação não sabia que dava para tunar o timeout, e o default documentado
// podia driftar do código. Este guard DERIVA as envs do código (fonte da
// verdade) e exige o par env+default nas 3 docs — fechando a classe por
// regressão: uma env de timeout nova em src/ sem doc (ou com default
// divergente) falha o PR.
//
// Derivação:
//   - `envTimeoutSignal("X", N)` e `resolveTimeoutMs("X", N)` com literal de
//     string + literal numérico em src/ (testes excluídos; comentários
//     blanked via blankComments — menção em prosa não conta).
//   - Pares `X_ENV = "ENV"` + `X_DEFAULT_MS = N` (GLOBAL_FETCH_TIMEOUT_MS é
//     passado via constantes no call site do piso global; o pareamento exige
//     relação EXATA: envName === prefix OU envName === prefix + "_MS" — um
//     FOO_DEFAULT_MS nunca pareia com um FOO_BAR_TIMEOUT_MS_ENV).
//   - Filtro: só envs com sufixo `_TIMEOUT_MS` (PRISMA_CONNECT_TIMEOUT_SEC
//     etc. ficam fora por escopo — alinhado à seção do README).
//
// Validação (bidirecional):
//   → (forward)  env de src/ SEM linha no README/.env.example/compose, OU com
//                default DIVERGENTE (doc Xs vs código Nms), OU com defaults
//                INCONSISTENTES dentro do próprio src/ (2+ valores).
//   ← (reverse)  env documentada na tabela do README sem uso real em src/ =
//                linha STALE (doc promete tunabilidade que não existe).
//
// Limites conhecidos (trade-off de escopo):
//   - Compose checado por PRESENÇA + default em qualquer serviço do arquivo
//     (regex global), não pelo bloco do serviço `app`.
//   - CONTRATO DE FORMATO: a linha da tabela do README DEVE usar backticks
//     (| `ENV` | 15s | ...) — linha sem backtick é ignorada e vira falso
//     "SEM linha" (fails-safe: o guard falha e o dev corrige).
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Escopo: envs de timeout — sufixo `_TIMEOUT_MS`. */
const TIMEOUT_ENV_RE = /_TIMEOUT_MS$/
/** Chamada com ENV literal + fallback numérico. */
const CALL_WITH_LITERAL_RE =
  /(?:envTimeoutSignal|resolveTimeoutMs)\(\s*"([A-Z0-9_]+)"\s*,\s*([\d_]+)\s*\)/g
/** Constantes `X_ENV = "ENV"`. */
const ENV_CONST_RE = /\b([A-Z0-9_]+_ENV)\s*=\s*"([A-Z0-9_]+)"/g
/** Constantes `X_DEFAULT_MS = N`. */
const DEFAULT_MS_CONST_RE = /\b([A-Z0-9_]+_DEFAULT_MS)\s*=\s*([\d_]+)/g
/** Linha de tabela do README: `| \`ENV\` | default | ... |`. */
const README_ROW_RE = /^\|\s*`([A-Z0-9_]+)`\s*\|\s*([^|]+?)\s*\|/
/** Linha de environment do compose: `ENV: ${ENV:-NNNN}` ou `ENV: NNNN`. */
const COMPOSE_ROW_RE = /^([A-Z0-9_]+_TIMEOUT_MS):\s*(?:\$\{[A-Z0-9_]*:\s*-?\s*(\d+)\s*\}|\s*(\d+))/
/** Linha do .env.example: `ENV=NNNN`. */
const ENV_EXAMPLE_ROW_RE = /^([A-Z0-9_]+_TIMEOUT_MS)\s*=\s*(\d+)/

/** Arquivos de teste NÃO são varridos (mocks não representam env real). */
function isTestFile(rel) {
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel) ||
    rel.includes("__tests__") ||
    rel.endsWith("vi-test.spec.ts")
  )
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
 * Apaga comentários (/* *\/ e //) PRESERVANDO strings — o env das chamadas
 * reais vive DENTRO de string literal, então strings não podem ser blanked
 * (diferente do check-fetch-timeout, que procura `fetch(` e pode blankar
 * tudo). Menção em prosa/JSDoc (ex.: o docstring do fetch-timeout.ts citando
 * `envTimeoutSignal("LYTEX_TIMEOUT_MS", 10_000)`) NÃO conta como uso real.
 */
export function blankComments(code) {
  let out = ""
  let i = 0
  let inBlock = false
  let quote = null
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (inBlock) {
      if (ch === "*" && next === "/") {
        out += "  "
        inBlock = false
        i += 2
      } else {
        out += " "
        i++
      }
      continue
    }
    if (quote) {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      out += "  "
      i += 2
      continue
    }
    if (ch === "/" && next === "/") {
      out += "  "
      i += 2
      while (i < code.length && code[i] !== "\n") {
        out += " "
        i++
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Deriva as envs de timeout usadas em src/ (com o default em ms de cada call
 * site). A fonte da verdade é o CÓDIGO — nada de lista hardcoded aqui.
 *
 * @param {string} root  diretório raiz (repo ou fixture)
 * @returns {Map<string, Set<number>>} env → set de defaults (ms) dos call sites
 */
export function collectCodeTimeoutEnvs(root) {
  const envs = new Map()
  const srcDir = join(root, "src")
  if (!statSync(srcDir).isDirectory()) return envs

  for (const { rel, abs } of listTsFiles(srcDir, root)) {
    if (isTestFile(rel)) continue
    const code = blankComments(readFileSync(abs, "utf8"))

    let m
    CALL_WITH_LITERAL_RE.lastIndex = 0
    while ((m = CALL_WITH_LITERAL_RE.exec(code)) !== null) {
      if (!TIMEOUT_ENV_RE.test(m[1])) continue
      if (!envs.has(m[1])) envs.set(m[1], new Set())
      envs.get(m[1]).add(Number(m[2].replace(/_/g, "")))
    }

    // Pares de constantes X_ENV / X_DEFAULT_MS (ex.: GLOBAL_FETCH_TIMEOUT_MS).
    // O nome NÃO é simétrico: GLOBAL_FETCH_TIMEOUT_MS_ENV vs
    // GLOBAL_FETCH_TIMEOUT_DEFAULT_MS (o DEFAULT não repete o `_MS` do valor),
    // então o pareamento exige a RELAÇÃO EXATA: envName === prefix OU
    // envName === prefix + "_MS" (o caso real: valor "GLOBAL_FETCH_TIMEOUT_MS"
    // = prefixo "GLOBAL_FETCH_TIMEOUT" + "_MS"). NÃO é startsWith genérico —
    // um FOO_DEFAULT_MS não pode parear com um FOO_BAR_TIMEOUT_MS_ENV.
    const envConsts = []
    const defConsts = []
    let e
    ENV_CONST_RE.lastIndex = 0
    while ((e = ENV_CONST_RE.exec(code)) !== null) envConsts.push(e[2])
    let d
    DEFAULT_MS_CONST_RE.lastIndex = 0
    while ((d = DEFAULT_MS_CONST_RE.exec(code)) !== null) {
      defConsts.push({
        prefix: d[1].replace(/_DEFAULT_MS$/, ""),
        ms: Number(d[2].replace(/_/g, "")),
      })
    }
    for (const envName of envConsts) {
      if (!TIMEOUT_ENV_RE.test(envName)) continue
      for (const { prefix, ms } of defConsts) {
        const paired = envName === prefix || envName === `${prefix}_MS`
        if (!paired) continue
        if (!envs.has(envName)) envs.set(envName, new Set())
        envs.get(envName).add(ms)
      }
    }
  }
  return envs
}

/** Converte default de doc ("15s" → 15000; "3000" → 3000) ou null. */
export function parseDocDefaultMs(text) {
  const t = text.trim()
  const s = t.match(/^(\d+(?:\.\d+)?)\s*s$/)
  if (s) return Math.round(Number(s[1]) * 1000)
  const n = t.match(/^(\d+)$/)
  if (n) return Number(n[1])
  return null
}

/**
 * Extrai as linhas da tabela "Fetch timeouts" do README.
 *
 * @param {string} readmeContent
 * @returns {Map<string, number>} env → default em ms
 */
export function parseReadmeTimeoutRows(readmeContent) {
  const rows = new Map()
  const lines = readmeContent.split(/\r?\n/)
  let inSection = false
  for (const line of lines) {
    const t = line.trim()
    if (!inSection) {
      if (t.startsWith("### Fetch timeouts")) inSection = true
      continue
    }
    // fim da seção: próxima tabela deixa de ser a de timeouts
    if (t.startsWith("### ") && !t.startsWith("### Fetch timeouts")) break
    if (!t.startsWith("|")) continue
    const m = t.match(README_ROW_RE)
    if (!m || !TIMEOUT_ENV_RE.test(m[1])) continue
    const ms = parseDocDefaultMs(m[2])
    if (ms !== null) rows.set(m[1], ms)
  }
  return rows
}

/**
 * Extrai `ENV=NNNN` do .env.example.
 * @returns {Map<string, number>} env → ms
 */
export function parseEnvExampleRows(content) {
  const rows = new Map()
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(ENV_EXAMPLE_ROW_RE)
    if (m) rows.set(m[1], Number(m[2]))
  }
  return rows
}

/**
 * Extrai `ENV: ${ENV:-NNNN}` (ou `ENV: NNNN`) de um compose.
 * @returns {Map<string, number>} env → ms
 */
export function parseComposeTimeoutRows(content) {
  const rows = new Map()
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(COMPOSE_ROW_RE)
    if (!m || !TIMEOUT_ENV_RE.test(m[1])) continue
    const ms = m[2] !== undefined ? Number(m[2]) : Number(m[3])
    if (Number.isFinite(ms)) rows.set(m[1], ms)
  }
  return rows
}

/**
 * Valida a consistência das 3 docs contra o código (forward + reverse).
 *
 * @param {Map<string, Set<number>>} codeEnvs
 * @param {Map<string, number>} readmeRows
 * @param {Map<string, number>} envExampleRows
 * @param {Map<string, number>} composeBase
 * @param {Map<string, number>} composeProd
 * @returns {string[]} violações (vazio = consistente)
 */
export function checkTimeoutEnvs(codeEnvs, readmeRows, envExampleRows, composeBase, composeProd) {
  const violations = []

  for (const [env, defaults] of codeEnvs) {
    if (defaults.size > 1) {
      violations.push(
        `env '${env}' com ${defaults.size} defaults DIFERENTES no código ([${[...defaults].join(", ")}ms]) — padronize o call site`,
      )
    }
    const codeMs = Math.min(...defaults)

    const expectDoc = (label, docMs) => {
      if (docMs === undefined) {
        violations.push(`env '${env}' (default ${codeMs}ms) SEM linha em ${label}`)
      } else if (docMs !== codeMs) {
        violations.push(`env '${env}': default em ${label} = ${docMs}ms ≠ código ${codeMs}ms`)
      }
    }
    expectDoc("README (tabela Fetch timeouts)", readmeRows.get(env))
    expectDoc(".env.example", envExampleRows.get(env))
    expectDoc("docker-compose.yml", composeBase.get(env))
    expectDoc("docker-compose.prod.yml", composeProd.get(env))
  }

  // reverse — linha da tabela do README sem uso real em src/ = stale
  for (const [env] of readmeRows) {
    if (!codeEnvs.has(env)) {
      violations.push(
        `env '${env}' na tabela do README sem uso real em src/ — linha stale (remova ou documente o uso)`,
      )
    }
  }

  return violations
}

/**
 * Roda o guard num root (repo ou fixture). Retorna a lista de violações.
 *
 * @param {string} root
 * @returns {{ violations: string[], files: Record<string, boolean> }}
 */
export function runCheck(root) {
  const codeEnvs = collectCodeTimeoutEnvs(root)

  const readmePath = join(root, "README.md")
  const envExamplePath = join(root, ".env.example")
  const composeBasePath = join(root, "docker-compose.yml")
  const composeProdPath = join(root, "docker-compose.prod.yml")

  const violations = []
  const files = {}

  for (const [label, p] of [
    ["README.md", readmePath],
    [".env.example", envExamplePath],
    ["docker-compose.yml", composeBasePath],
    ["docker-compose.prod.yml", composeProdPath],
  ]) {
    files[label] = existsSync(p)
    if (!existsSync(p)) {
      violations.push(`arquivo '${p}' ausente no root — o guard exige as 3 docs`)
    }
  }
  if (violations.length > 0) return { violations, files }

  const readmeRows = parseReadmeTimeoutRows(readFileSync(readmePath, "utf8"))
  const envExampleRows = parseEnvExampleRows(readFileSync(envExamplePath, "utf8"))
  const composeBase = parseComposeTimeoutRows(readFileSync(composeBasePath, "utf8"))
  const composeProd = parseComposeTimeoutRows(readFileSync(composeProdPath, "utf8"))

  violations.push(
    ...checkTimeoutEnvs(codeEnvs, readmeRows, envExampleRows, composeBase, composeProd),
  )
  return { violations, files }
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

  const { violations } = runCheck(root)

  if (violations.length > 0) {
    console.error(`❌ ${violations.length} violação(ões) de consistência de envs de timeout:\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Todo *_TIMEOUT_MS consumido em src/ deve estar documentado com o mesmo` +
        `\n   default (ms) no README (tabela "Fetch timeouts"), no .env.example e nos` +
        `\n   composes (docker-compose.yml + docker-compose.prod.yml). O guard DERIVA` +
        `\n   as envs do código — a doc não pode driftar do call site.`,
    )
    process.exit(1)
  }

  console.log(`✅ Envs de timeout consistentes nas 3 docs (README + .env.example + composes).`)
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
