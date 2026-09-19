#!/usr/bin/env node
// =============================================================================
// check-tier1-fastpath.mjs — guard periódico do tier-1 fast path do setup-bun
//
// POR QUE EXISTE: scripts/setup-bun-ci.sh (o setup é um SCRIPT chamado por
// run:, não mais um composite action) tem 3 tiers:
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
//   - a duração do passo 'Setup Bun' (que roda o script) > threshold, OU
//   - o log mostrar engajamento EXPLÍCITO de tier-2 (cache restore) ou
//     tier-3 (download) — cobre a regressão que MUDA o tier mas MANTÉM o
//     marcador tier-1 no log (ex.: echo do marcador duplicado/movido), OU
//   - (--tier2) a duração do passo 'Restore Bun cache' >
//     threshold — cobre o cenário catthehacker default, onde o act EMULA
//     o actions/cache (~21s medidos em 08/2026) e o tier-1 nem engaja.
//
// ATENÇÃO (evidência empírica, act 0.2.89): a linha
//   `Success - Main Setup Bun [X.XXs]` (duração do step que roda o script)
//   inclui o overhead próprio do act (30.5s cold / 11s warm medidos em
//   08/2026, mesmo com o tier-1 engajado) e por isso é INFORMATIVO. Os sinais
//   confiáveis são:
//   - `| ✅ Usando Bun pré-instalado: <versão> (0s, sem download)`
//   - `✅  Success - Main Setup Bun [<dur>ms]` (com o tier-1 engajado o
//     script sai na PRIMEIRA checagem, então esta duração É o fast path)
//   O total do setup é o mesmo step, reportado apenas como informativo.
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
 *   { markerVersion, fastPathDurationSeconds, compositeDurationSeconds,
 *     tier2RestoreDurationSeconds }
 * Campos ausentes ficam como null (nunca lança).
 *
 * `fastPathDurationSeconds` é a duração do step 'Setup Bun' APENAS quando o
 * marcador tier-1 está no log (fast path engajado); sem o marcador é null — o
 * step existe em todo run e a duração dele não é do fast path.
 *
 * `compositeDurationSeconds` mantém o nome por compatibilidade com
 * scripts/bench-setup-bun.mjs e check-tier2-cache-restore.mjs, mas com o setup
 * em UM step (o script) ele é a duração DESSE step (total do setup).
 */
export function extractFastPathEvidence(logText) {
  const lines = String(logText).split(/\r?\n/)
  const markerLine = lines.find((l) => l.includes("Usando Bun pré-instalado:"))
  const markerVersion = markerLine ? parseMarkerVersion(markerLine) : null
  // O setup é UM step (`Setup Bun`), que roda scripts/setup-bun-ci.sh. Com o
  // tier-1 engajado o script sai na PRIMEIRA checagem (bun já no PATH), então
  // a duração deste step É a evidência de fast path. O antigo step interno do
  // composite ('Use pre-installed Bun (fast path)') deixou de existir quando o
  // setup saiu do composite para o script — o step agora é 'Setup Bun'.
  // Mesma evidência, outro endereço.
  const setupLine = lines.find((l) => l.includes("Success - Main Setup Bun"))
  // Passo do tier-2 (cache restore) — presente no cenário catthehacker default
  // (act EMULA o actions/cache) e quando o tier-1 não engaja. O nome do step é
  // o do par canônico do repo (`name: Restore Bun cache`).
  const tier2RestoreLine = lines.find((l) => l.includes("Success - Main Restore Bun cache"))
  return {
    markerVersion,
    // A duração do step SÓ é o fast path quando o MARCADOR do tier-1 está no
    // log. O step existe em QUALQUER run (cache/mirror/download) — reportar a
    // duração dele como "fast path" faria o threshold comparar uma medida que
    // não é do fast path (ex.: 30s de download viravam "fast path lento").
    fastPathDurationSeconds: markerVersion && setupLine ? extractDurationFromLine(setupLine) : null,
    // Total do setup = o mesmo step (não há mais "total do composite"):
    // informativo, inclui o overhead do act.
    compositeDurationSeconds: setupLine ? extractDurationFromLine(setupLine) : null,
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
 * Marcadores confiáveis (saída do PRÓPRIO script — é ele quem escolhe a
 * camada, e as linhas abaixo são `echo` simples, que o act ecoa sempre):
 *   tier-2: '✅ Bun do cache: <versão> (sem download)'
 *   tier-3: '✅ Mirror OCI ok — bun <versão>' (mirror) OU
 *           'releases/download/bun-v<versão>' (download direto do release)
 *
 * Por que NÃO usar o nome do step de cache ('Success - Main Restore Bun
 * cache'): com o setup em um `run:`, o actions/cache é um step de PRIMEIRO
 * NÍVEL do job e RODA SEMPRE — a linha de success dele não prova que a
 * camada de cache foi usada, só que o step rodou. Quem sabe a camada é o
 * script. (Medir a DURAÇÃO desse step continua sendo o papel do
 * check-tier2-cache-restore.mjs.)
 *
 * Por que NÃO usar os títulos de grupo ('::group::Baixando ...'): o act
 * 0.2.89 CONSOBE os workflow commands ::group::/::endgroup:: e não os ecoa
 * literalmente em output não-TTY (verificado 08/2026). A linha 'URL: ...' do
 * download é `echo` simples e sobrevive.
 *
 * @param {string} logText
 * @returns {{ tier2Engaged: boolean, tier3Engaged: boolean }}
 */
export function extractTierEngagement(logText) {
  const lines = String(logText).split(/\r?\n/)
  let tier2Engaged = false
  let tier3Engaged = false
  for (const line of lines) {
    if (line.includes("Bun do cache:")) {
      tier2Engaged = true
    }
    if (line.includes("Mirror OCI ok") || line.includes("releases/download/bun-v")) {
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
 *   8. tier2ThresholdSeconds informado e o step 'Restore Bun cache' RODOU com
 *      duração > threshold (cache EMULADO do act lento —
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
    // Dois casos distintos, para a razão apontar a causa certa:
    //   - marcador presente + sem linha do step → o passo foi renomeado/removido;
    //   - nada do setup-bun no log → o job falhou ANTES dele.
    // Com o marcador ausente MAS outra evidência presente (cache/download), as
    // regras 1/5/6 já explicam o FAIL — nada a duplicar aqui.
    if (ev.markerVersion !== null) {
      reasons.push(
        "marcador tier-1 presente mas duração do passo 'Setup Bun' não encontrada no log — INCONCLUSIVO (passo renomeado/removido)",
      )
    } else if (!setupBunEvidence) {
      reasons.push(
        "nenhuma evidência do setup-bun no log — INCONCLUSIVO (job falhou antes do setup-bun)",
      )
    }
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
      "tier-2 EXPLÍCITO no log — o script usou 'Bun do cache' (camada de cache usada no lugar do fast path pré-instalado)",
    )
  }
  if (tiers.tier3Engaged) {
    reasons.push(
      "tier-3 EXPLÍCITO no log — o script baixou o Bun do mirror/release (download usado no lugar do fast path pré-instalado)",
    )
  }
  if (typeof actExit === "number" && actExit !== 0 && !setupBunEvidence) {
    reasons.push(
      `act exit code ${actExit} ≠ 0 e SEM evidência do setup-bun no log — act falhou ANTES do setup-bun (imagem ghcr.io/<owner>/ubuntu-bun não publicada/disponível? erro de infra no job? veja o log do act)`,
    )
  }
  // Regra 8 — threshold do step de cache (tier-2 emulado). Dispara quando o
  // step RODOU e a duração é mensurável: no cenário catthehacker default
  // (~21s) o act EMULA o actions/cache e o tier-1 nem engaja, então esta regra
  // adiciona o sinal QUANTITATIVO; com a imagem custom o step é skipped/barato
  // e a regra não dispara.
  //
  // POR QUE NÃO exigir tier2Engaged: o step de cache é de PRIMEIRO NÍVEL do
  // job (roda sem `if:`), então a linha de success dele não indica engajamento
  // da CAMADA — quem indica é o marcador do script ('Bun do cache:'). Medir a
  // DURAÇÃO do step, porém, vale sempre que ele rodou: é o custo real do
  // cache no job. (Quando o step é skipped/não existe, a duração é null e a
  // regra fica SILENCIOSA — não há o que comparar.)
  if (
    tier2ThresholdSeconds !== null &&
    ev.tier2RestoreDurationSeconds !== null &&
    ev.tier2RestoreDurationSeconds > tier2ThresholdSeconds
  ) {
    reasons.push(
      `cache emulado (tier-2) ${ev.tier2RestoreDurationSeconds.toFixed(3)}s > threshold ${tier2ThresholdSeconds}s — step 'Restore Bun cache' lento (act emula o actions/cache)`,
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
               nenhum — não checa). Falha quando o step 'Restore Bun cache'
               roda com duração > threshold (cenário catthehacker
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
