#!/usr/bin/env node
// =============================================================================
// check-tier1-fastpath.mjs — guard periódico do tier-1 fast path do setup-bun
//
// POR QUE EXISTE: o composite action ./.github/actions/setup-bun tem 3 tiers:
//   1. PRE-INSTALLED fast path — bun já no PATH da imagem (custom
//      ghcr.io/<owner>/ubuntu-bun:<versão>) → ~0-2s, ZERO download/cache I/O.
//   2. actions/cache restore (~1-2s).
//   3. COLD-CACHE download (~1-3s mirror GHCR / ~5-10s GitHub Releases).
// Se o tier-1 regredir silenciosamente (ex.: a imagem para de embarcar bun,
// o passo 'Detect pre-installed Bun' quebra, ou a versão embarcada diverge de
// vars.BUN_VERSION), o setup-bun continua FUNCIONANDO — só fica mais lento e
// o pr-check (que mede correção, não performance) não percebe. Este guard
// re-executa `act -j check` com a imagem custom e FALHA se:
//   - o marcador tier-1 'Usando Bun pré-instalado' não aparecer no log, OU
//   - a duração do passo 'Use pre-installed Bun (fast path)' > threshold.
//
// ATENÇÃO (evidência empírica, act 0.2.89): a linha
//   `Success - Main ./.github/actions/setup-bun [X.XXs]` (duração do COMPOSITE)
//   NÃO é um sinal confiável — o act adiciona overhead próprio (30.5s cold /
//   11s warm medidos em 08/2026, mesmo com o tier-1 engajado). Os sinais
//   confiáveis são:
//   - `| ✅ Usando Bun pré-instalado: <versão> (0s, sem download)`
//   - `✅  Success - Main Use pre-installed Bun (fast path) [<dur>ms]`
//   O composite total é reportado apenas como informativo.
//
// Usage:
//   node scripts/check-tier1-fastpath.mjs --log <act-log> [--threshold <s>] [--version <v>]
//
// Exit codes:
//   0 — PASS (tier-1 engajado e dentro do threshold)
//   1 — FAIL (regressão do tier-1: marker ausente, lento ou drift de versão)
//   2 — uso inválido (--log obrigatório, --threshold > 0)
//
// Saída: relatório + exit code (0 = PASS, 1 = FAIL, 2 = uso inválido).
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { pathToFileURL } from "node:url"

// ---------------------------------------------------------------------------
// Helpers puros (exportados para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Converte a duração `[461.9667ms]` / `[10.9823953s]` / `[589.4µs]` de uma
 * linha de log do act para segundos. Retorna null se a linha não tiver
 * duração com uma das unidades suportadas.
 */
export function extractDurationFromLine(line) {
  const m = String(line).match(/\[([\d.]+)(ms|µs|s)\]/)
  if (!m) return null
  const value = parseFloat(m[1])
  if (!Number.isFinite(value)) return null
  switch (m[2]) {
    case "ms":
      return value / 1000
    case "µs":
      return value / 1_000_000
    default:
      return value
  }
}

/**
 * Extrai a versão do marcador `Usando Bun pré-instalado: <v>` da linha, ou
 * null se a linha não for o marcador.
 */
export function parseMarkerVersion(line) {
  const m = String(line).match(/Usando Bun pré-instalado:\s*([\d.]+)/)
  return m ? m[1] : null
}

/**
 * Extrai do log do act a evidência do tier-1 fast path:
 *   { markerVersion, fastPathDurationSeconds, compositeDurationSeconds }
 * Campos ausentes ficam como null (nunca lança).
 */
export function extractFastPathEvidence(logText) {
  const lines = String(logText).split(/\r?\n/)
  const markerLine = lines.find((l) => l.includes("Usando Bun pré-instalado:"))
  const fastPathLine = lines.find((l) =>
    l.includes("Success - Main Use pre-installed Bun (fast path)"),
  )
  const compositeLine = lines.find((l) => l.includes("Success - Main ./.github/actions/setup-bun"))
  return {
    markerVersion: markerLine ? parseMarkerVersion(markerLine) : null,
    fastPathDurationSeconds: fastPathLine ? extractDurationFromLine(fastPathLine) : null,
    compositeDurationSeconds: compositeLine ? extractDurationFromLine(compositeLine) : null,
  }
}

/**
 * Verdict do guard. Recebe o texto do log + opções e devolve
 * { pass, reasons, ...evidencia, thresholdSeconds, expectedVersion }.
 *
 * Regras (falha se QUALQUER uma):
 *   1. marcador 'Usando Bun pré-instalado' ausente → tier-1 não engajou
 *   2. duração do passo fast-path ausente → INCONCLUSIVO (não medível)
 *   3. duração do passo fast-path > thresholdSeconds
 *   4. expectedVersion informado e marcador ≠ expectedVersion (drift)
 *
 * @param {string} logText
 * @param {{thresholdSeconds?: number, expectedVersion?: string | null}} [options]
 * @returns {{
 *   pass: boolean,
 *   reasons: string[],
 *   markerVersion: string | null,
 *   fastPathDurationSeconds: number | null,
 *   compositeDurationSeconds: number | null,
 *   thresholdSeconds: number,
 *   expectedVersion: string | null,
 * }}
 */
export function checkTier1Fastpath(logText, { thresholdSeconds = 5, expectedVersion = null } = {}) {
  const ev = extractFastPathEvidence(logText)
  const reasons = []

  if (!ev.markerVersion) {
    reasons.push(
      "marcador 'Usando Bun pré-instalado' AUSENTE — tier-1 não engajou (bun não está pré-instalado na imagem ou o passo 'Detect pre-installed Bun' quebrou)",
    )
  }
  if (ev.fastPathDurationSeconds === null) {
    reasons.push(
      "duração do passo 'Use pre-installed Bun (fast path)' não encontrada no log — INCONCLUSIVO (passo renomeado/removido ou job falhou antes do setup-bun)",
    )
  } else if (ev.fastPathDurationSeconds > thresholdSeconds) {
    reasons.push(
      `fast path ${ev.fastPathDurationSeconds.toFixed(3)}s > threshold ${thresholdSeconds}s`,
    )
  }
  if (expectedVersion && ev.markerVersion && ev.markerVersion !== expectedVersion) {
    reasons.push(`marcador ${ev.markerVersion} ≠ esperado ${expectedVersion} (drift de versão)`)
  }

  return {
    pass: reasons.length === 0,
    reasons,
    markerVersion: ev.markerVersion,
    fastPathDurationSeconds: ev.fastPathDurationSeconds,
    compositeDurationSeconds: ev.compositeDurationSeconds,
    thresholdSeconds,
    expectedVersion,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node scripts/check-tier1-fastpath.mjs --log <act-log> [--threshold <s>] [--version <v>]

  --log        (obrigatório) arquivo com o output do act (job que usa setup-bun)
  --threshold  duração máxima do passo fast-path em segundos (default: 5)
  --version    versão esperada do bun (default: nenhum — não checa drift)
  -h, --help   mostra esta ajuda

Exit codes: 0 = PASS, 1 = FAIL, 2 = uso inválido`

/**
 * Faz parse dos args da CLI.
 *
 * @param {string[]} argv
 * @returns {{
 *   log?: string | null,
 *   threshold?: number,
 *   version?: string | null,
 *   error?: string,
 *   help?: boolean,
 * }}
 */
export function parseArgs(argv) {
  const out = { log: null, threshold: 5, version: null }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--log": {
        const v = argv[++i]
        if (v === undefined) return { error: `--log exige um valor` }
        out.log = v
        break
      }
      case "--threshold": {
        const v = parseFloat(argv[++i])
        if (!Number.isFinite(v) || v <= 0)
          return { error: `--threshold deve ser > 0 (obtido: '${argv[i]}')` }
        out.threshold = v
        break
      }
      case "--version": {
        const v = argv[++i]
        if (v === undefined) return { error: `--version exige um valor` }
        out.version = v
        break
      }
      case "-h":
      case "--help":
        return { help: true }
      default:
        return { error: `argumento desconhecido: ${argv[i]}` }
    }
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  if (args.error) {
    console.error(`❌ ${args.error}\n\n${USAGE}`)
    process.exit(2)
  }
  if (!args.log) {
    console.error(`❌ --log é obrigatório\n\n${USAGE}`)
    process.exit(2)
  }
  if (!existsSync(args.log)) {
    console.error(`❌ Log não encontrado: ${args.log}`)
    process.exit(2)
  }

  const logText = readFileSync(args.log, "utf8")
  const result = checkTier1Fastpath(logText, {
    thresholdSeconds: args.threshold,
    expectedVersion: args.version,
  })

  console.log("=== Tier-1 Fastpath Guard (setup-bun) ===")
  console.log(`  marcador tier-1:     ${result.markerVersion ?? "AUSENTE"}`)
  console.log(
    `  passo fast-path:      ${result.fastPathDurationSeconds === null ? "não encontrado" : `${result.fastPathDurationSeconds.toFixed(3)}s`}`,
  )
  console.log(
    `  composite setup-bun:  ${result.compositeDurationSeconds === null ? "não encontrado" : `${result.compositeDurationSeconds.toFixed(3)}s`} (informativo — inclui overhead do act)`,
  )
  console.log(`  threshold:           ${result.thresholdSeconds}s`)
  if (result.expectedVersion) console.log(`  versão esperada:     ${result.expectedVersion}`)

  if (result.pass) {
    console.log("✅ PASS — tier-1 fast path engajado e dentro do threshold.")
    process.exit(0)
  }
  console.error("❌ FAIL — regressão do tier-1 fast path:")
  for (const r of result.reasons) console.error(`   - ${r}`)
  process.exit(1)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
