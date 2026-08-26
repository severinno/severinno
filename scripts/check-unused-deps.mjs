#!/usr/bin/env node
// =============================================================================
// check-unused-deps.mjs — Guard de DEPENDÊNCIAS NÃO UTILIZADAS
// =============================================================================
//
// Usage:
//   node scripts/check-unused-deps.mjs                    # scan completo (default)
//   node scripts/check-unused-deps.mjs --root X           # fixture (testes/mutation)
//   node scripts/check-unused-deps.mjs --json             # output JSON estruturado
//   node scripts/check-unused-deps.mjs --staged           # só as deps NOVAS do diff --cached (pre-commit)
//   node scripts/check-unused-deps.mjs --staged --root X  # staged num repo git do fixture
//
// Exit codes:
//   0 — todas as deps têm referência OU são allowlist (pass)
//   1 — pelo menos uma dep órfã (fail — a mensagem lista cada uma)
//   2 — infra: package.json ausente/ilegível, root inválido, git indisponível (fail-closed)
//
// MODO --staged (pre-commit): verifica APENAS as deps ADICIONADAS ao
// package.json no `git diff --cached` (o que o commit introduz) — o scan
// completo é ~850ms (1057 arquivos, 97 deps — medido 08/2026) e o pre-commit
// não o roda por isso; o --staged custa ~150-500ms (1-2 `git grep --cached`
// por dep nova, ~250ms cada). Para cada dep nova não-allowlist, procura a
// referência no ÍNDICE (git grep --cached — o que será commitado, NÃO o
// working tree: um import em arquivo não-staged NÃO conta, o commit não o
// carrega) e falha (exit 1) se ZERO hits — a dep seria órfã no merge.
// Espelho do check-bun-mirror --staged: pega o erro ANTES do guard global
// (CI), no commit local, com custo proporcional ao diff.
//
// Sem diff staged do package.json → exit 0 imediato (~150ms de `git diff
// --cached --name-only`): o pre-commit roda o guard TODO commit, e o caso
// comum (commit sem mexer em deps) não pode pagar o scan completo.
//
// Escaneia TODO o código do repo (src/, scripts/, e2e/, mini-services/,
// configs, workflows, hooks, Dockerfiles) procurando referências a CADA dep
// de package.json (dependencies + devDependencies). Falha (exit 1) quando uma
// dep tem ZERO referências — o item #4 da auditoria: 5 deps órfãs reais
// (08/2026): next-intl, react-markdown, @mdxeditor/editor, @tanstack/react-table,
// zod-to-openapi — verificadas com ZERO hits em código/config/scripts. A
// auditoria recomendou reduzir lockfile (439KB) + superfície de ataque +
// tempo de install.
//
// Por que scan por CONTEÚDO e não por import parse: o repo tem uma mistura
// de TS/TSX/MJS/SH/YML/JSON — imports, requires, bunx/npx CLIs em workflows,
// referências em configs (next.config, tailwind.config, postcss), hooks do
// husky e Dockerfiles. Um parse de imports perderia CLIs e configs; o regex
// por nome-de-pacote cobre todos os contextos com uma heurística simples.
// Falsos positivos (nome de dep como substring) são evitados com boundary
// de palavra em ambos os lados.
//
// ALLOWLIST (uso IMPLÍCITO — dep presente mas nunca referenciada em código):
//   - @types/*      — tipos TypeScript implícitos (tsconfig types); nunca
//                     aparecem como import
//   - bun-types     — tipos do runtime Bun (bun test / bunx); resolvido via
//                     tsconfig, não importado
//   - @vitest/coverage-v8 — provider de coverage do vitest (provider: "v8"
//                     na config — o NOME do pacote nunca aparece no código)
//   - sharp         — uso IMPLÍCITO do Next.js image optimization: o Next
//                     usa sharp automaticamente quando instalado (sem
//                     import). REMOVER quebraria otimização de imagem em
//                     produção. (A auditoria listou sharp como candidata,
//                     mas com nota "validar antes de remover" — validado:
//                     é dependência de runtime do Next, NÃO órfã.)
//   - husky         — CLI de hooks via package.json "prepare": "husky" e
//                     .husky/* (o guard de hooks check-seed-hooks cobre a
//                     simetria; a ref ao binário está só no package.json)
//   - lint-staged   — CLI via .husky/pre-commit "bunx lint-staged"
//   - prisma        — CLI via "prisma" nos scripts (generate/migrate) e
//                     prisma.config.ts (o schema .prisma não referencia o
//                     pacote npm; o runtime é @prisma/client, que É importado)
//   - @opentelemetry/* — SDK de telemetria (tracer, exporter, resources):
//                     usado via config de telemetria em runtime (não
//                     importado diretamente em código de produção;
//                     habilitado/desabilitado via env vars)
//
// (allowlist final: @types/*, bun-types, @vitest/coverage-v8, sharp, husky,
// lint-staged, prisma, @opentelemetry/* — documentadas com o PORQUÊ acima.)
//
// O guard tem --update? NÃO — diferente dos guards de baseline (secrets,
// jsdom, bun-audit), aqui a política é ZERO órfãs: adicionou dep, use-a ou
// remova-a. Não existe "baseline de órfãs" — o objetivo é ENCOLHER o lockfile.
// NOTA: este arquivo (o próprio guard) é auto-excluído do scan — ele
// documenta os nomes das órfãs no header e não pode contar como referência.
//
// LIMITAÇÕES documentadas:
//   - Prefix-substring: uma dep cujo nome é PREFIXO de outra (ex.: "xstate"
//     vs "@xstate/react", "prisma" vs "@prisma/client") é considerada usada
//     se a OUTRA for referenciada (o boundary permite "/"). Sem impacto no
//     repo atual, mas uma dep curta órfã ao lado de uma longa usada passaria
//     — se isso ocorrer, allowlist da curta ou refine o boundary.
//   - Arquivos ignorados por prefixo: _ (temp), dev.*, run-*, start-*,
//     supervisor* são pulados — uma dep referenciada SÓ em run-server.sh/
//     start-server.sh/dev.ps1 seria falso-positivo (scripts de dev, fora do
//     escopo de código de produção).
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** O próprio arquivo do guard — auto-excluído do scan (documenta órfãs no header). */
const SELF = fileURLToPath(import.meta.url)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Allowlist de uso implícito — deps que NUNCA aparecem como import/ref em
 * código mas são NECESSÁRIAS. Cada entrada documenta o porquê (ver header).
 * Prefixos: "prefix:" casa o início do nome (ex.: "@types/" cobre todos).
 */
export const ALLOWLIST = [
  { match: "@types/", type: "prefix", why: "tipos TypeScript implícitos (tsconfig types)" },
  { match: "bun-types", type: "exact", why: "tipos do runtime Bun via tsconfig (não importado)" },
  {
    match: "@vitest/coverage-v8",
    type: "exact",
    why: 'provider de coverage do vitest (config "v8" — nome nunca no código)',
  },
  {
    match: "sharp",
    type: "exact",
    why: "uso implícito do Next.js image optimization (runtime, sem import)",
  },
  { match: "husky", type: "exact", why: "CLI de hooks via package.json prepare + .husky/*" },
  { match: "lint-staged", type: "exact", why: "CLI via .husky/pre-commit bunx lint-staged" },
  { match: "prisma", type: "exact", why: "CLI via scripts (generate/migrate) + prisma.config.ts" },
  {
    match: "@opentelemetry/",
    type: "prefix",
    why: "OpenTelemetry SDK packages — used via telemetry config at runtime",
  },
]

/**
 * Extensões de código escaneadas. Propositalmente NÃO inclui: .md (prosa
 * pode citar libs sem usar), .json fora de configs explícitas (lockfiles,
 * bundle manifests), .snap. Configs JSON nomeadas são escaneadas via
 * FILE_PATTERNS abaixo.
 */
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".sh",
  ".yml",
  ".yaml",
  ".css",
  ".prisma",
])

/** Arquivos temp/meta (prefixo _) — nunca código-fonte real. */
const IGNORE_PREFIX = ["_", ".tmp", "dev.", "run-", "keep-", "start-", "supervisor"]

/** Arquivos JSON específicos que contêm refs de deps (configs, não dados). */
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

/** Nomes de arquivo (qualquer dir) que são configs de código — escaneados. */
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

/** Arquivos/dirs SEMPRE excluídos do scan (não-código ou gerado). */
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

/** Nomes de arquivo sempre ignorados (não-código). */
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

/**
 * Coleta os arquivos de código do root (recursivo). Pula dirs/arquivos
 * ignorados; inclui configs JSON explícitas e configs de código por nome.
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
      // self-exclusion: o próprio guard documenta órfãs no header e não pode
      // contar como referência (scripts/check-unused-deps.mjs)
      if (full === SELF) continue
      const ext = "." + (e.name.includes(".") ? e.name.split(".").pop() : "")
      if (CODE_EXTENSIONS.has(ext)) {
        out.push(rel)
        continue
      }
      if (JSON_CONFIG_FILES.has(e.name) || CODE_FILE_NAMES.has(e.name)) {
        out.push(rel)
        continue
      }
      // Arquivos SEM extensão que são código/CLI: Dockerfile* (RUN bunx/npx
      // instala CLIs de deps) e .husky/* (hooks rodam bunx lint-staged etc.)
      // — sem isso, uma dep referenciada SÓ lá viraria falso-positivo.
      if (e.name.startsWith("Dockerfile") || rel.startsWith(".husky/")) out.push(rel)
    }
  }
  walk(root)
  return out.sort()
}

/**
 * Verifica se uma dep é allowlist (uso implícito).
 *
 * @param {string} dep
 * @returns {{allowed: boolean, why?: string}}
 */
export function isAllowlisted(dep) {
  for (const a of ALLOWLIST) {
    if (a.type === "prefix" && dep.startsWith(a.match)) return { allowed: true, why: a.why }
    if (a.type === "exact" && dep === a.match) return { allowed: true, why: a.why }
  }
  return { allowed: false }
}

/**
 * Escapa um nome de pacote para regex e monta o padrão de busca com boundary
 * de palavra em ambos os lados. O boundary \b funciona com @ e / porque a
 * transição de um caractere \w (letra/dígito/_ ) para @ ou / NÃO é \b — por
 * isso o padrão ancora por delimitadores explícitos: o nome deve ser
 * precedido por início/whitespace/aspas/parenteses (não por \w) e seguido por
 * fim/whitespace/aspas/slash/etc. (não por \w) — cobrindo imports, requires,
 * bunx/npx, configs, Dockerfile RUN e subpaths.
 *
 * @param {string} dep
 * @returns {RegExp}
 */
export function depPattern(dep) {
  const esc = dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // boundary [^\\w-] em ambos os lados: exclui o hífen para NÃO casar o
  // prefixo de outra dep (ex.: "next" dentro de "next-intl", "react"
  // dentro de "react-dom"). Hífens DENTRO do nome do pacote são cobertos
  // porque o padrão casa o nome COMPLETO da dep.
  return new RegExp(`(^|[^\\w-])${esc}([^\\w-]|$)`)
}

/**
 * Lê e valida o package.json do root.
 *
 * @param {string} root
 * @returns {{deps: string[], scriptsText: string}}
 */
export function readPackageDeps(root) {
  const pkgPath = join(root, "package.json")
  if (!existsSync(pkgPath)) {
    throw new Error("package.json ausente no root — rode o guard na raiz do repo")
  }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  } catch (e) {
    throw new Error(`package.json ilegível: ${e.message}`)
  }
  const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  // O próprio package.json É escaneado (JSON_CONFIG_FILES) — os scripts
  // contêm CLIs (bunx X, bun run X). Os campos dependencies/devDependencies
  // NÃO contam como referência (auto-ref) — por isso removemos do conteúdo.
  const scriptsText = Object.values(pkg.scripts ?? {}).join("\n")
  return { deps, scriptsText }
}

/**
 * Computa as deps órfãs: sem referência em nenhum arquivo de código do root
 * (nem nos scripts do package.json) e não-allowlist.
 *
 * @param {string} root
 * @returns {{orphans: Array<{dep: string}>, scanned: number, total: number}}
 */
export function findOrphanDeps(root) {
  const { deps, scriptsText } = readPackageDeps(root)
  const files = collectCodeFiles(root)
  const contents = new Map()
  for (const f of files) {
    try {
      // package.json: remove as linhas de deps (auto-ref) mas mantém scripts
      if (f === "package.json") {
        const raw = readFileSync(join(root, f), "utf8")
        const lines = raw.split("\n").filter((l) => {
          const t = l.trim()
          return !t.includes('":') || t.startsWith('"scripts"')
        })
        contents.set(f, lines.join("\n"))
      } else {
        contents.set(f, readFileSync(join(root, f), "utf8"))
      }
    } catch {
      /* arquivo ilegível — ignora */
    }
  }
  // scripts do package.json contam como conteúdo (CLIs)
  const searchTexts = [...contents.values(), scriptsText]

  const orphans = []
  for (const dep of deps) {
    const { allowed } = isAllowlisted(dep)
    if (allowed) continue
    const re = depPattern(dep)
    const hit = searchTexts.some((t) => re.test(t))
    if (!hit) orphans.push({ dep })
  }
  return { orphans, scanned: files.length, total: deps.length }
}

// ---------------------------------------------------------------------------
// MODO --staged (pre-commit): deps NOVAS do git diff --cached
// ---------------------------------------------------------------------------

/**
 * Converte o nome de uma dep para o padrão ERE do `git grep` com o MESMO
 * boundary do depPattern JS: `[^\w-]` vira `[^[:alnum:]_\-]` (POSIX ERE —
 * o `\w` não existe em ERE). O hífen é excluído para não casar o prefixo de
 * outra dep (ex.: "next" dentro de "next-intl") — o nome completo casa.
 *
 * @param {string} dep
 * @returns {string}
 */
export function depERE(dep) {
  const esc = dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return `(^|[^[:alnum:]_\\-])${esc}([^[:alnum:]_\\-]|$)`
}

/**
 * Verifica se um path relativo seria ESCANEADO pelo scan completo — espelho
 * da lógica de exclusão do collectCodeFiles (dirs ALWAYS_IGNORE em qualquer
 * nível, lockfiles/temp IGNORE_PREFIX, ext/config/Dockerfile/.husky). Usado
 * para filtrar os hits do `git grep --cached` no modo --staged: uma dep
 * referenciada SÓ em docs/ ou num lockfile NÃO conta (igual ao scan global).
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function isScannedPath(rel) {
  const segs = rel.split("/")
  for (const s of segs) {
    if (ALWAYS_IGNORE.has(s)) return false
  }
  const name = segs[segs.length - 1]
  if (ALWAYS_IGNORE_FILES.has(name)) return false
  if (IGNORE_PREFIX.some((p) => name.startsWith(p))) return false
  const ext = "." + (name.includes(".") ? name.split(".").pop() : "")
  if (CODE_EXTENSIONS.has(ext)) return true
  if (JSON_CONFIG_FILES.has(name) || CODE_FILE_NAMES.has(name)) return true
  if (name.startsWith("Dockerfile") || rel.startsWith(".husky/")) return true
  return false
}

/**
 * Roda `git` no root com spawnSync (array de args, SEM shell).
 *
 * @param {string} root
 * @param {string[]} args
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runGit(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

/**
 * Extrai as keys de deps de um texto de package.json (dependencies +
 * devDependencies).
 *
 * @param {string} text
 * @returns {string[]}
 */
function pkgDepsKeys(text) {
  try {
    const pkg = JSON.parse(text)
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  } catch {
    return []
  }
}

/**
 * Encontra as deps órfãs INTRODUZIDAS pelo commit (modo --staged): compara
 * as deps do ÍNDICE (`git show :package.json` — o que será commitado) com as
 * do HEAD; para cada dep ADICIONADA (não-allowlist), procura a referência no
 * índice via `git grep --cached` (1 chamada por dep, ~250ms) filtrada pelos
 * MESMOS critérios do scan global (isScannedPath + self-exclusão) e nos
 * scripts do package.json do índice (CLIs — o grep exclui o package.json
 * para não contar o campo deps como auto-ref).
 *
 * @param {string} root
 * @returns {{added: string[], orphans: Array<{dep: string}>, total: number}}
 */
export function findOrphanDepsStaged(root) {
  // Fast path: sem package.json no diff --cached → nada a verificar (~150ms).
  const nameRes = runGit(root, ["diff", "--cached", "--name-only", "--", "package.json"])
  if (nameRes.status !== 0) {
    throw new Error("git diff --cached indisponível — repo git? (staged precisa do índice)")
  }
  if (!nameRes.stdout.trim()) {
    return { added: [], orphans: [], total: 0 }
  }

  // Deps do índice (o que será commitado) vs HEAD (estado anterior).
  const idxRes = runGit(root, ["show", ":package.json"])
  if (idxRes.status !== 0) {
    throw new Error("package.json ausente no índice — staged precisa dele commitado")
  }
  const headRes = runGit(root, ["show", "HEAD:package.json"])
  const idxDeps = pkgDepsKeys(idxRes.stdout)
  const headDeps = headRes.status === 0 ? pkgDepsKeys(headRes.stdout) : []
  const added = idxDeps.filter((d) => !headDeps.includes(d))
  if (added.length === 0) return { added: [], orphans: [], total: idxDeps.length }

  // Scripts do package.json do índice (CLIs contam como ref — igual ao global).
  let scriptsText = ""
  try {
    const pkg = JSON.parse(idxRes.stdout)
    scriptsText = Object.values(pkg.scripts ?? {}).join("\n")
  } catch {
    /* índice ilegível — sem scripts */
  }
  const selfRel = relative(root, SELF).split("\\").join("/")

  const orphans = []
  for (const dep of added) {
    const { allowed } = isAllowlisted(dep)
    if (allowed) continue
    // grep no ÍNDICE (o que o commit carrega) — package.json excluído para
    // não contar o campo deps como auto-ref (scripts cobertos acima).
    const ere = depERE(dep)
    const grepRes = runGit(root, [
      "grep",
      "--cached",
      "-l",
      "-I",
      "-E",
      ere,
      "--",
      ":(exclude)package.json",
    ])
    // git grep: 0 = achou, 1 = sem hits; QUALQUER outro status (ex.: 128,
    // erro fatal do git) é INFRA — fail-closed (exit 2), não falso órfão.
    if (grepRes.status !== 0 && grepRes.status !== 1) {
      throw new Error(
        `git grep --cached falhou para a dep ${dep} (status ${grepRes.status}): ${grepRes.stderr.trim()}`,
      )
    }
    const hit =
      grepRes.status === 0 &&
      grepRes.stdout
        .split("\n")
        .filter(Boolean)
        .some((f) => isScannedPath(f) && f !== selfRel)
    if (!hit && depPattern(dep).test(scriptsText)) continue
    if (!hit) orphans.push({ dep })
  }
  return { added, orphans, total: idxDeps.length }
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const staged = args.includes("--staged")
  const rootIdx = args.indexOf("--root")
  if (rootIdx !== -1 && args[rootIdx + 1] === undefined) {
    console.error("check-unused-deps: --root requer um path")
    process.exit(2)
  }
  const root = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd()

  if (!existsSync(join(root, "package.json"))) {
    console.error(`❌ check-unused-deps: package.json ausente em ${root}`)
    console.error("   Rode na raiz do repo (ou passe --root <dir>).")
    process.exit(2)
  }

  if (staged) {
    mainStaged(root, json)
    return
  }

  let result
  try {
    result = findOrphanDeps(root)
  } catch (e) {
    console.error(`❌ check-unused-deps: ${e.message}`)
    process.exit(2)
  }

  const { orphans, scanned, total } = result

  if (json) {
    console.log(
      JSON.stringify(
        {
          mode: "full",
          total,
          scanned,
          orphanCount: orphans.length,
          orphans: orphans.map((o) => o.dep),
        },
        null,
        2,
      ),
    )
    process.exit(orphans.length > 0 ? 1 : 0)
  }

  if (orphans.length === 0) {
    console.log(
      `✅ check-unused-deps: ${total} deps — todas com referência no código (${scanned} arquivos escaneados).`,
    )
    process.exit(0)
  }

  console.error(
    `🔍 check-unused-deps: ${orphans.length} dep(s) de package.json SEM nenhuma referência no código:\n`,
  )
  for (const o of orphans) {
    console.error(`   • ${o.dep}`)
  }
  console.error(
    `\n   Use a dep em código (import/require/CLI) ou REMOVA-A do package.json.\n` +
      `   Deps de uso implícito vão na ALLOWLIST (header do script) — ex.: sharp\n` +
      `   (Next image optimization), @types/* (tipos), husky/lint-staged (CLIs).\n`,
  )
  process.exit(1)
}

/**
 * Modo --staged: valida só as deps novas do diff --cached (pre-commit).
 *
 * @param {string} root
 * @param {boolean} json
 */
function mainStaged(root, json) {
  let result
  try {
    result = findOrphanDepsStaged(root)
  } catch (e) {
    console.error(`❌ check-unused-deps --staged: ${e.message}`)
    process.exit(2)
  }

  const { added, orphans, total } = result

  if (json) {
    console.log(
      JSON.stringify(
        {
          mode: "staged",
          added,
          total,
          orphanCount: orphans.length,
          orphans: orphans.map((o) => o.dep),
        },
        null,
        2,
      ),
    )
    process.exit(orphans.length > 0 ? 1 : 0)
  }

  if (orphans.length === 0) {
    if (added.length === 0) {
      console.log("✅ check-unused-deps --staged: nenhuma dep adicionada no diff --cached — ok.")
    } else {
      console.log(
        `✅ check-unused-deps --staged: ${added.length} dep(s) nova(s) no diff — todas com referência no índice (${total} deps).`,
      )
    }
    process.exit(0)
  }

  console.error(
    `🔍 check-unused-deps --staged: ${orphans.length} dep(s) ADICIONADA(s) no diff --cached SEM referência no que será commitado:\n`,
  )
  for (const o of orphans) {
    console.error(`   • ${o.dep}`)
  }
  console.error(
    `\n   A dep entra no package.json pelo commit mas NENHUM arquivo do índice a
   usa — o merge teria uma órfã. Use-a (import/require/CLI) ou REMOVA-A.\n` +
      `   Se o import está em arquivo AINDA NÃO stageado: git add <arquivo>\n` +
      `   (o --staged lê o ÍNDICE, não o working tree).\n`,
  )
  process.exit(1)
}

// True apenas quando executado diretamente — permite importar as funções
// puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
