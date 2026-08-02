import { describe, expect, it } from "vitest"
import {
  checkTier1Fastpath,
  extractDurationFromLine,
  extractFastPathEvidence,
  parseArgs,
  parseMarkerVersion,
} from "../../../scripts/check-tier1-fastpath.mjs"

// ---------------------------------------------------------------------------
// Fixtures — logs realistas baseados na evidência empírica do act 0.2.89
// (probe 08/2026: imagem custom ghcr.io/<owner>/ubuntu-bun, job check).
// O composite total (~11-30s) inclui overhead do act — os sinais confiáveis
// são o marcador e a duração do passo fast-path (~0.44-0.46s).
// ---------------------------------------------------------------------------

const LOG_TIER1_FAST = [
  "[PR Check/check]   ✅  Success - Main Resolve Bun version [464.4688ms]",
  "[PR Check/check]   ✅  Success - Main Detect pre-installed Bun [625.9247ms]",
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Use pre-installed Bun (fast path) [461.9667ms]",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [10.9823953s]",
  "[PR Check/check]   ✅  Success - Complete job",
].join("\n")

const LOG_TIER2_CACHE = [
  "[PR Check/check]   ✅  Success - Main Resolve Bun version [464.4688ms]",
  "[PR Check/check]   ✅  Success - Main Detect pre-installed Bun [625.9247ms]",
  "[PR Check/check]   ⬇  Skip - Main Use pre-installed Bun (fast path)",
  "[PR Check/check]   ✅  Success - Main Restore Bun release from cache [1.234s]",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [1.9s]",
  "[PR Check/check]   ✅  Success - Complete job",
].join("\n")

const LOG_NO_EVIDENCE = [
  "[PR Check/check]   ❌  Error - actions/checkout@v4",
  "[PR Check/check] 🏁  Job failed",
].join("\n")

const LOG_SLOW_FASTPATH = [
  "[PR Check/check]   ✅  Success - Main Detect pre-installed Bun [625.9247ms]",
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Use pre-installed Bun (fast path) [6.5s]",
  "[PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [8.1s]",
].join("\n")

const LOG_VERSION_DRIFT = [
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.4.0 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Use pre-installed Bun (fast path) [450ms]",
].join("\n")

// ---------------------------------------------------------------------------
// extractDurationFromLine
// ---------------------------------------------------------------------------

describe("extractDurationFromLine", () => {
  it("converte ms para segundos", () => {
    expect(
      extractDurationFromLine("✅  Success - Main Use pre-installed Bun (fast path) [461.9667ms]"),
    ).toBeCloseTo(0.4619667, 6)
  })

  it("converte s (mantém o valor)", () => {
    expect(
      extractDurationFromLine("✅  Success - Main ./.github/actions/setup-bun [10.9823953s]"),
    ).toBeCloseTo(10.9823953, 6)
  })

  it("converte µs para segundos", () => {
    expect(
      extractDurationFromLine("✅  Success - Post ./.github/actions/setup-bun [589.4µs]"),
    ).toBeCloseTo(0.0005894, 8)
  })

  it("retorna null sem duração na linha", () => {
    expect(extractDurationFromLine("✅  Success - Complete job")).toBeNull()
    expect(extractDurationFromLine("")).toBeNull()
  })

  it("retorna null com duração em unidade desconhecida", () => {
    expect(extractDurationFromLine("✅  Success - algo [10.5min]")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseMarkerVersion
// ---------------------------------------------------------------------------

describe("parseMarkerVersion", () => {
  it("extrai a versão do marcador tier-1", () => {
    expect(parseMarkerVersion("| ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)")).toBe(
      "1.3.14",
    )
  })

  it("retorna null em linha que não é o marcador", () => {
    expect(parseMarkerVersion("✅  Success - Complete job")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractFastPathEvidence
// ---------------------------------------------------------------------------

describe("extractFastPathEvidence", () => {
  it("extrai marcador + durações do log tier-1", () => {
    const ev = extractFastPathEvidence(LOG_TIER1_FAST)
    expect(ev.markerVersion).toBe("1.3.14")
    expect(ev.fastPathDurationSeconds).toBeCloseTo(0.4619667, 6)
    expect(ev.compositeDurationSeconds).toBeCloseTo(10.9823953, 6)
  })

  it("marcador ausente no log tier-2 (cache)", () => {
    const ev = extractFastPathEvidence(LOG_TIER2_CACHE)
    expect(ev.markerVersion).toBeNull()
    expect(ev.fastPathDurationSeconds).toBeNull()
    expect(ev.compositeDurationSeconds).toBeCloseTo(1.9, 6)
  })

  it("tolerante a CRLF e linhas vazias", () => {
    const ev = extractFastPathEvidence(LOG_TIER1_FAST.replace(/\n/g, "\r\n"))
    expect(ev.markerVersion).toBe("1.3.14")
  })
})

// ---------------------------------------------------------------------------
// checkTier1Fastpath — o verdict do guard
// ---------------------------------------------------------------------------

describe("checkTier1Fastpath", () => {
  it("PASS quando tier-1 engaja e fica dentro do threshold (default 5s)", () => {
    const r = checkTier1Fastpath(LOG_TIER1_FAST)
    expect(r.pass).toBe(true)
    expect(r.reasons).toEqual([])
    expect(r.markerVersion).toBe("1.3.14")
    expect(r.fastPathDurationSeconds).toBeCloseTo(0.4619667, 6)
  })

  it("FAIL quando o marcador está ausente (tier-1 não engajou → caiu p/ tier-2)", () => {
    const r = checkTier1Fastpath(LOG_TIER2_CACHE)
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("marcador"))).toBe(true)
  })

  it("FAIL INCONCLUSIVO quando não há evidência (job falhou antes do setup-bun)", () => {
    const r = checkTier1Fastpath(LOG_NO_EVIDENCE)
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("INCONCLUSIVO"))).toBe(true)
  })

  it("FAIL quando o passo fast-path ultrapassa o threshold", () => {
    const r = checkTier1Fastpath(LOG_SLOW_FASTPATH, { thresholdSeconds: 5 })
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("6.500s > threshold 5s"))).toBe(true)
  })

  it("PASS na fronteira exata (duração == threshold não é falha — só > falha)", () => {
    const log = LOG_TIER1_FAST.replace("461.9667ms", "5000ms")
    const r = checkTier1Fastpath(log, { thresholdSeconds: 5 })
    expect(r.pass).toBe(true)
  })

  it("FAIL por drift quando expectedVersion não bate com o marcador", () => {
    const r = checkTier1Fastpath(LOG_VERSION_DRIFT, { expectedVersion: "1.3.14" })
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("drift de versão"))).toBe(true)
  })

  it("PASS com expectedVersion igual ao marcador", () => {
    const r = checkTier1Fastpath(LOG_TIER1_FAST, { expectedVersion: "1.3.14" })
    expect(r.pass).toBe(true)
  })

  it("sem expectedVersion não checa drift", () => {
    const r = checkTier1Fastpath(LOG_VERSION_DRIFT)
    expect(r.pass).toBe(true)
  })

  it("FAIL se o marcador existe mas o passo fast-path sumiu (renomeado/removido)", () => {
    const log = LOG_TIER1_FAST.replace(
      "✅  Success - Main Use pre-installed Bun (fast path) [461.9667ms]",
      "✅  Success - Main Use pre-installed Bun [461.9667ms]",
    )
    const r = checkTier1Fastpath(log)
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("INCONCLUSIVO"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseArgs (CLI)
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parse completo (log + threshold + version)", () => {
    const args = parseArgs(["--log", "/tmp/act.log", "--threshold", "7", "--version", "1.3.14"])
    expect(args).toEqual({ log: "/tmp/act.log", threshold: 7, version: "1.3.14" })
  })

  it("defaults (threshold 5, version null)", () => {
    const args = parseArgs(["--log", "/tmp/act.log"])
    expect(args).toEqual({ log: "/tmp/act.log", threshold: 5, version: null })
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
