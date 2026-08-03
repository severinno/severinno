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
//     marcador tier-1 no log (ex.: echo do marcador duplicado/movido), OU
//   - (--tier2) a duração do passo 'Restore Bun release from cache' >
//     threshold — cobre o cenário catthehacker default, onde o act EMULA
//     o actions/cache (~21s medidos em 08/2026) e o tier-1 nem engaja.
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
//   node scripts/check-tier1-fastpath.mjs --log <act-log> [--threshold <s>] [--version <v>] [--act-exit <code>] [--tier2 <s>]
//
// Exit codes:
//   0 — PASS (tier-1 engajado e dentro do threshold)
//   1 — FAIL (regressão do tier-1: marker ausente, lento, drift de versão,
//       tier-2/3 explícito, cache emulado lento (--tier2), OU act falhou
//       antes do setup-bun)
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
  // Passo do tier-2 (cache restore) — presente no cenário catthehacker default
  // (act EMULA o actions/cache, ~21s medidos em 08/2026) e quando o tier-1
  // não engaja. Mede a duração para o --tier2 (regra 8).
  const tier2RestoreLine = lines.find((l) =>
    l.includes("Success - Main Restore Bun release from cache"),
  )
  return {
    markerVersion: markerLine ? parseMarkerVersion(markerLine) : null,
    fastPathDurationSeconds: fastPathLine ? extractDurationFromLine(fastPathLine) : null,
    compositeDurationSeconds: compositeLine ? extractDurationFromLine(compositeLine) : null,
    tier2RestoreDurationSeconds: tier2RestoreLine
      ? extractDurationFromLine(tier2RestoreLine)
      : null,
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
 *   8. tier2ThresholdSeconds informado e o passo 'Restore Bun release from
 *      cache' engajou com duração > threshold (cache EMULADO do act lento —
 *      cenário catthehacker default, ~21s; a regra NÃO dispara quando o
 *      tier-2 não rodou, ex.: tier-1 engajou na imagem custom)
 *
 * @param {string} logText
 * @param {{thresholdSeconds?: number, expectedVersion?: string | null, actExit?: number | null, tier2ThresholdSeconds?: number | null}} [options]
 * @returns {{
 *   pass: boolean,
 *   reasons: string[],
 *   markerVersion: string | null,
 *   fastPathDurationSeconds: number | null,
 *   compositeDurationSeconds: number | null,
 *   tier2RestoreDurationSeconds: number | null,
 *   tier2Engaged: boolean,
 *   tier3Engaged: boolean,
 *   actExit: number | null,
 *   thresholdSeconds: number,
 *   tier2ThresholdSeconds: number | null,
 *   expectedVersion: string | null,
 * }}
 */
export function checkTier1Fastpath(
  logText,
  {
    thresholdSeconds = 5,
    expectedVersion = null,
    actExit = null,
    tier2ThresholdSeconds = null,
  } = {},
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
  // Regra 8 — threshold do cache EMULADO (tier-2). Só dispara quando o passo
  // RODOU e a duração é mensurável: no cenário catthehacker default (~21s) o
  // tier-1 nem engaja (regra 1/5 já falham) e esta regra adiciona o sinal
  // QUANTITATIVO do cache emulado; na imagem custom o tier-2 é skipped e a
  // regra não dispara (N/A — a regra 1 é quem garante o contrato tier-1).
  //
  // NOTA DE SEMÂNTICA: a regra 8 NUNCA muda o verdict sozinha — ela exige
  // tier2Engaged=true, e a regra 5 já falha em QUALQUER engajamento do
  // tier-2 (e a regra 1 no caso catthehacker, marker ausente). --tier2 é um
  // DIAGNÓSTICO QUANTITATIVO adicional (a razão específica do cache lento),
  // não um novo modo de falha independente. Tier-2 "aceitável quando rápido"
  // exigiria relaxar a regra 5 — deliberadamente NÃO feito aqui.
  if (
    tier2ThresholdSeconds !== null &&
    tiers.tier2Engaged &&
    // tier-2 engajado mas duração não encontrada → regra 8 SILENCIOSA de
    // propósito: a regra 5 já falha (tier-2 explícito); sem duração não há
    // o que comparar com o threshold.
    ev.tier2RestoreDurationSeconds !== null &&
    ev.tier2RestoreDurationSeconds > tier2ThresholdSeconds
  ) {
    reasons.push(
      `cache emulado (tier-2) ${ev.tier2RestoreDurationSeconds.toFixed(3)}s > threshold ${tier2ThresholdSeconds}s — 'Restore Bun release from cache' lento (act emula o actions/cache)`,
    )
  }

  return {
    pass: reasons.length === 0,
    reasons,
    markerVersion: ev.markerVersion,
    fastPathDurationSeconds: ev.fastPathDurationSeconds,
    compositeDurationSeconds: ev.compositeDurationSeconds,
    tier2RestoreDurationSeconds: ev.tier2RestoreDurationSeconds,
    tier2Engaged: tiers.tier2Engaged,
    tier3Engaged: tiers.tier3Engaged,
    actExit,
    thresholdSeconds,
    tier2ThresholdSeconds,
    expectedVersion,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node scripts/check-tier1-fastpath.mjs --log <act-log> [--threshold <s>] [--version <v>] [--act-exit <code>] [--tier2 <s>]

  --log        (obrigatório) arquivo com o output do act (job que usa setup-bun)
  --threshold  duração máxima do passo fast-path em segundos (default: 5)
  --version    versão esperada do bun (default: nenhum — não checa drift)
  --act-exit   exit code do act (steps.act.outputs.ACT_EXIT). != 0 sem evidência
               do setup-bun = act falhou antes do setup-bun → FAIL (regra 7)
  --tier2      threshold do cache EMULADO (tier-2) em segundos (default:
               nenhum — não checa). Falha quando 'Restore Bun release from
               cache' engaja com duração > threshold (cenário catthehacker
               default, ~21s medidos; N/A quando o tier-2 não rodou)
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
 *   tier2?: number | null,
 *   error?: string,
 *   help?: boolean,
 * }}
 */
export function parseArgs(argv) {
  const out = { log: null, threshold: 5, version: null, actExit: null, tier2: null }
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
      case "--tier2": {
        // Valida o RAW string antes de parseFloat (mesmo padrão do --act-exit):
        // parseFloat("15abc") === 15 passaria a checagem de finite/>0 em
        // silêncio — o regex /^\d+(\.\d+)?$/ rejeita sufixo não-numérico,
        // e o `Number(raw) <= 0` rejeita "0"/"0.0" (o regex os ACEITARIA).
        const raw = argv[++i]
        if (raw === undefined) return { error: `--tier2 exige um valor` }
        if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0)
          return { error: `--tier2 deve ser um número > 0 (obtido: '${raw}')` }
        out.tier2 = parseFloat(raw)
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
    tier2ThresholdSeconds: args.tier2,
  })

  console.log("=== Tier-1 Fastpath Guard (setup-bun) ===")
  console.log(`  marcador tier-1:     ${result.markerVersion ?? "AUSENTE"}`)
  console.log(
    `  passo fast-path:      ${result.fastPathDurationSeconds === null ? "não encontrado" : `${result.fastPathDurationSeconds.toFixed(3)}s`}`,
  )
  console.log(
    `  composite setup-bun:  ${result.compositeDurationSeconds === null ? "não encontrado" : `${result.compositeDurationSeconds.toFixed(3)}s`} (informativo — inclui overhead do act)`,
  )
  console.log(
    `  tier-2 (cache):       ${result.tier2Engaged ? "ENGAGED ❌" : "não engajado"}${result.tier2RestoreDurationSeconds === null ? "" : ` — restore ${result.tier2RestoreDurationSeconds.toFixed(3)}s`}`,
  )
  console.log(`  tier-3 (download):    ${result.tier3Engaged ? "ENGAGED ❌" : "não engajado"}`)
  console.log(
    `  act exit:            ${result.actExit === null ? "não informado" : result.actExit}`,
  )
  console.log(`  threshold:           ${result.thresholdSeconds}s`)
  if (result.tier2ThresholdSeconds !== null)
    console.log(`  threshold tier-2:    ${result.tier2ThresholdSeconds}s`)
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
