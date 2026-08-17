/**
 * check-cache-patterns-cli.test.ts
 *
 * Testes CLI do guard scripts/check-cache-patterns.mjs — consistência da
 * lista CACHE_PATTERNS do seed (prisma/seed.ts) contra os prefixes reais de
 * withCache/withCachedGeo/cacheInvalidate em src/.
 *
 * Contexto: um re-seed apaga/recria User/Service/Category/Review/Booking —
 * qualquer cache de catálogo público com padrão esquecido do CACHE_PATTERNS
 * fica STALE com IDs antigos até o TTL (a janela documentada no spec E2E);
 * um padrão órfão promete invalidação que não existe. O guard deriva os
 * prefixos dos call sites reais — a lista não pode driftar do código.
 *
 * Cobre:
 *   - fixture limpo (todo prefixo classificado) → exit 0
 *   - prefixo novo em src/ sem padrão no CACHE_PATTERNS nem ALLOWLIST
 *     (forward — esquecido) → exit 1 + prefixo citado
 *   - padrão do CACHE_PATTERNS sem uso real em src/ (reverse — órfão)
 *     → exit 1 + padrão citado
 *   - prefixo de allowlist (não-catálogo) → exit 0
 *   - seed ausente → exit 1 (fail-closed)
 *   - funções puras: extractCachePatterns parseia o array do seed,
 *     collectCachePrefixes ignora comentários/testes e pega builders, e
 *     checkCachePatterns classifica nas 3 direções
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  ALLOWLIST,
  extractCachePatterns,
  collectCachePrefixes,
  checkCachePatterns,
  stripComments,
} from "../../../scripts/check-cache-patterns.mjs"

const GUARD = resolve(process.cwd(), "scripts/check-cache-patterns.mjs")

const tmpDirs: string[] = []

/** Seed fake com o CACHE_PATTERNS do repo (6 padrões de catálogo). */
const SEED_WITH_PATTERNS = `// (documentação)
const CACHE_PATTERNS: readonly string[] = [
  "services:*",
  "providers:count:*",
  "proximity:*",
  "categories:*",
  "cat:desc:*",
  "reviews:recent:*",
]
`

/**
 * Fixture limpo: seed com os 6 padrões + src/ com call sites que usam cada
 * um (via template) + um prefixo de allowlist (geo:cep:) + um builder
 * (proximityCacheKey → proximity:). Guard deve passar (exit 0).
 */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "cache-patterns-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "prisma"), { recursive: true })
  mkdirSync(join(dir, "src", "app", "api", "services"), { recursive: true })
  mkdirSync(join(dir, "src", "app", "api", "reviews", "recent"), { recursive: true })
  mkdirSync(join(dir, "src", "lib"), { recursive: true })
  writeFileSync(join(dir, "prisma", "seed.ts"), SEED_WITH_PATTERNS)

  writeFileSync(
    join(dir, "src", "app", "api", "services", "route.ts"),
    [
      'import { withCache } from "@/lib/redis"',
      "",
      "export async function GET(req: Request) {",
      '  const providerId = "all"',
      "  const cacheKey = `services:${providerId}:all:''`",
      "  return withCache(cacheKey, async () => ({}), 30)",
      "}",
      "",
    ].join("\n"),
  )

  writeFileSync(
    join(dir, "src", "lib", "radius-expansion.ts"),
    [
      'import { withCache } from "@/lib/redis"',
      "",
      "export function radiusCountCacheKey(lat: number): string {",
      "  return `providers:count:${lat.toFixed(3)}:all`",
      "}",
      "",
    ].join("\n"),
  )

  writeFileSync(
    join(dir, "src", "lib", "postgis.ts"),
    [
      'import { withCache } from "@/lib/redis"',
      "",
      "function proximityCacheKey(lat: number): string {",
      "  return `proximity:${lat.toFixed(3)}:10`",
      "}",
      "export async function near() {",
      "  return withCache(proximityCacheKey(-23.5), async () => [], 60)",
      "}",
      "",
    ].join("\n"),
  )

  writeFileSync(
    join(dir, "src", "lib", "categories.ts"),
    [
      'import { cacheInvalidate } from "@/lib/redis"',
      "",
      'export async function invalidateAll() { await cacheInvalidate("categories:*") }',
      "export async function invalidateDesc() {",
      '  await cacheInvalidate("cat:desc:*")',
      "}",
      "",
    ].join("\n"),
  )

  writeFileSync(
    join(dir, "src", "app", "api", "reviews", "recent", "route.ts"),
    [
      'import { withCache } from "@/lib/redis"',
      "",
      "export async function GET() {",
      "  return withCache(`reviews:recent:5`, async () => [], 60)",
      "}",
      "",
    ].join("\n"),
  )

  // allowlist — geo:cep: é não-catálogo (API externa) e não deve falhar
  writeFileSync(
    join(dir, "src", "lib", "geo.ts"),
    [
      'import { withCachedGeo } from "@/lib/geo-cache"',
      "",
      "export async function cep(cep: string) {",
      "  return withCachedGeo(`geo:cep:${cep}`, async () => null, 86400)",
      "}",
      "",
    ].join("\n"),
  )
  return dir
}

/** Output combinado stdout+stderr — o guard escreve violações no stderr. */
function outputOf(res: ReturnType<typeof run>): string {
  return `${res.stdout ?? ""}${res.stderr ?? ""}`
}

function run(dir: string) {
  return spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-cache-patterns.mjs (CLI)", () => {
  it("exit 0 quando todo prefixo de src/ está classificado (catálogo ou allowlist)", () => {
    const dir = makeFixture()
    const res = run(dir)
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("✅")
  })

  it("exit 1 e cita o prefixo quando um cache novo em src/ não está no CACHE_PATTERNS nem ALLOWLIST (forward)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "favorites.ts"),
      [
        'import { withCache } from "@/lib/redis"',
        "",
        "export async function count(userId: string) {",
        "  return withCache(`favorites:count:${userId}`, async () => 0, 60)",
        "}",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("favorites:count:")
    expect(outputOf(res)).toContain("sem padrão no CACHE_PATTERNS")
  })

  it("exit 1 e cita o padrão quando um CACHE_PATTERNS não tem uso real em src/ (reverse — órfão)", () => {
    const dir = makeFixture()
    // adiciona um padrão órfão NOVO ao seed — não existe call site em src/
    writeFileSync(
      join(dir, "prisma", "seed.ts"),
      SEED_WITH_PATTERNS.replace(
        '  "reviews:recent:*",\n',
        '  "reviews:recent:*",\n  "ghost:prefix:*",\n',
      ),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("ghost:prefix:*")
    expect(outputOf(res)).toContain("padrão órfão")
  })

  it("exit 0 com prefixo de allowlist (não-catálogo) mesmo sem padrão no seed", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "session.ts"),
      [
        'import { cacheInvalidate } from "@/lib/redis"',
        "",
        "export async function deactivate(userId: string) {",
        "  await cacheInvalidate(`user:active:${userId}`)",
        "}",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("exit 1 quando o prisma/seed.ts está ausente (fail-closed)", () => {
    const dir = makeFixture()
    rmSync(join(dir, "prisma", "seed.ts"))
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("seed.ts")
  })

  it("exit 1 quando CACHE_PATTERNS está vazio (fail-closed)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "prisma", "seed.ts"),
      "// seed fake sem CACHE_PATTERNS\nconst CACHE_PATTERNS: readonly string[] = []\n",
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("CACHE_PATTERNS")
  })

  it("exit 2 para flag desconhecida", () => {
    const dir = makeFixture()
    const res = spawnSync(process.execPath, [GUARD, "--nope", dir], { encoding: "utf8" })
    expect(res.status).toBe(2)
  })
})

describe("check-cache-patterns.mjs (funções puras)", () => {
  it("extractCachePatterns parseia o array de padrões do seed", () => {
    const patterns = extractCachePatterns(SEED_WITH_PATTERNS)
    expect(patterns).toEqual([
      "services:*",
      "providers:count:*",
      "proximity:*",
      "categories:*",
      "cat:desc:*",
      "reviews:recent:*",
    ])
  })

  it("collectCachePrefixes ignora comentários (menção em prosa não conta)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "docs.ts"),
      [
        '/** Exemplo: withCache("my:key", () => fetchExpensiveData(), 60) */',
        'export const NOTE = "não é um call site"',
        "",
      ].join("\n"),
    )
    const prefixes = collectCachePrefixes(dir)
    expect(prefixes.has("my:key")).toBe(false)
  })

  it("collectCachePrefixes pega call sites de string, template e builders *CacheKey", () => {
    const dir = makeFixture()
    const prefixes = collectCachePrefixes(dir)
    expect(prefixes.has("services:")).toBe(true)
    expect(prefixes.has("providers:count:")).toBe(true)
    expect(prefixes.has("proximity:")).toBe(true)
    expect(prefixes.has("categories:")).toBe(true)
    expect(prefixes.has("cat:desc:")).toBe(true)
    expect(prefixes.has("reviews:recent:")).toBe(true)
    expect(prefixes.has("geo:cep:")).toBe(true)
  })

  it("checkCachePatterns reporta forward (esquecido), reverse (órfão) e allowlist", () => {
    const prefixes = new Map<string, Set<string>>([
      ["services:", new Set(["src/lib/a.ts"])],
      ["favorites:count:", new Set(["src/lib/b.ts"])],
      ["user:active:", new Set(["src/lib/c.ts"])],
    ])
    const patterns = ["services:*"]

    // favorites:count: sem padrão nem allowlist → forward
    const violations = checkCachePatterns(patterns, prefixes, ALLOWLIST)
    expect(violations.some((v) => v.includes("favorites:count:") && v.includes("sem padrão"))).toBe(
      true,
    )
    expect(violations.some((v) => v.includes("user:active:"))).toBe(false)
    expect(violations.some((v) => v.includes("órfão"))).toBe(false)

    // padrão sem uso real → reverse (órfão)
    const orphans = checkCachePatterns(["services:*", "ghost:prefix:*"], prefixes, ALLOWLIST)
    expect(orphans.some((v) => v.includes("ghost:prefix:*") && v.includes("órfão"))).toBe(true)
  })

  it("stripComments preserva strings (prefixo real sobrevive)", () => {
    const code = [
      '/** Docstring: withCache("ghost:key", ...) — prosa não conta */',
      "const K = `services:${id}` // comentário inline",
      "",
    ].join("\n")
    const clean = stripComments(code)
    expect(clean).toContain("`services:")
    expect(clean).not.toContain("ghost:key")
  })
})
