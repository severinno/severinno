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
//   - a duração do passo 'Use pre-installed Bun (fast path)' > threshold, OU
//   - o log mostrar engajamento EXPLÍCITO de tier-2 (cache restore) ou
//     tier-3 (download) — cobre a regressão que MUDA o tier mas MANTÉM o
//     marcador tier-1 no log (ex.: echo do marcador duplicado/movido).
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
//   node scripts/check-tier1-fastpath.mjs --log <act-log> [--threshold <s>] [--version <v>] [--act-exit <code>]
//
// Exit codes:
//   0 — PASS (tier-1 engajado e dentro do threshold)
//   1 — FAIL (regressão do tier-1: marker ausente, lento, drift de versão,
//       tier-2/3 explícito, OU act falhou antes do setup-bun)
//   2 — uso inválido (--log obrigatório, --threshold > 0)
//
// Semântica do --act-exit (exit code do act, capturado no step 'Run act' como
// steps.act.outputs.ACT_EXIT):
//   - act exit != 0 E SEM evidência do setup-bun no log → act falhou ANTES do
//     setup-bun (ex.: imagem não publicada, erro de infra, setup do job) →
//     FAIL com diagnóstico claro (regra 7).
//   - act exit != 0 MAS com evidência do setup-bun → act falhou DEPOIS (suite
//     completa do job check: bun install/prisma/lint/tsc/testes) — a evidência
//     existe e o guard decide por ela (mesma semântica do periódico).
//
// Saída: relatório + exit code (0 = PASS, 1 = FAIL, 2 = uso inválido).
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { extractDurationFromLine } from "./check-setup-bun-common.mjs"

// ---------------------------------------------------------------------------
// Helpers puros (exportados para teste unitário)
// ---------------------------------------------------------------------------

// extractDurationFromLine vive em check-setup-bun-common.mjs (fonte única,
// compartilhada com o check-tier2-cache-restore.mjs). Re-exportada aqui para
// manter o contrato público deste guard e o teste unitário existente.
export { extractDurationFromLine }

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
 * Detecta engajamento EXPLÍCITO dos tiers inferiores no log do act.
 *
 * Além do marcador tier-1, o guard também falha quando o log prova que o
 * setup-bun usou tier-2 (cache restore) ou tier-3 (download) — cobrindo a
 * regressão que MUDA o tier mas MANTÉM o marcador tier-1 no log (ex.: echo
 * do marcador duplicado/movido, ou condição invertida que segue imprimindo
 * o marcador).
 *
 * Marcadores confiáveis (evidência empírica, act 0.2.89, logs não-TTY):
 *   tier-2: 'Success - Main Restore Bun release from cache'
 *   tier-3: 'Success - Main Download Bun release (cold cache)'
 *
 * Por que NÃO usar os grupos internos do action ('Puxando Bun ... do mirror
 * GHCR' / 'Baixando Bun ... do GitHub Releases'): o act 0.2.89 CONSOBE os
 * workflow commands ::group::/::endgroup:: e não os ecoa literalmente em
 * output não-TTY (verificado 08/2026: 0 ocorrências nos logs capturados,
 * mesmo em runs que engajaram cache). Os únicos sinais presentes no log são
 * as linhas 'Success/Skip - Main <step name>', que o act imprime mesmo para
 * steps com if: condicional.
 *
 * NOTA: a linha 'Skip - Main ...' NÃO conta como engajamento (o step não
 * rodou — condição if: false é o comportamento esperado no tier-1).
 *
 * @param {string} logText
 * @returns {{ tier2Engaged: boolean, tier3Engaged: boolean }}
 */
export function extractTierEngagement(logText) {
  const lines = String(logText).split(/\r?\n/)
  let tier2Engaged = false
  let tier3Engaged = false
  for (const line of lines) {
    if (line.includes("Success - Main Restore Bun release from cache")) {
      tier2Engaged = true
    }
    if (line.includes("Success - Main Download Bun release (cold cache)")) {
      tier3Engaged = true
    }
  }
  return { tier2Engaged, tier3Engaged }
}

/**
 * Verdict do guard. Recebe o texto do log + opções e devolve
 * { pass, reasons, ...evidencia, tier2Engaged, tier3Engaged, thresholdSeconds, expectedVersion }.
 *
 * Regras (falha se QUALQUER uma):
 *   1. marcador 'Usando Bun pré-instalado' ausente → tier-1 não engajou
 *   2. duração do passo fast-path ausente → INCONCLUSIVO (não medível)
 *   3. duração do passo fast-path > thresholdSeconds
 *   4. expectedVersion informado e marcador ≠ expectedVersion (drift)
 *   5. tier-2 (cache restore) engajado EXPLICITAMENTE no log
 *   6. tier-3 (download) engajado EXPLICITAMENTE no log
 *   7. actExit informado e != 0 e SEM evidência do setup-bun no log (act
 *      falhou ANTES do setup-bun — imagem não publicada, erro de infra)
 *
 * @param {string} logText
 * @param {{thresholdSeconds?: number, expectedVersion?: string | null, actExit?: number | null}} [options]
 * @returns {{
 *   pass: boolean,
 *   reasons: string[],
 *   markerVersion: string | null,
 *   fastPathDurationSeconds: number | null,
 *   compositeDurationSeconds: number | null,
 *   tier2Engaged: boolean,
 *   tier3Engaged: boolean,
 *   actExit: number | null,
 *   thresholdSeconds: number,
 *   expectedVersion: string | null,
 * }}
 */
export function checkTier1Fastpath(
  logText,
  { thresholdSeconds = 5, expectedVersion = null, actExit = null } = {},
) {
  const ev = extractFastPathEvidence(logText)
  const tiers = extractTierEngagement(logText)
  const reasons = []

  // Evidência de que o setup-bun RODOU no log (qualquer sinal serve): sem ela
  // e com act exit != 0, o act morreu antes do setup-bun (regra 7).
  const setupBunEvidence =
    ev.markerVersion !== null ||
    ev.fastPathDurationSeconds !== null ||
    ev.compositeDurationSeconds !== null ||
    tiers.tier2Engaged ||
    tiers.tier3Engaged

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
  if (tiers.tier2Engaged) {
    reasons.push(
      "tier-2 EXPLÍCITO no log — 'Restore Bun release from cache' engajou (cache restore usado no lugar do fast path pré-instalado)",
    )
  }
  if (tiers.tier3Engaged) {
    reasons.push(
      "tier-3 EXPLÍCITO no log — 'Download Bun release (cold cache)' engajou (download usado no lugar do fast path pré-instalado)",
    )
  }
  if (typeof actExit === "number" && actExit !== 0 && !setupBunEvidence) {
    reasons.push(
      `act exit code ${actExit} ≠ 0 e SEM evidência do setup-bun no log — act falhou ANTES do setup-bun (imagem ghcr.io/<owner>/ubuntu-bun não publicada/disponível? erro de infra no job? veja o log do act)`,
    )
  }

  return {
    pass: reasons.length === 0,
    reasons,
    markerVersion: ev.markerVersion,
    fastPathDurationSeconds: ev.fastPathDurationSeconds,
    compositeDurationSeconds: ev.compositeDurationSeconds,
    tier2Engaged: tiers.tier2Engaged,
    tier3Engaged: tiers.tier3Engaged,
    actExit,
    thresholdSeconds,
    expectedVersion,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node scripts/check-tier1-fastpath.mjs --log <act-log> [--threshold <s>] [--version <v>] [--act-exit <code>]

  --log        (obrigatório) arquivo com o output do act (job que usa setup-bun)
  --threshold  duração máxima do passo fast-path em segundos (default: 5)
  --version    versão esperada do bun (default: nenhum — não checa drift)
  --act-exit   exit code do act (steps.act.outputs.ACT_EXIT). != 0 sem evidência
               do setup-bun = act falhou antes do setup-bun → FAIL (regra 7)
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
 *   actExit?: number | null,
 *   error?: string,
 *   help?: boolean,
 * }}
 */
export function parseArgs(argv) {
  const out = { log: null, threshold: 5, version: null, actExit: null }
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
      case "--act-exit": {
        // Valida o RAW string antes de parseInt: parseInt("1.5") === 1 passaria
        // a checagem de inteiro — o regex /^\d+$/ rejeita frações, negativos
        // e não-numéricos de forma correta e cobre o caso sem valor.
        const raw = argv[++i]
        if (raw === undefined) return { error: `--act-exit exige um valor` }
        if (!/^\d+$/.test(raw))
          return { error: `--act-exit deve ser um inteiro >= 0 (obtido: '${raw}')` }
        out.actExit = parseInt(raw, 10)
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
    actExit: args.actExit,
  })

  console.log("=== Tier-1 Fastpath Guard (setup-bun) ===")
  console.log(`  marcador tier-1:     ${result.markerVersion ?? "AUSENTE"}`)
  console.log(
    `  passo fast-path:      ${result.fastPathDurationSeconds === null ? "não encontrado" : `${result.fastPathDurationSeconds.toFixed(3)}s`}`,
  )
  console.log(
    `  composite setup-bun:  ${result.compositeDurationSeconds === null ? "não encontrado" : `${result.compositeDurationSeconds.toFixed(3)}s`} (informativo — inclui overhead do act)`,
  )
  console.log(`  tier-2 (cache):       ${result.tier2Engaged ? "ENGAGED ❌" : "não engajado"}`)
  console.log(`  tier-3 (download):    ${result.tier3Engaged ? "ENGAGED ❌" : "não engajado"}`)
  console.log(
    `  act exit:            ${result.actExit === null ? "não informado" : result.actExit}`,
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
