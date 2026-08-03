import { describe, expect, it } from "vitest"
import {
  checkTier2CacheRestore,
  extractCacheRestoreEvidence,
  parseArgs,
} from "../../../scripts/check-tier2-cache-restore.mjs"
import { extractDurationFromLine } from "../../../scripts/check-setup-bun-common.mjs"

// ---------------------------------------------------------------------------
// Fixtures — logs realistas baseados na evidência empírica do act 0.2.89
// (probe 08/2026: logs capturados em tool-results/ e /tmp/act-cat-run*.log).
// Formato real observado:
//   `✅  Success - Main Restore Bun release from cache [14.434715s]`
//   `| Cache restored successfully`
//   `| Cache restored from key: bun-1.3.14-linux-x64`
//   `| Cache not found for input keys: bun-1.3.14-ed5e2ff...`
// ---------------------------------------------------------------------------

const LOG_TIER2_HIT = [
  "[PR Check/check]   ✅  Success - Main Resolve Bun version [464.4688ms]",
  "[PR Check/check]   ✅  Success - Main Detect pre-installed Bun [625.9247ms]",
  "[PR Check/check]   ⬇  Skip - Main Use pre-installed Bun (fast path)",
  "[PR Check/check]   | Cache restored successfully",
  "[PR Check/check]   | Cache restored from key: bun-1.3.14-linux-x64",
  "[PR Check/check]   ✅  Success - Main Restore Bun release from cache [1.234s]",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [2.1s]",
  "[PR Check/check]   ✅  Success - Complete job",
].join("\n")

const LOG_TIER2_MISS = [
  "[PR Check/check]   ⬇  Skip - Main Use pre-installed Bun (fast path)",
  "[PR Check/check]   | Cache not found for input keys: bun-1.3.14-ed5e2ff..., bun-1.3.14-",
  "[PR Check/check]   ✅  Success - Main Restore Bun release from cache [1.1s]",
  "[PR Check/check]   ✅  Success - Main Download Bun release (cold cache) [7.42s]",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [8.3s]",
].join("\n")

const LOG_TIER2_SLOW = [
  "[PR Check/check]   ⬇  Skip - Main Use pre-installed Bun (fast path)",
  "[PR Check/check]   | Cache restored successfully",
  "[PR Check/check]   ✅  Success - Main Restore Bun release from cache [14.434715s]",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [15.2s]",
].join("\n")

const LOG_TIER1_SKIP_CACHE = [
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Use pre-installed Bun (fast path) [461.9667ms]",
  "[PR Check/check]   ⬇  Skip - Main Restore Bun release from cache",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [1.9s]",
].join("\n")

const LOG_NO_EVIDENCE = [
  "[PR Check/check]   ❌  Error - actions/checkout@v4",
  "[PR Check/check] 🏁  Job failed",
].join("\n")

// ---------------------------------------------------------------------------
// extractDurationFromLine (fonte única do módulo comum)
// ---------------------------------------------------------------------------

describe("extractDurationFromLine (check-setup-bun-common)", () => {
  it("converte ms para segundos", () => {
    expect(
      extractDurationFromLine("✅  Success - Main Restore Bun release from cache [461.9667ms]"),
    ).toBeCloseTo(0.4619667, 6)
  })

  it("converte s (mantém o valor)", () => {
    expect(
      extractDurationFromLine("✅  Success - Main Restore Bun release from cache [14.434715s]"),
    ).toBeCloseTo(14.434715, 6)
  })

  it("retorna null sem duração na linha", () => {
    expect(extractDurationFromLine("✅  Success - Complete job")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractCacheRestoreEvidence
// ---------------------------------------------------------------------------

describe("extractCacheRestoreEvidence", () => {
  it("extrai duração + engaged + cacheHit no log tier-2 hit", () => {
    const ev = extractCacheRestoreEvidence(LOG_TIER2_HIT)
    expect(ev.cacheRestoreDurationSeconds).toBeCloseTo(1.234, 3)
    expect(ev.cacheRestoreEngaged).toBe(true)
    expect(ev.cacheRestoreSkipped).toBe(false)
    expect(ev.cacheHit).toBe(true)
    expect(ev.cacheMiss).toBe(false)
    expect(ev.compositeDurationSeconds).toBeCloseTo(2.1, 3)
  })

  it("detecta cacheMiss no log tier-2 miss (tier-3 em seguida)", () => {
    const ev = extractCacheRestoreEvidence(LOG_TIER2_MISS)
    expect(ev.cacheRestoreDurationSeconds).toBeCloseTo(1.1, 3)
    expect(ev.cacheRestoreEngaged).toBe(true)
    expect(ev.cacheMiss).toBe(true)
    expect(ev.cacheHit).toBe(false)
  })

  it("marca skipped quando o step não rodou (tier-1 engajou)", () => {
    const ev = extractCacheRestoreEvidence(LOG_TIER1_SKIP_CACHE)
    expect(ev.cacheRestoreEngaged).toBe(false)
    expect(ev.cacheRestoreSkipped).toBe(true)
    expect(ev.cacheRestoreDurationSeconds).toBeNull()
  })

  it("tolerante a CRLF e linhas vazias", () => {
    const ev = extractCacheRestoreEvidence(LOG_TIER2_HIT.replace(/\n/g, "\r\n"))
    expect(ev.cacheRestoreDurationSeconds).toBeCloseTo(1.234, 3)
  })

  it("sem evidência: tudo default (null/false)", () => {
    const ev = extractCacheRestoreEvidence(LOG_NO_EVIDENCE)
    expect(ev.cacheRestoreDurationSeconds).toBeNull()
    expect(ev.cacheRestoreEngaged).toBe(false)
    expect(ev.cacheRestoreSkipped).toBe(false)
    expect(ev.cacheHit).toBe(false)
    expect(ev.cacheMiss).toBe(false)
    expect(ev.compositeDurationSeconds).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// checkTier2CacheRestore — o verdict do guard
// ---------------------------------------------------------------------------

describe("checkTier2CacheRestore", () => {
  it("PASS quando engajou e fica dentro do threshold (default 5s)", () => {
    const r = checkTier2CacheRestore(LOG_TIER2_HIT)
    expect(r.pass).toBe(true)
    expect(r.reasons).toEqual([])
    expect(r.cacheRestoreDurationSeconds).toBeCloseTo(1.234, 3)
  })

  it("FAIL quando cache restore ultrapassa o threshold", () => {
    const r = checkTier2CacheRestore(LOG_TIER2_SLOW, { thresholdSeconds: 5 })
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("14.435s > threshold 5s"))).toBe(true)
  })

  it("PASS na fronteira exata (duração == threshold não é falha — só > falha)", () => {
    const log = LOG_TIER2_HIT.replace("[1.234s]", "[5s]")
    const r = checkTier2CacheRestore(log, { thresholdSeconds: 5 })
    expect(r.pass).toBe(true)
  })

  it("FAIL INCONCLUSIVO quando engajou mas a duração não foi encontrada", () => {
    const log = LOG_TIER2_HIT.replace(
      "✅  Success - Main Restore Bun release from cache [1.234s]",
      "✅  Success - Main Restore Bun release from cache",
    )
    const r = checkTier2CacheRestore(log)
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("INCONCLUSIVO"))).toBe(true)
  })

  it("PASS com nota quando skipped (tier-1 engajou) e SEM --require-engagement", () => {
    const r = checkTier2CacheRestore(LOG_TIER1_SKIP_CACHE)
    expect(r.pass).toBe(true)
    expect(r.cacheRestoreSkipped).toBe(true)
  })

  it("FAIL quando skipped + --require-engagement (job esperava medir o tier-2)", () => {
    const r = checkTier2CacheRestore(LOG_TIER1_SKIP_CACHE, { requireEngagement: true })
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("--require-engagement"))).toBe(true)
  })

  it("FAIL INCONCLUSIVO quando step ausente e SEM --require-engagement", () => {
    const r = checkTier2CacheRestore(LOG_NO_EVIDENCE)
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("INCONCLUSIVO"))).toBe(true)
  })

  it("FAIL quando step ausente + --require-engagement", () => {
    const r = checkTier2CacheRestore(LOG_NO_EVIDENCE, { requireEngagement: true })
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("--require-engagement"))).toBe(true)
  })

  it("cache miss (tier-2 engajado + tier-3 em seguida) ainda é PASS no threshold", () => {
    const r = checkTier2CacheRestore(LOG_TIER2_MISS)
    expect(r.pass).toBe(true)
    expect(r.cacheMiss).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseArgs (CLI)
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parse completo (log + threshold + require-engagement)", () => {
    const args = parseArgs(["--log", "/tmp/act.log", "--threshold", "7", "--require-engagement"])
    expect(args).toEqual({ log: "/tmp/act.log", threshold: 7, requireEngagement: true })
  })

  it("defaults (threshold 5, requireEngagement false)", () => {
    const args = parseArgs(["--log", "/tmp/act.log"])
    expect(args).toEqual({ log: "/tmp/act.log", threshold: 5, requireEngagement: false })
  })

  it("rejeita threshold inválido", () => {
    expect(parseArgs(["--log", "x", "--threshold", "abc"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--threshold", "0"]).error).toBeTruthy()
  })

  it("rejeita argumento desconhecido", () => {
    expect(parseArgs(["--log", "x", "--bogus"]).error).toBeTruthy()
  })

  it("--help devolve { help: true }", () => {
    expect(parseArgs(["--help"]).help).toBe(true)
  })
})
