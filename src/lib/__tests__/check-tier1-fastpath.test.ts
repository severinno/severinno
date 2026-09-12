import { describe, expect, it } from "vitest"
import {
  checkTier1Fastpath,
  extractDurationFromLine,
  extractFastPathEvidence,
  extractTierEngagement,
  parseArgs,
  parseMarkerVersion,
} from "../../../scripts/check-tier1-fastpath.mjs"

// ---------------------------------------------------------------------------
// Fixtures — logs realistas baseados na evidência empírica do act 0.2.89
// (probe 08/2026: imagem custom ghcr.io/<owner>/ubuntu-bun, job check).
// O setup é UM step ('Setup Bun', que roda scripts/setup-bun-ci.sh): com o
// tier-1 engajado o script sai na PRIMEIRA checagem, então a duração desse
// step É o fast path (~0.44-0.46s). O step inclui o overhead do act.
// ---------------------------------------------------------------------------

const LOG_TIER1_FAST = [
  "[PR Check/check]   ✅  Success - Main Resolve Bun version [464.4688ms]",
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Setup Bun [461.9667ms]",
  "[PR Check/check]   ✅  Success - Complete job",
].join("\n")

// Tier-2: o actions/cache é um step de PRIMEIRO NÍVEL do job (rodou e
// restaurou) e o SCRIPT consumiu o binário do cache — o marcador tier-1 está
// ausente. O sinal de engajamento do tier-2 é a saída do script, não a linha
// de success do step de cache (que roda sempre).
const LOG_TIER2_CACHE = [
  "[PR Check/check]   ✅  Success - Main Resolve Bun version [464.4688ms]",
  "[PR Check/check]   ✅  Success - Main Restore Bun cache [1.234s]",
  "[PR Check/check]   | Cache restored from key: bun-1.3.14-Linux-X64",
  "[PR Check/check]   | ✅ Bun do cache: 1.3.14 (sem download)",
  "[PR Check/check]   ✅  Success - Main Setup Bun [1.9s]",
  "[PR Check/check]   ✅  Success - Complete job",
].join("\n")

const LOG_NO_EVIDENCE = [
  "[PR Check/check]   ❌  Error - actions/checkout@v4",
  "[PR Check/check] 🏁  Job failed",
].join("\n")

const LOG_SLOW_FASTPATH = [
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Setup Bun [6.5s]",
].join("\n")

const LOG_VERSION_DRIFT = [
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.4.0 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Setup Bun [450ms]",
].join("\n")

// Cenário catthehacker default (act EMULA o actions/cache): tier-1 nem
// engaja (sem bun pré-instalado na imagem) e o cache restore é LENTO (~21s
// medidos em 08/2026). O marcador está ausente e o passo fast-path também —
// o que o --tier2 adiciona é o sinal QUANTITATIVO do cache emulado.
const LOG_CATTHEHACKER_DEFAULT = [
  "[PR Check/check]   ✅  Success - Main Resolve Bun version [464.4688ms]",
  "[PR Check/check]   ✅  Success - Main Restore Bun cache [21.22s]",
  "[PR Check/check]   | Cache restored from key: bun-1.3.14-Linux-X64",
  "[PR Check/check]   ✅  Success - Main Setup Bun [22.4s]",
  "[PR Check/check]   ✅  Success - Complete job",
].join("\n")

// Regressão coberta pela ampliação: marcador tier-1 PRESENTE mas tier-2
// (cache restore) também engajou — ex.: echo do marcador duplicado/movido,
// ou condição invertida que segue imprimindo o marcador. Antes passava (o
// guard só olhava a presença do marcador); agora deve FALHAR.
const LOG_MARKER_WITH_TIER2 = [
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Setup Bun [461.9667ms]",
  "[PR Check/check]   | ✅ Bun do cache: 1.3.14 (sem download)",
].join("\n")

// Mesma regressão via tier-3: marcador presente + download explícito.
const LOG_MARKER_WITH_TIER3 = [
  "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
  "[PR Check/check]   ✅  Success - Main Setup Bun [461.9667ms]",
  "[PR Check/check]   |   ✅ Mirror OCI ok — bun 1.3.14",
].join("\n")

// Tier-3 engajado com o padrão REAL do act 0.2.89 em logs não-TTY: o script
// baixou o release (a linha 'URL: https://...' é `echo` simples; os títulos
// ::group:: são CONSUMIDOS pelo act e não aparecem literalmente).
// NOTA: em um log tier-3 real, o step de cache roda ANTES com cache-miss
// ("Success - Main Restore Bun cache" + "Cache not found") — logs genuínos de
// tier-3 costumam disparar AMBOS os flags. Este fixture isola a detecção de
// tier-3 para teste unitário do extractor; o verdict lida com as duas razões
// juntas sem conflito.
const LOG_TIER3_STEP_ONLY = [
  "[PR Check/check]   | Cache not found for input keys: bun-1.3.14-Linux-X64",
  "[PR Check/check]   | URL: https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip",
  "[PR Check/check]   ✅  Success - Main Setup Bun [8.3s]",
].join("\n")

// ---------------------------------------------------------------------------
// extractDurationFromLine
// ---------------------------------------------------------------------------

describe("extractDurationFromLine", () => {
  it("converte ms para segundos", () => {
    expect(extractDurationFromLine("✅  Success - Main Setup Bun [461.9667ms]")).toBeCloseTo(
      0.4619667,
      6,
    )
  })

  it("converte s (mantém o valor)", () => {
    expect(extractDurationFromLine("✅  Success - Main Setup Bun [10.9823953s]")).toBeCloseTo(
      10.9823953,
      6,
    )
  })

  it("converte µs para segundos", () => {
    expect(extractDurationFromLine("✅  Success - Main Complete job [589.4µs]")).toBeCloseTo(
      0.0005894,
      8,
    )
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
  it("extrai marcador + duração do step 'Setup Bun' no log tier-1", () => {
    const ev = extractFastPathEvidence(LOG_TIER1_FAST)
    expect(ev.markerVersion).toBe("1.3.14")
    // Com o setup em UM step, a duração do fast path É a do step (o script
    // sai na primeira checagem) — e compositeDurationSeconds aponta p/ o
    // MESMO step (nome mantido p/ compatibilidade com o bench).
    expect(ev.fastPathDurationSeconds).toBeCloseTo(0.4619667, 6)
    expect(ev.compositeDurationSeconds).toBeCloseTo(0.4619667, 6)
  })

  it("marcador ausente no log tier-2 (cache)", () => {
    const ev = extractFastPathEvidence(LOG_TIER2_CACHE)
    expect(ev.markerVersion).toBeNull()
    // O step 'Setup Bun' RODOU (o script foi para o cache) — mas SEM o
    // marcador tier-1 essa duração é a do setup INTEIRO, não do fast path.
    expect(ev.fastPathDurationSeconds).toBeNull()
    expect(ev.compositeDurationSeconds).toBeCloseTo(1.9, 6)
  })

  it("tolerante a CRLF e linhas vazias", () => {
    const ev = extractFastPathEvidence(LOG_TIER1_FAST.replace(/\n/g, "\r\n"))
    expect(ev.markerVersion).toBe("1.3.14")
  })

  it("extrai a duração do step de cache (Restore Bun cache)", () => {
    const ev = extractFastPathEvidence(LOG_TIER2_CACHE)
    expect(ev.tier2RestoreDurationSeconds).toBeCloseTo(1.234, 6)
  })

  it("tier2RestoreDurationSeconds é null quando o passo não rodou (tier-1 puro)", () => {
    const ev = extractFastPathEvidence(LOG_TIER1_FAST)
    expect(ev.tier2RestoreDurationSeconds).toBeNull()
  })

  it("extrai a duração do cache emulado no cenário catthehacker default", () => {
    const ev = extractFastPathEvidence(LOG_CATTHEHACKER_DEFAULT)
    expect(ev.tier2RestoreDurationSeconds).toBeCloseTo(21.22, 6)
    expect(ev.markerVersion).toBeNull()
    // O setup INTEIRO levou 22.4s (cache emulado + tier-3): o fast path não
    // engajou (o marcador é quem prova isso), mas o total do step foi medido.
    expect(ev.fastPathDurationSeconds).toBeNull()
    expect(ev.compositeDurationSeconds).toBeCloseTo(22.4, 6)
  })
})

// ---------------------------------------------------------------------------
// extractTierEngagement
// ---------------------------------------------------------------------------

describe("extractTierEngagement", () => {
  it("log tier-1 puro: nenhum tier inferior engajado", () => {
    expect(extractTierEngagement(LOG_TIER1_FAST)).toEqual({
      tier2Engaged: false,
      tier3Engaged: false,
    })
  })

  it("detecta tier-2 pela saída do script ('Bun do cache:')", () => {
    expect(extractTierEngagement(LOG_MARKER_WITH_TIER2).tier2Engaged).toBe(true)
  })

  it("detecta tier-3 pela linha de success do download", () => {
    expect(extractTierEngagement(LOG_MARKER_WITH_TIER3).tier3Engaged).toBe(true)
  })

  it("detecta tier-3 pela linha de success do download (padrão real act não-TTY)", () => {
    const t = extractTierEngagement(LOG_TIER3_STEP_ONLY)
    expect(t.tier3Engaged).toBe(true)
    expect(t.tier2Engaged).toBe(false)
  })

  it("texto de grupo interno NÃO conta como engajamento (act consome ::group::)", () => {
    const log = [
      "[PR Check/check]   | ::group::Puxando Bun 1.3.14 do mirror GHCR (ghcr.io/owner/bun:1.3.14)",
      "[PR Check/check]   |   ✅ Mirror GHCR ok — bun 1.3.14",
      "[PR Check/check]   | ::endgroup::",
    ].join("\n")
    const t = extractTierEngagement(log)
    expect(t.tier3Engaged).toBe(false)
    expect(t.tier2Engaged).toBe(false)
  })

  it("step de cache rodando NÃO conta como tier-2 (ele roda SEMPRE)", () => {
    // Regressão do contrato: com o setup em `run:`, o actions/cache é um step
    // de primeiro nível e roda em TODO run — a linha de success dele NÃO
    // prova que a camada de cache foi usada. Quem sabe a camada é o script.
    const log = [
      "[PR Check/check]   ✅  Success - Main Restore Bun cache [1.9s]",
      "[PR Check/check]   ✅  Success - Main Setup Bun [461.9667ms]",
    ].join("\n")
    expect(extractTierEngagement(log).tier2Engaged).toBe(false)
  })

  it("linha de Skip do step de cache não vira engajamento", () => {
    const log = ["[PR Check/check]   ⬇  Skip - Main Restore Bun cache"].join("\n")
    expect(extractTierEngagement(log).tier2Engaged).toBe(false)
  })

  it("sem o marcador do script não há tier-3 (título de grupo é consumido pelo act)", () => {
    const log = [
      "[PR Check/check]   | ::group::Baixando Bun 1.3.14 (linux-x64) do GitHub Releases",
      "[PR Check/check]   | ::endgroup::",
    ].join("\n")
    expect(extractTierEngagement(log).tier3Engaged).toBe(false)
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
      "✅  Success - Main Setup Bun [461.9667ms]",
      "✅  Success - Main Bun setup [461.9667ms]",
    )
    const r = checkTier1Fastpath(log)
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("INCONCLUSIVO"))).toBe(true)
  })

  it("FAIL quando marcador tier-1 presente MAS tier-2 engajou explicitamente (regressão de tier)", () => {
    const r = checkTier1Fastpath(LOG_MARKER_WITH_TIER2)
    expect(r.pass).toBe(false)
    expect(r.tier2Engaged).toBe(true)
    expect(r.reasons.some((x) => x.includes("tier-2 EXPLÍCITO"))).toBe(true)
  })

  it("FAIL quando marcador tier-1 presente MAS tier-3 engajou explicitamente", () => {
    const r = checkTier1Fastpath(LOG_MARKER_WITH_TIER3)
    expect(r.pass).toBe(false)
    expect(r.tier3Engaged).toBe(true)
    expect(r.reasons.some((x) => x.includes("tier-3 EXPLÍCITO"))).toBe(true)
  })

  it("FAIL quando tier-3 engajou (linha de success do download no log real)", () => {
    const r = checkTier1Fastpath(LOG_TIER3_STEP_ONLY)
    expect(r.pass).toBe(false)
    expect(r.tier3Engaged).toBe(true)
    expect(r.reasons.some((x) => x.includes("tier-3 EXPLÍCITO"))).toBe(true)
  })

  it("grupos internos sozinhos NÃO disparam FAIL (não são evidência no act)", () => {
    const log = [
      "[PR Check/check]   | ::group::Puxando Bun 1.3.14 do mirror GHCR (ghcr.io/owner/bun:1.3.14)",
      "[PR Check/check]   | ::endgroup::",
      "[PR Check/check]   | ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)",
      "[PR Check/check]   ✅  Success - Main Setup Bun [450ms]",
    ].join("\n")
    const r = checkTier1Fastpath(log)
    expect(r.pass).toBe(true)
    expect(r.tier3Engaged).toBe(false)
  })

  it("tier-2/tier-3 engajados = false no log tier-1 puro (sem ruído no PASS)", () => {
    const r = checkTier1Fastpath(LOG_TIER1_FAST)
    expect(r.tier2Engaged).toBe(false)
    expect(r.tier3Engaged).toBe(false)
  })

  // ── Regra 7: act exit code (act falhou antes do setup-bun) ──────────────
  it("PASS com actExit=0 e evidência do tier-1 (sem ruído)", () => {
    const r = checkTier1Fastpath(LOG_TIER1_FAST, { actExit: 0 })
    expect(r.pass).toBe(true)
    expect(r.actExit).toBe(0)
    expect(r.reasons).toEqual([])
  })

  it("FAIL quando actExit != 0 e SEM evidência do setup-bun (act morreu antes)", () => {
    const r = checkTier1Fastpath(LOG_NO_EVIDENCE, { actExit: 1 })
    expect(r.pass).toBe(false)
    expect(r.reasons.some((x) => x.includes("act exit code 1 ≠ 0"))).toBe(true)
    expect(r.reasons.some((x) => x.includes("ANTES do setup-bun"))).toBe(true)
  })

  it("PASS quando actExit != 0 MAS com evidência do setup-bun (act morreu depois)", () => {
    // act falhou DEPOIS do setup-bun (ex.: suite completa do job check) — a
    // evidência tier-1 existe e o guard decide por ela (mesma semântica do
    // periódico), então actExit != 0 não vira FAIL.
    const r = checkTier1Fastpath(LOG_TIER1_FAST, { actExit: 124 })
    expect(r.pass).toBe(true)
    expect(r.actExit).toBe(124)
  })

  it("PASS quando actExit != 0 e evidência é só tier-2/tier-3 no log", () => {
    // Evidência do setup-bun existe (composite + restore/download) — act exit
    // não dispara a regra 7; o FAIL vem das regras 5/6 (tier-2/3 explícito).
    const r = checkTier1Fastpath(LOG_TIER2_CACHE, { actExit: 2 })
    expect(r.pass).toBe(false)
    expect(r.actExit).toBe(2)
    expect(r.reasons.some((x) => x.includes("ANTES do setup-bun"))).toBe(false)
    expect(r.reasons.some((x) => x.includes("tier-2 EXPLÍCITO"))).toBe(true)
  })

  it("actExit default null não dispara a regra 7", () => {
    const r = checkTier1Fastpath(LOG_NO_EVIDENCE)
    expect(r.actExit).toBeNull()
    expect(r.reasons.some((x) => x.includes("ANTES do setup-bun"))).toBe(false)
  })

  // ── Regra 8: threshold do cache EMULADO (--tier2) ───────────────────────
  it("sem --tier2 não checa o cache emulado (backwards-compat)", () => {
    const r = checkTier1Fastpath(LOG_CATTHEHACKER_DEFAULT)
    expect(r.tier2ThresholdSeconds).toBeNull()
    // falha por marker ausente, NÃO pela regra 8 (threshold null)
    expect(r.reasons.some((x) => x.includes("cache emulado"))).toBe(false)
  })

  it("FAIL quando o cache emulado excede o threshold --tier2", () => {
    const r = checkTier1Fastpath(LOG_CATTHEHACKER_DEFAULT, { tier2ThresholdSeconds: 15 })
    expect(r.pass).toBe(false)
    expect(r.tier2ThresholdSeconds).toBe(15)
    expect(
      r.reasons.some((x) => x.includes("cache emulado (tier-2) 21.220s > threshold 15s")),
    ).toBe(true)
  })

  it("PASS na regra 8 quando o cache emulado fica dentro do threshold (outras regras decidem)", () => {
    // tier-2 dentro do threshold NÃO dispara a regra 8; o FAIL (se houver)
    // vem das outras regras (aqui: marker ausente em LOG_CATTHEHACKER_DEFAULT).
    const r = checkTier1Fastpath(LOG_CATTHEHACKER_DEFAULT, { tier2ThresholdSeconds: 30 })
    expect(r.reasons.some((x) => x.includes("cache emulado"))).toBe(false)
    // O verdict global ainda é FAIL — mas por marker ausente (regra 1), não
    // pela regra 8. O contrato tier-1 é quem domina neste cenário.
    expect(r.reasons.some((x) => x.includes("marcador"))).toBe(true)
  })

  it("regra 8 NÃO dispara quando o tier-2 não rodou (imagem custom — tier-1 engajou)", () => {
    const r = checkTier1Fastpath(LOG_TIER1_FAST, { tier2ThresholdSeconds: 5 })
    expect(r.pass).toBe(true)
    expect(r.tier2RestoreDurationSeconds).toBeNull()
    expect(r.reasons).toEqual([])
  })

  it("regra 8 não dispara quando o tier-2 rodou rápido em log com marcador tier-1", () => {
    // LOG_MARKER_WITH_TIER2 tem o marcador do script ('Bun do cache:') sem
    // linha de duração do step de cache — a regra 8 não adiciona razão (as
    // regras 1/5 dominam).
    const r = checkTier1Fastpath(LOG_MARKER_WITH_TIER2, { tier2ThresholdSeconds: 10 })
    expect(r.reasons.some((x) => x.includes("cache emulado"))).toBe(false)
    expect(r.reasons.some((x) => x.includes("tier-2 EXPLÍCITO"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseArgs (CLI)
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parse completo (log + threshold + version + act-exit + tier2)", () => {
    const args = parseArgs([
      "--log",
      "/tmp/act.log",
      "--threshold",
      "7",
      "--version",
      "1.3.14",
      "--act-exit",
      "124",
      "--tier2",
      "15",
    ])
    expect(args).toEqual({
      log: "/tmp/act.log",
      threshold: 7,
      version: "1.3.14",
      actExit: 124,
      tier2: 15,
    })
  })

  it("defaults (threshold 5, version null, actExit null, tier2 null)", () => {
    const args = parseArgs(["--log", "/tmp/act.log"])
    expect(args).toEqual({
      log: "/tmp/act.log",
      threshold: 5,
      version: null,
      actExit: null,
      tier2: null,
    })
  })

  it("parseia --tier2 com decimal", () => {
    const args = parseArgs(["--log", "/tmp/act.log", "--tier2", "21.5"])
    expect(args.tier2).toBe(21.5)
  })

  it("rejeita --tier2 inválido (não-numérico, zero, negativo, sem valor, sufixo)", () => {
    expect(parseArgs(["--log", "x", "--tier2", "abc"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--tier2", "0"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--tier2", "-3"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--tier2"]).error).toBeTruthy()
    // parseFloat("15abc") === 15 passaria finite/>0 em silêncio — o regex
    // /^\d+(\.\d+)?$/ do raw string rejeita sufixo não-numérico (mesmo
    // padrão do --act-exit).
    expect(parseArgs(["--log", "x", "--tier2", "15abc"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--tier2", "1.5.5"]).error).toBeTruthy()
  })

  it("parseia --act-exit 0 (exit code válido)", () => {
    const args = parseArgs(["--log", "/tmp/act.log", "--act-exit", "0"])
    expect(args.actExit).toBe(0)
  })

  it("rejeita --act-exit inválido (negativo, não-inteiro, sem valor)", () => {
    expect(parseArgs(["--log", "x", "--act-exit", "-1"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--act-exit", "abc"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--act-exit", "1.5"]).error).toBeTruthy()
    expect(parseArgs(["--log", "x", "--act-exit"]).error).toBeTruthy()
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
