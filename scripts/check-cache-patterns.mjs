#!/usr/bin/env node

// =============================================================================
// check-cache-patterns.mjs
//
// Description: CI guard (node-puro, <1s) de CONSISTÊNCIA da lista de cache
//   invalidation do seed (CACHE_PATTERNS em prisma/seed.ts) contra os
//   prefixes reais de withCache/withCachedGeo/cacheInvalidate em src/.
//
//   Um re-seed apaga/recria User/Service/Category/Review/Booking — qualquer
//   cache de catálogo público (services, providers:count, proximity,
//   categories/cat:desc, reviews:recent) fica STALE com IDs antigos até o
//   TTL. O seed invalida os padrões listados em CACHE_PATTERNS ao final;
//   este guard garante que a lista NUNCA deriva do código:
//
//     → (forward)  prefixo real usado em src/ SEM padrão no CACHE_PATTERNS
//                  nem na ALLOWLIST = cache de catálogo ESQUECIDO do
//                  re-seed (a janela de stale volta a existir) — ou um
//                  cache novo que precisa de decisão deliberada.
//     ← (reverse)  padrão do CACHE_PATTERNS SEM nenhum prefixo real em
//                  src/ = padrão ÓRFÃO (lista promete invalidar algo que
//                  não existe mais — typo de prefixo ou cache removido).
//
//   Prefixos NÃO-catálogo (estado de sessão/push/ops, caches de API externa)
//   são deliberadamente excluídos do CACHE_PATTERNS — a ALLOWLIST abaixo é o
//   espelho exato do comentário de exclusões do seed (mantenha em sync).
//
// Usage:
//   node scripts/check-cache-patterns.mjs [--root DIR]
//     --root  diretório a varrer (default: cwd) — usado nos testes de fixture
//
// Exit codes:
//   0 — pass (todo prefixo real classificado; todo padrão do seed com uso)
//   1 — violações encontradas (lista prefixo/padrão + arquivo)
//   2 — flag desconhecida
//
// Derivação (fonte da verdade = CÓDIGO, nunca lista hardcoded):
//   - Padrões: array CACHE_PATTERNS do prisma/seed.ts (parse do literal;
//     aceita `]` em qualquer posição — array multilinha ou de uma linha).
//   - Prefixos reais: em arquivos cache-capable de src/ (contêm
//     withCache|withCachedGeo|cacheInvalidate|CacheKey, testes excluídos),
//     extraídos de (a) primeiro argumento literal (string ou template) dos
//     call sites withCache/withCachedGeo/cacheInvalidate e (b) templates
//     com shape de chave Redis (`word:...${`) dos builders (ex.:
//     radiusCountCacheKey → `providers:count:...`, proximityCacheKey →
//     `proximity:...`). A parte estática antes do primeiro `${` é o prefixo;
//     literal ESTÁTICO (sem `${` — ex.: `reviews:recent:5`) vira o prefixo
//     guloso `word(:word)*:` via normalizeKeyLiteral; chave completa com
//     tail alfabético (ex.: `postgis:available`) é mantida inteira (casa a
//     ALLOWLIST exatamente).
//
// Escopo e trade-offs:
//   - `push:payload:*`/`cron:cooldown:*`/`geo:metrics:*` usam redis cru
//     (setex/KEYS), não withCache — nunca aparecem na varredura e estão na
//     ALLOWLIST por documentação (se um dia migrarem para withCache, o
//     guard passa a classificá-los corretamente).
//   - Chaves passadas por VARIÁVEL (ex.: SNAPSHOTS_CACHE_KEY) não são
//     rastreadas até o literal — cobertas pela ALLOWLIST/`geo:*` quando
//     aplicável.
//   - SHADOWING deliberado do startsWith: `geo:` (e `distance:`) na
//     ALLOWLIST cobre QUALQUER prefixo que comece com ele — um cache de
//     catálogo futuro sob `geo:*` passaria silenciosamente. Alinhado ao
//     comentário do seed (geo é API externa por design); se um dia existir
//     catálogo geo, remova `geo:` da ALLOWLIST e enumere os padrões reais.
//   - stripComments é cópia local do blankComments do check-timeout-envs.mjs
//     (convenção de guards auto-contidos — mantenha em sync ao corrigir
//     edge case de escape).
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Prefixos DELIBERADAMENTE não invalidados no re-seed (estado de
 * sessão/push/ops + caches de API externa + flag de capacidade). Espelho do
 * comentário "Excluídos de propósito" do prisma/seed.ts — qualquer prefixo
 * real de src/ precisa caber no CACHE_PATTERNS OU nesta allowlist.
 */
export const ALLOWLIST = [
  // API externa (ViaCEP/Nominatim): resultado externo, não dado do seed
  "geo:",
  // estado de sessão: revogação/TTL/sweep/rotina do cookie
  "user:active:",
  "realtime:renewed:",
  "realtime:revoked:",
  // distância usuário-a-usuário (IDs não estáveis entre re-seeds — órfãos
  // inofensivos) e flag de capacidade do PostGIS
  "distance:",
  "postgis:available",
  // estado de push/cron/ops (redis cru hoje — documentado por precaução)
  "push:payload:",
  "cron:cooldown:",
  "geo:metrics:",
]

/** Arquivos de teste NÃO são varridos (mocks não representam cache real). */
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
 * Apaga comentários (/* *\/ e //) preservando strings — o prefixo de cache
 * vive DENTRO de string/template literal, então strings não podem ser
 * blanked. Menção em prosa/JSDoc (ex.: docstring citando `withCache(...)`)
 * não conta como uso real.
 */
export function stripComments(code) {
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
 * Extrai a lista CACHE_PATTERNS do prisma/seed.ts (fonte da verdade do
 * seed — nunca hardcoded aqui).
 *
 * @param {string} seedSource  conteúdo de prisma/seed.ts
 * @returns {string[]} padrões (ex.: ["services:*", "providers:count:*"])
 */
export function extractCachePatterns(seedSource) {
  const block = seedSource.match(/const\s+CACHE_PATTERNS[\s\S]*?=\s*\[([\s\S]*?)\s*\]/)
  if (!block) return []
  const patterns = []
  const re = /^\s*"([^"]+)",?\s*$/gm
  let m
  while ((m = re.exec(block[1])) !== null) patterns.push(m[1])
  return patterns
}

/**
 * Coleta os prefixes de cache usados em src/ (call sites + builders).
 *
 * @param {string} root  diretório raiz (repo ou fixture)
 * @returns {Map<string, Set<string>>} prefixo → arquivos que o usam
 */
/**
 * Normaliza um literal de chave de cache para o prefixo de classificação:
 *   - `services:*`/`categories:*` → `services:`/`categories:` (strip `*`)
 *   - `reviews:recent:5` (tail dinâmico numérico) → prefixo guloso `reviews:recent:`
 *   - `services:all:all:''` (tail dinâmico) → prefixo guloso `services:`
 *   - `postgis:available` (chave COMPLETA, tail alfabético) → mantém inteira
 *     (casa a ALLOWLIST exatamente — `postgis:` NÃO é o prefixo correto)
 *   - `geo:cep:` (já prefixo) → inalterado
 *
 * Regra do tail após o último `:`: vazio/`*`/numérico/aspas = sufixo dinâmico
 * (vira prefixo guloso); alfabético = chave completa (mantém inteira).
 */
export function normalizeKeyLiteral(text) {
  const t = text.trim()
  if (!/^[a-z][a-z0-9_-]*:/.test(t)) return null
  const m = t.match(/^([a-z][a-z0-9_-]*(?::[a-zA-Z0-9_-]+)*:)(.*)$/)
  if (!m) return null
  const prefix = m[1]
  const tail = m[2]
  if (tail === "" || /^[\d*'"]/.test(tail)) return prefix
  // tail alfabético → chave completa (ex.: `postgis:available`); o tail `*`
  // já caiu no ramo dinâmico acima, então não precisa de strip de `*` aqui
  return t
}

export function collectCachePrefixes(root) {
  const prefixes = new Map()
  const srcDir = join(root, "src")
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) return prefixes

  const add = (prefix, file) => {
    if (!prefixes.has(prefix)) prefixes.set(prefix, new Set())
    prefixes.get(prefix).add(file)
  }

  for (const { rel, abs } of listTsFiles(srcDir, root)) {
    if (isTestFile(rel)) continue
    const raw = readFileSync(abs, "utf8")
    // arquivo cache-capable? (usa o helper de cache ou define builder)
    if (!/withCache|cacheInvalidate|withCachedGeo|CacheKey/.test(raw)) continue
    const code = stripComments(raw)

    // (a) primeiro argumento literal dos call sites (string ou template)
    const callRe = /(?:withCache|withCachedGeo|cacheInvalidate)\s*\(\s*([`"'])([\s\S]*?)\1/g
    let m
    while ((m = callRe.exec(code)) !== null) {
      const arg = m[2]
      if (m[1] === "`") {
        // parte estática antes do primeiro `${` (interpolado) ou o literal
        // inteiro (template estático — ex.: `reviews:recent:5`)
        const staticPart = arg.split("${")[0]
        const base = normalizeKeyLiteral(staticPart)
        if (base) add(base, rel)
      } else {
        const base = normalizeKeyLiteral(arg)
        if (base) add(base, rel)
      }
    }

    // (b) templates com shape de chave (builders `*CacheKey` + inline)
    const tplRe = /`([a-z][a-z0-9_-]*(?::[a-zA-Z0-9_-]+)*:)([^`$]*?)\$\{/g
    while ((m = tplRe.exec(code)) !== null) {
      // parte estática após o prefixo sem espaços (senão é log/URL)
      if (/\s/.test(m[2])) continue
      add(m[1], rel)
    }
  }
  return prefixes
}

/**
 * Valida a consistência: todo prefixo real classificado (CACHE_PATTERNS ou
 * ALLOWLIST) e todo padrão do seed com uso real.
 *
 * @param {string[]} patterns  CACHE_PATTERNS do seed
 * @param {Map<string, Set<string>>} prefixes  prefixo → arquivos
 * @param {string[]} allowlist  prefixes deliberadamente excluídos
 * @returns {string[]} violações (vazio = consistente)
 */
export function checkCachePatterns(patterns, prefixes, allowlist) {
  const violations = []
  const bases = patterns.map((p) => p.replace(/\*$/, ""))
  const matchAny = (list, prefix) => list.some((b) => prefix === b || prefix.startsWith(b))

  // forward — prefixo real sem padrão nem allowlist = esquecido do re-seed
  for (const [prefix, files] of prefixes) {
    const fileList = [...files].sort().join(", ")
    if (matchAny(bases, prefix)) continue
    if (matchAny(allowlist, prefix)) continue
    violations.push(
      `prefixo '${prefix}' (${fileList}) sem padrão no CACHE_PATTERNS nem na ALLOWLIST — ` +
        `é cache de catálogo (adicione ao seed) ou não-catálogo (adicione à ALLOWLIST do guard)`,
    )
  }

  // reverse — padrão do seed sem nenhum uso real em src/ = órfão
  for (const pattern of patterns) {
    const base = pattern.replace(/\*$/, "")
    const used = [...prefixes.keys()].some((prefix) => prefix === base || prefix.startsWith(base))
    if (!used) {
      violations.push(
        `padrão '${pattern}' do CACHE_PATTERNS sem nenhum prefixo real em src/ — ` +
          `padrão órfão (cache removido ou typo de prefixo)`,
      )
    }
  }

  return violations
}

/**
 * Roda o guard num root (repo ou fixture). Retorna violações + arquivos.
 *
 * @param {string} root
 * @returns {{ violations: string[], files: Record<string, boolean> }}
 */
export function runCheck(root) {
  const seedPath = join(root, "prisma", "seed.ts")
  const violations = []
  const files = { seed: existsSync(seedPath) }
  if (!existsSync(seedPath)) {
    violations.push(`'prisma/seed.ts' ausente no root — o guard precisa do CACHE_PATTERNS do seed`)
  } else {
    const patterns = extractCachePatterns(readFileSync(seedPath, "utf8"))
    if (patterns.length === 0) {
      violations.push(`CACHE_PATTERNS vazio ou não encontrado em prisma/seed.ts`)
    }
    const prefixes = collectCachePrefixes(root)
    violations.push(...checkCachePatterns(patterns, prefixes, ALLOWLIST))
  }
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
    console.error(`❌ ${violations.length} violação(ões) de consistência do CACHE_PATTERNS:\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Todo prefixo de withCache/withCachedGeo/cacheInvalidate em src/ precisa ser\n` +
        `   classificado: catálogo (entrar no CACHE_PATTERNS do seed — senão o re-seed\n` +
        `   deixa a vitrine com IDs antigos até o TTL) ou não-catálogo (entrar na\n` +
        `   ALLOWLIST do guard, espelhando o comentário de exclusões do seed). E todo\n` +
        `   padrão do CACHE_PATTERNS precisa ter uso real em src/ (padrão órfão = doc\n` +
        `   prometendo invalidação que não existe). O guard DERIVA dos call sites —\n` +
        `   a lista não pode driftar do código.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ CACHE_PATTERNS consistente — todo prefixo de cache classificado e padrões com uso real.`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
