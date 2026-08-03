#!/usr/bin/env node
// =============================================================================
// check-tier2-cache-restore.mjs — guard do tier-2 (actions/cache restore) do
// setup-bun
//
// POR QUE EXISTE: o composite action ./.github/actions/setup-bun tem 3 tiers:
//   1. PRE-INSTALLED fast path — bun já no PATH da imagem (custom
//      ghcr.io/<owner>/ubuntu-bun:<versão>) → ~0-2s, ZERO download/cache I/O.
//      Guardado por scripts/check-tier1-fastpath.mjs.
//   2. actions/cache restore — restaura o binário do release EXATO de
//      actions/cache (key = bun-<versão>-<os>-<arch>) → ~1-2s. Este guard
//      mede a duração do passo 'Restore Bun release from cache' e FALHA se
//      ultrapassar o threshold — completando a cobertura dos 3 tiers.
//   3. COLD-CACHE download — só em cache miss (~1-3s mirror GHCR / ~5-10s
//      GitHub Releases). Já coberto pelo check-tier1-fastpath.mjs, que FALHA
//      quando o log mostra tier-3 engajado explicitamente.
//
// Sinais confiáveis (evidência empírica, act 0.2.89, logs não-TTY — verificado
// em 08/2026 nos logs capturados):
//   - `✅  Success - Main Restore Bun release from cache [<dur>]` — o step
//     RODOU e a duração está na linha; é o que este guard mede.
//   - `| Cache restored successfully` / `| Cache restored from key: ...` —
//     cache HIT (tier-2 cumpriu o papel sem cair no download).
//   - `| Cache not found for input keys: ...` — cache MISS (tier-3 em seguida).
//   - `⬇  Skip - Main Restore Bun release from cache` — o step NÃO rodou
//     (tier-1 engajou). N/A por default (PASS com nota); com
//     --require-engagement vira FAIL (o job esperava medir o tier-2).
//
// Usage:
//   node scripts/check-tier2-cache-restore.mjs --log <act-log> [--threshold <s>] [--require-engagement]
//
// Exit codes:
//   0 — PASS (duração ≤ threshold, ou N/A quando o step não rodou)
//   1 — FAIL (duração > threshold, INCONCLUSIVO, ou --require-engagement sem engajamento)
//   2 — uso inválido (--log obrigatório, --threshold > 0)
//
// Saída: relatório + exit code (0 = PASS, 1 = FAIL, 2 = uso inválido).
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { extractDurationFromLine } from "./check-setup-bun-common.mjs"

// ---------------------------------------------------------------------------
// Helpers puros (exportados para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Extrai do log do act a evidência do tier-2 (cache restore):
 *   { cacheRestoreDurationSeconds, cacheRestoreEngaged, cacheRestoreSkipped,
 *     cacheHit, cacheMiss, compositeDurationSeconds }
 * Campos ausentes ficam como null/false (nunca lança).
 */
export function extractCacheRestoreEvidence(logText) {
  const lines = String(logText).split(/\r?\n/)
  const successLine = lines.find((l) => l.includes("Success - Main Restore Bun release from cache"))
  const skipLine = lines.find((l) => l.includes("Skip - Main Restore Bun release from cache"))
  const compositeLine = lines.find((l) => l.includes("Success - Main ./.github/actions/setup-bun"))
  return {
    cacheRestoreDurationSeconds: successLine ? extractDurationFromLine(successLine) : null,
    cacheRestoreEngaged: Boolean(successLine),
    cacheRestoreSkipped: Boolean(skipLine) && !successLine,
    cacheHit: lines.some((l) => l.includes("Cache restored successfully")),
    cacheMiss: lines.some((l) => l.includes("Cache not found for input keys")),
    compositeDurationSeconds: compositeLine ? extractDurationFromLine(compositeLine) : null,
  }
}

/**
 * Verdict do guard. Recebe o texto do log + opções e devolve
 * { pass, reasons, ...evidencia, thresholdSeconds, requireEngagement }.
 *
 * Regras (falha se QUALQUER uma):
 *   1. cache restore engajou e duração > thresholdSeconds
 *   2. cache restore engajou mas duração não encontrada → INCONCLUSIVO
 *   3. --require-engagement ativo e o step não rodou (skip ou ausente)
 *   4. step ausente (nem success nem skip) e SEM --require-engagement →
 *      INCONCLUSIVO (job falhou antes do setup-bun ou passo renomeado)
 *
 * OBS: quando o step foi SKIPPED (tier-1 engajou) e --require-engagement está
 * OFF (default), o verdict é PASS com nota — é o comportamento esperado do
 * setup-bun na imagem custom (não há cache restore para medir).
 *
 * @param {string} logText
 * @param {{thresholdSeconds?: number, requireEngagement?: boolean}} [options]
 * @returns {{
 *   pass: boolean,
 *   reasons: string[],
 *   cacheRestoreDurationSeconds: number | null,
 *   cacheRestoreEngaged: boolean,
 *   cacheRestoreSkipped: boolean,
 *   cacheHit: boolean,
 *   cacheMiss: boolean,
 *   compositeDurationSeconds: number | null,
 *   thresholdSeconds: number,
 *   requireEngagement: boolean,
 * }}
 */
export function checkTier2CacheRestore(
  logText,
  { thresholdSeconds = 5, requireEngagement = false } = {},
) {
  const ev = extractCacheRestoreEvidence(logText)
  const reasons = []

  if (!ev.cacheRestoreEngaged) {
    if (requireEngagement) {
      reasons.push(
        ev.cacheRestoreSkipped
          ? "tier-2 NÃO engajou — step 'Restore Bun release from cache' foi SKIPPED (tier-1 usou o fast path) e --require-engagement está ativo"
          : "tier-2 NÃO engajou — step 'Restore Bun release from cache' AUSENTE do log e --require-engagement está ativo",
      )
    } else if (!ev.cacheRestoreSkipped) {
      reasons.push(
        "step 'Restore Bun release from cache' AUSENTE do log — INCONCLUSIVO (job falhou antes do setup-bun ou passo renomeado/removido)",
      )
    }
  } else if (ev.cacheRestoreDurationSeconds === null) {
    reasons.push(
      "duração do passo 'Restore Bun release from cache' não encontrada na linha de success — INCONCLUSIVO (passo renomeado ou duração não reportada)",
    )
  } else if (ev.cacheRestoreDurationSeconds > thresholdSeconds) {
    reasons.push(
      `cache restore ${ev.cacheRestoreDurationSeconds.toFixed(3)}s > threshold ${thresholdSeconds}s`,
    )
  }

  return {
    pass: reasons.length === 0,
    reasons,
    cacheRestoreDurationSeconds: ev.cacheRestoreDurationSeconds,
    cacheRestoreEngaged: ev.cacheRestoreEngaged,
    cacheRestoreSkipped: ev.cacheRestoreSkipped,
    cacheHit: ev.cacheHit,
    cacheMiss: ev.cacheMiss,
    compositeDurationSeconds: ev.compositeDurationSeconds,
    thresholdSeconds,
    requireEngagement,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node scripts/check-tier2-cache-restore.mjs --log <act-log> [--threshold <s>] [--require-engagement]

  --log                 (obrigatório) arquivo com o output do act (job que usa setup-bun)
  --threshold           duração máxima do passo de cache restore em segundos (default: 5)
  --require-engagement  falha se o step de cache restore não rodar (default: N/A quando skip)
  -h, --help            mostra esta ajuda

Exit codes: 0 = PASS, 1 = FAIL, 2 = uso inválido`

/**
 * Faz parse dos args da CLI.
 *
 * @param {string[]} argv
 * @returns {{
 *   log?: string | null,
 *   threshold?: number,
 *   requireEngagement?: boolean,
 *   error?: string,
 *   help?: boolean,
 * }}
 */
export function parseArgs(argv) {
  const out = { log: null, threshold: 5, requireEngagement: false }
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
      case "--require-engagement":
        out.requireEngagement = true
        break
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
  const result = checkTier2CacheRestore(logText, {
    thresholdSeconds: args.threshold,
    requireEngagement: args.requireEngagement,
  })

  console.log("=== Tier-2 Cache Restore Guard (setup-bun) ===")
  console.log(
    `  cache restore:        ${result.cacheRestoreDurationSeconds === null ? "não medido" : `${result.cacheRestoreDurationSeconds.toFixed(3)}s`}`,
  )
  console.log(
    `  status do step:       ${result.cacheRestoreEngaged ? "ENGAGED" : result.cacheRestoreSkipped ? "SKIPPED (tier-1)" : "AUSENTE"}`,
  )
  console.log(
    `  cache:                ${result.cacheHit ? "HIT ✅" : result.cacheMiss ? "MISS (tier-3 em seguida)" : "indeterminado"}`,
  )
  console.log(
    `  composite setup-bun:  ${result.compositeDurationSeconds === null ? "não encontrado" : `${result.compositeDurationSeconds.toFixed(3)}s`} (informativo — inclui overhead do act)`,
  )
  console.log(`  threshold:           ${result.thresholdSeconds}s`)
  if (result.requireEngagement) console.log(`  require-engagement:  sim`)

  if (result.pass) {
    console.log("✅ PASS — tier-2 cache restore dentro do threshold (ou N/A sem engajamento).")
    process.exit(0)
  }
  console.error("❌ FAIL — regressão do tier-2 (cache restore):")
  for (const r of result.reasons) console.error(`   - ${r}`)
  process.exit(1)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
