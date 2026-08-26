#!/usr/bin/env node

// =============================================================================
// measure-mutation-trend.mjs
//
// Guard de TENDÊNCIA (semanal, benchmark-scheduled.yml — job mutation-coord-trend)
// que compara o tempo do step 'Run mutation test (contrato coordenado — 5
// cenários, 2 elos)' do run ATUAL contra a MEDIANA dos N runs ANTERIORES do
// MESMO step — emitindo ::warning:: quando o drift relativo passar de X%.
//
// Por que existe: o gate duro (--max 240 do measure-mutation-timing.mjs)
// falha SÓ quando o step JÁ estourou o budget. Uma regressão LENTA (ex.: o
// contrato coordenado ganhou um cenário a cada release e foi de 40s → 55s →
// 75s → 90s) passa silenciosamente por MESES até cruzar 240s — quando o
// custo por PR já triplicou. Este guard mede a DERIVADA: drift relativo do
// run atual vs a mediana dos últimos runs = tendência de overhead ANTES do
// gate duro disparar (rede de segurança periódica, não-bloqueante — o
// ::warning:: alerta o run sem falhar o CI).
//
// Reusa as funções PURAS do medidor (extractMutationStep, computeDurationSecs
// via ./measure-mutation-timing.mjs) — a MESMA fonte de extração do tempo do
// step, sem duplicação de parse. O gh usa o GITHUB_TOKEN do próprio Actions
// (autenticado automaticamente), como os demais jobs de medição.
//
// Mediana (não média): imune a outliers (um run com runner lento de 200s não
// distorce a tendência — a mediana dos 4 anteriores continua no centro).
//
// Usage:
//   node scripts/measure-mutation-trend.mjs --run <id> --repo owner/repo [--window 4] [--max-drift 30] [--json OUT]
//   node scripts/measure-mutation-trend.mjs --jobs-file FILE --history-file FILE [--window 4] [--max-drift 30] [--json OUT]
//
// Exit codes:
//   0 — tendência medida (drift dentro do limiar OU acima com ::warning:: —
//       o alerta NÃO falha o CI, é rede de segurança periódica)
//   1 — infra: gh indisponível / payload inválido / sem histórico suficiente
//   2 — step atual não encontrado OU duração inválida (0s/NaN — data quebrada
//       da API): drift de contrato (renomearam o step) OU dado ruim
//
// Modos:
//   --run ID           spawna o gh para buscar os jobs do run ATUAL
//                      (GH_TOKEN do env) E a lista dos runs anteriores
//                      (gh run list --workflow benchmark-scheduled.yml)
//   --jobs-file FILE   payload da jobs API do run atual (modo de TESTE —
//                      fixtures determinísticos, sem gh)
//   --history-file FILE  JSON de { runs: [{ runId, durationSecs }] } dos runs
//                      ANTERIORES (modo de TESTE — fixtures; em produção o
//                      gh monta isso de gh run list + jobs API por run)
//   --window N         quantos runs anteriores entram na mediana (default 4)
//   --max-drift PCT    limiar de drift relativo % (default 30): drift > PCT
//                      emite ::warning:: (NÃO-bloqueante)
//   --json OUT         salva o relatório JSON em OUT (além do stdout)
//   -h, --help         mostra esta ajuda
//
// Relatório JSON (stdout / --json):
//   {
//     runId, repo, window, maxDriftPct,
//     current: { found: true, durationSecs },
//     history: [ { runId, durationSecs } ],   // N anteriores (mais recentes primeiro)
//     medianSecs,                             // mediana dos anteriores
//     driftPct,                               // (current - median) / median * 100
//     warned: true                            // driftPct > maxDriftPct (::warning:: emitido)
//   }
// Em erro: { runId, repo, found: false, error: '<mensagem>' }
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import {
  extractMutationStep,
  computeDurationSecs,
  computeMedian,
  buildRunListJq,
  fetchHistoryDurationsViaGh,
} from "./measure-mutation-timing.mjs"

// ── Helpers puros (exportados para testes) ────────────────────────────────
// computeMedian/buildRunListJq/fetchHistoryDurationsViaGh agora vivem no
// MEDIDOR (measure-mutation-timing.mjs) — a MESMA fonte da derivação da faixa
// soft (--warn-median). Re-export aqui para os testes do trend continuarem
// importando do lugar de sempre (compat) e para não existirem DUAS cópias da
// lógica de mediana/jq/histórico.

export { computeMedian, buildRunListJq }

/**
 * Drift relativo % do run atual vs a mediana dos anteriores.
 * `(current - median) / median * 100` — positivo = mais lento.
 * Mediana null/0 → null (sem histórico suficiente para calcular tendência).
 *
 * @param {number} currentSecs
 * @param {number | null} medianSecs
 * @returns {number | null}
 */ export function computeDriftPct(currentSecs, medianSecs) {
  if (
    typeof currentSecs !== "number" ||
    !Number.isFinite(currentSecs) ||
    currentSecs <= 0 ||
    typeof medianSecs !== "number" ||
    !Number.isFinite(medianSecs) ||
    medianSecs <= 0
  )
    return null
  return ((currentSecs - medianSecs) / medianSecs) * 100
}

/**
 * Extrai a duração do step de mutation de um payload da jobs API — delega ao
 * medidor (extractMutationStep + computeDurationSecs, a MESMA fonte do gate).
 *
 * @param {unknown} jobsPayload payload de gh api repos/X/actions/runs/<id>/jobs
 * @returns {{ durationSecs: number } | null} null quando o step não é achado
 */
export function extractStepDurationFromJobsPayload(jobsPayload) {
  const step = extractMutationStep(jobsPayload)
  if (!step) return null
  return { durationSecs: computeDurationSecs(step.startedAt, step.completedAt) }
}

/**
 * @typedef {{
 *   runId: string, repo: string, window: number, maxDriftPct: number,
 *   current: { found: boolean, durationSecs?: number },
 *   history: { runId: string | number, durationSecs: number }[],
 *   medianSecs: number | null,
 *   driftPct: number | null,
 *   warned: boolean,
 * }} TrendReport
 */

/**
 * Monta o relatório de tendência: mediana dos anteriores + drift % + veredito.
 *
 * @param {{
 *   current: { found: boolean, durationSecs?: number },
 *   history: { runId: string | number, durationSecs: number }[],
 *   window: number,
 *   maxDriftPct: number,
 *   runId?: string, repo?: string,
 * }} input
 * @returns {TrendReport} relatório completo (warned = driftPct > maxDriftPct)
 */ export function buildTrendReport(input) {
  // Duração do run ATUAL válida = número finito > 0. O medidor devolve 0 para
  // datas quebradas (computeDurationSecs retorna 0 quando o parse falha — o
  // mínimo real é 1s), então um current 0s = dado ruim da API: FAIL-CLOSED
  // (vira found:false → exit 2), nunca um '-100% saudável' mudo.
  const currentValid =
    input.current.found &&
    typeof input.current.durationSecs === "number" &&
    Number.isFinite(input.current.durationSecs) &&
    input.current.durationSecs > 0
  const report = {
    runId: input.runId ?? "fixture",
    repo: input.repo ?? "unknown/unknown",
    window: input.window,
    maxDriftPct: input.maxDriftPct,
    current: currentValid ? input.current : { found: false },
    // Só durações FINITAS entram na mediana — um NaN de data quebrada (API
    // ruim) não pode envenenar o sort nem virar 'NaN%' no alerta.
    history: input.history.filter((h) => Number.isFinite(h.durationSecs)).slice(0, input.window),
  }
  const medianSecs = computeMedian(report.history.map((h) => h.durationSecs))
  report.medianSecs = medianSecs
  report.driftPct = currentValid
    ? computeDriftPct(input.current.durationSecs ?? 0, medianSecs)
    : null
  report.warned = typeof report.driftPct === "number" && report.driftPct > input.maxDriftPct
  return report
}

// ── Varredura principal (modo gh real) ───────────────────────────────────

/**
 * Busca a duração do step no run ATUAL via gh (GH_TOKEN do env — Actions).
 *
 * @param {string} runId
 * @param {string} repo
 * @returns {{ durationSecs: number } | { error: string } | null}
 *   null = step não achado (drift de contrato — exit 2)
 */
function fetchCurrentViaGh(runId, repo) {
  const res = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, "--jq", "."],
    { encoding: "utf8", timeout: 60_000 },
  )
  if (res.error) return { error: `gh indisponível: ${res.error.message}` }
  if (res.status !== 0) {
    return {
      error: `gh api jobs falhou (exit ${res.status}): ${(res.stderr ?? "").trim().slice(0, 300)}`,
    }
  }
  let payload
  try {
    payload = JSON.parse(res.stdout)
  } catch (e) {
    return { error: `payload de jobs inválido do gh: ${e.message}` }
  }
  return extractStepDurationFromJobsPayload(payload)
}

/**
 * Busca as durações dos N runs ANTERIORES do workflow benchmark-scheduled.yml —
 * DELEGA ao medidor (fetchHistoryDurationsViaGh, a MESMA fonte do
 * --warn-median): gh run list (jq compartilhado buildRunListJq, exclui o run
 * atual + só runs completed) + jobs API por run. Runs onde o step não apareceu
 * (falhou antes do step / contrato antigo) não entram na mediana.
 */
function fetchHistoryViaGh(currentRunId, repo, window) {
  return fetchHistoryDurationsViaGh(currentRunId, repo, window)
}

// ── CLI ───────────────────────────────────────────────────────────────────

function usage() {
  process.stdout.write(
    [
      "Uso:",
      "  node scripts/measure-mutation-trend.mjs --run <id> --repo owner/repo [--window N] [--max-drift PCT] [--json OUT]",
      "  node scripts/measure-mutation-trend.mjs --jobs-file FILE --history-file FILE [--window N] [--max-drift PCT] [--json OUT]",
      "",
      "Exit codes:",
      "  0 — tendência medida (drift dentro do limiar OU acima com ::warning:: — alerta não-bloqueante)",
      "  1 — infra (gh indisponível / payload inválido / sem histórico suficiente)",
      "  2 — step atual não encontrado OU duração inválida (0s/NaN — data quebrada da API)",
    ].join("\n") + "\n",
  )
}

function parseArgs(argv) {
  const out = {
    run: null,
    repo: process.env.GITHUB_REPOSITORY ?? null,
    jobsFile: null,
    historyFile: null,
    window: 4,
    maxDriftPct: 30,
    json: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--run": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v))
          return { ...out, error: `--run deve ser numérico (obtido: '${v}')` }
        out.run = v
        break
      }
      case "--repo": {
        const v = argv[++i]
        if (v === undefined || !v.includes("/"))
          return { ...out, error: `--repo deve ser owner/repo (obtido: '${v}')` }
        out.repo = v
        break
      }
      case "--jobs-file": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--jobs-file exige um caminho" }
        out.jobsFile = v
        break
      }
      case "--history-file": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--history-file exige um caminho" }
        out.historyFile = v
        break
      }
      case "--window": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1)
          return { ...out, error: `--window deve ser um inteiro >= 1 (obtido: '${v}')` }
        out.window = Number(v)
        break
      }
      case "--max-drift": {
        const v = argv[++i]
        if (v === undefined || !/^\d+(\.\d+)?$/.test(v) || Number(v) < 0)
          return { ...out, error: `--max-drift deve ser um número >= 0 (obtido: '${v}')` }
        out.maxDriftPct = Number(v)
        break
      }
      case "--json": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--json exige um caminho" }
        out.json = v
        break
      }
      case "-h":
      case "--help":
        out.help = true
        break
      default:
        return { ...out, error: `argumento desconhecido: ${argv[i]}` }
    }
  }
  if (out.help) return out
  if (out.jobsFile && out.historyFile) {
    // modo TESTE — fixtures; --run não pode coexistir
    if (out.run)
      return { ...out, error: "--jobs-file/--history-file não podem ser combinados com --run" }
    return out
  }
  if (out.jobsFile || out.historyFile)
    return { ...out, error: "--jobs-file/--history-file exigem os DOIS (par fixture)" }
  if (!out.run)
    return { ...out, error: "exija --run (modo gh) OU --jobs-file + --history-file (modo teste)" }
  return out
}

/** Escreve o relatório em --json (se dado) e no stdout. */
function emit(report, jsonPath) {
  const json = JSON.stringify(report, null, 2)
  process.stdout.write(`${json}\n`)
  if (jsonPath) {
    try {
      writeFileSync(jsonPath, json)
    } catch (e) {
      process.stderr.write(`aviso: não foi possível salvar --json '${jsonPath}': ${e.message}\n`)
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    process.exit(0)
  }
  if (args.error) {
    process.stderr.write(`erro: ${args.error}\n`)
    usage()
    process.exit(2)
  }

  const repo = args.repo ?? "unknown/unknown"
  const runId = args.run ?? "fixture"

  // ── MODO TESTE: fixtures determinísticos (sem gh) ─────────────────────
  if (args.jobsFile && args.historyFile) {
    let currentPayload
    let historyData
    try {
      currentPayload = JSON.parse(readFileSync(args.jobsFile, "utf8"))
      historyData = JSON.parse(readFileSync(args.historyFile, "utf8"))
    } catch (e) {
      const report = { runId, repo, found: false, error: `falha ao ler fixture: ${e.message}` }
      emit(report, args.json)
      process.stderr.write(`erro (infra): ${report.error}\n`)
      process.exit(1)
    }
    const step = extractStepDurationFromJobsPayload(currentPayload)
    const current = step ? { found: true, durationSecs: step.durationSecs } : { found: false }
    const history = Array.isArray(historyData?.runs) ? historyData.runs : []
    const report = buildTrendReport({
      runId,
      repo,
      current,
      history,
      window: args.window,
      maxDriftPct: args.maxDriftPct,
    })

    if (!report.current.found) {
      emit(report, args.json)
      process.stderr.write(
        `step de mutation não encontrado OU duração inválida (0s/NaN — data quebrada da API) no payload atual (markers: 'contrato coordenado'/'Run mutation test') — drift de contrato ou seed-guards não rodou o mutation-coord-update\n`,
      )
      process.exit(2)
    }
    finish(report, args)
    return
  }

  // ── MODO GH: run atual + histórico real ───────────────────────────────
  const currentRes = fetchCurrentViaGh(args.run, repo)
  if (currentRes && currentRes.error) {
    const report = { runId, repo, found: false, error: currentRes.error }
    emit(report, args.json)
    process.stderr.write(`erro (infra): ${currentRes.error}\n`)
    process.exit(1)
  }
  if (!currentRes) {
    const report = {
      runId,
      repo,
      found: false,
      error: `step de mutation não encontrado no run atual (markers: 'contrato coordenado'/'Run mutation test') — drift de contrato ou seed-guards não rodou o mutation-coord-update neste run`,
    }
    emit(report, args.json)
    process.stderr.write(`${report.error}\n`)
    process.exit(2)
  }

  const histRes = fetchHistoryViaGh(args.run, repo, args.window)
  if (histRes.error) {
    const report = { runId, repo, found: false, error: histRes.error }
    emit(report, args.json)
    process.stderr.write(`erro (infra): ${histRes.error}\n`)
    process.exit(1)
  }

  const report = buildTrendReport({
    runId,
    repo,
    current: { found: true, durationSecs: currentRes.durationSecs },
    history: histRes.history,
    window: args.window,
    maxDriftPct: args.maxDriftPct,
  })
  if (!report.current.found) {
    emit(report, args.json)
    process.stderr.write(
      `duração do step inválida no run atual (0s/NaN — data quebrada da jobs API): ${JSON.stringify(currentRes)}\n`,
    )
    process.exit(2)
  }
  finish(report, args)
}

/**
 * Emite o ::warning:: (drift acima do limiar) + o relatório JSON. Sempre exit
 * 0 — o alerta de tendência é NÃO-bloqueante por design (o gate duro do
 * measure-mutation-timing é quem bloqueia).
 */
function finish(report, args) {
  if (report.warned) {
    process.stdout.write(
      `::warning::Drift de tendência do mutation-coord: run atual ${report.current.durationSecs}s vs mediana dos últimos ${report.window} runs ${report.medianSecs}s (+${report.driftPct.toFixed(1)}% > limiar ${report.maxDriftPct}%) — overhead subindo antes do gate duro disparar; reavalie o contrato coordenado\n`,
    )
  } else if (typeof report.driftPct === "number") {
    process.stdout.write(
      `::notice::Drift de tendência do mutation-coord: ${report.current.durationSecs}s vs mediana ${report.medianSecs}s (${report.driftPct.toFixed(1)}% <= limiar ${report.maxDriftPct}%) — saudável\n`,
    )
  } else {
    process.stdout.write(
      `::notice::Sem histórico suficiente para tendência do mutation-coord (${report.history.length} runs anteriores < window ${report.window}) — primeiro runs medem o baseline\n`,
    )
  }
  emit(report, args.json)
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
