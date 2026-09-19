#!/usr/bin/env node

// =============================================================================
// measure-mutation-timing.mjs
//
// Mede o tempo REAL do step 'Run mutation test (contrato coordenado — 5
// cenários, 2 elos)' do job 'Mutation Test (contrato coordenado —
// doc↔anchor↔código)' num run do GitHub Actions — fechando a
// linha '~35-45s (est.)¹' da tabela de overhead do README com medição
// verdadeira, sem depender de auth local (o job semanal roda o gh com o
// GITHUB_TOKEN do próprio Actions).
//
// Usage:
//   node scripts/measure-mutation-timing.mjs --run <id> --repo owner/repo [--max SECS] [--warn SECS] [--warn-median N] [--warn-margin FRAC] [--alert SECS] [--fail-drift PCT] [--window N] [--workflow NAME] [--branch NAME] [--publish-baseline NAME] [--baseline-margin FRAC] [--warn-only] [--json OUT]
//   node scripts/measure-mutation-timing.mjs --jobs-file FILE [--json OUT] [--max SECS] [--warn SECS] [--warn-median N] [--warn-margin FRAC] [--alert SECS] [--fail-drift PCT] [--window N] [--workflow NAME] [--branch NAME] [--publish-baseline NAME] [--baseline-margin FRAC]
//   node scripts/measure-mutation-timing.mjs --act-log FILE [--max SECS] [--warn SECS] [--warn-median N] [--warn-margin FRAC] [--alert SECS] [--fail-drift PCT] [--window N] [--workflow NAME] [--branch NAME] [--act-exit CODE] [--json OUT]
//   node scripts/measure-mutation-timing.mjs --jobs-file FILE --history-file FILE --warn-median N [--warn-margin FRAC] [--max SECS] [--json OUT]
//   node scripts/measure-mutation-timing.mjs --jobs-file FILE --history-file FILE --fail-drift PCT [--window N] [--max SECS] [--json OUT]
//
// Exit codes:
//   0 — step encontrado, dentro do budget ou nas faixas de NOTICE/WARN (--alert < d <= --warn ou --warn < d <= --max)
//   1 — falha de infra OU budget duro excedido com --max OU act falhou antes do step
//   2 — step/job não encontrado (drift de contrato ou seed-guards não rodou)
//
// Modos:
//   --jobs-file FILE   lê o JSON bruto de `gh api repos/X/actions/runs/<id>/jobs`
//                      (modo de TESTE — o próprio script pode spawnar o gh com
//                      --run; o --jobs-file permite fixtures determinísticos)
//   --act-log FILE     lê o LOG DE SAÍDA do act (re-execução do job
//                      mutation-coord-update com a imagem ubuntu-bun) em vez
//                      do run REAL — extrai a duração do step da linha
//                      'Success - Main Run mutation test ... [X.XXs]' (mesma
//                      técnica do check-tier1-fastpath.mjs, reusa
//                      extractDurationFromLine). Cobre PRs que ainda NÃO têm
//                      o seed-guards.yml na branch DEFAULT (o reusable não
//                      roda → a jobs API não mede; o act roda o job local com
//                      a imagem custom). Aplica o MESMO gate de duas faixas
//                      (--max/--warn). --act-exit permite distinguir "act
//                      morreu antes do step" (infra) de "step não rodou"
//                      (drift).
//   --run ID           spawna o gh para buscar os jobs do run (GH_TOKEN do env)
//   --repo OWNER/REPO  repo para a chamada gh (default: GITHUB_REPOSITORY env)
//   --max SECS         BUDGET DURO de payload: FALHA (exit 1) se o step
//                      ultrapassar SECS — GATE de regressão de overhead
//                      (pr-check, antes do merge; e re-medição semanal).
//   --act-exit CODE    exit code do act (steps.act.outputs.ACT_EXIT) no modo
//                      --act-log. != 0 E sem evidência do step no log = act
//                      falhou ANTES do step (imagem não publicada / infra) →
//                      exit 1 com diagnóstico claro (mesma semântica do
//                      check-tier1-fastpath.mjs --act-exit). Sem esta flag,
//                      um act morto cedo seria classificado como 'drift'.
//   --warn SECS        faixa SOFT (opcional, exige --max e deve ser < --max):
//                      se SECS < duração <= --max, emite ::warning:: e sai
//                      exit 0 — reduz o ruído de runner sem perder o gate
//                      (um passo 200s num budget 180/240 é AVISO, não falha;
//                      acima de 240 falha).
//   --warn-median N    faixa SOFT DERIVADA DA MEDIANA dos últimos N runs
//                      medidos do MESMO step (--warn-median 4 = mediana dos
//                      últimos 4 runs) — SUBSTITUI o literal --warn (exclusivo
//                      entre si). O warn se AUTO-AJUSTA ao runner real: a
//                      faixa soft = mediana * (1 + --warn-margin), clampada
//                      para < --max (reusa computeBaselineValue). O gate
//                      DURO (--max) NÃO muda — o drift é detectado por DESVIO
//                      RELATIVO à mediana (uma regressão lenta 40→55→75→90s
//                      acende o soft cedo sem tocar o duro de 240s). Fonte do
//                      histórico: gh run list --workflow benchmark-weekly.yml
//                      + jobs API por run (o MESMO mecanismo do
//                      measure-mutation-trend.mjs — buildRunListJq
//                      compartilhado) nos modos --run/--act-log; --history-file
//                      no modo TESTE (--jobs-file). O histórico é SEMPRE o da
//                      BRANCH DEFAULT do repo (resolvida via gh repo view —
//                      os runs semanais vivem lá; um job de PR na branch do
//                      PR não veria NADA se filtrasse pela branch atual).
//                      Sem histórico suficiente (primeiro run) → ::notice:: e
//                      o gate opera SÓ no duro (--max) — o primeiro run mede o
//                      baseline. Falha do gh no histórico (workflow ainda não
//                      na default / gh fora) DEGRADA para ::notice:: + gate só
//                      no duro — o gate DURO é o sinal primário; a derivação é
//                      um refinamento (não pode derrubar o gate por uma
//                      dependência secundária). No modo TESTE
//                      (--history-file) a falha de leitura continua INFRA
//                      (exit 1) — o fixture quebrou, não o gh.
//   --branch NAME      branch dos runs do histórico (default: a DEFAULT do
//                      repo, resolvida via gh repo view). Override explícito
//                      para testes/debug; o parâmetro não é obrigatório.
//   --warn-margin FRAC margem de headroom da faixa derivada (default 0.2 =
//                      20% acima da mediana). Exige --warn-median.
//   --fail-drift PCT   GATE DE DRIFT RELATIVO (--max vira TETO ABSOLUTO):
//                      compara a duração do step ATUAL contra a MEDIANA do
//                      histórico e FALHA (exit 1) quando o desvio relativo
//                      ultrapassar PCT% — `(d - mediana) / mediana * 100 >
//                      PCT` (ex.: --fail-drift 50 = falha se o step for 50%
//                      mais lento que a mediana). O --max continua valendo
//                      como TETO ABSOLUTO de segurança (d > max falha SEMPRE,
//                      mesmo com drift pequeno). Exclusivo com --warn/
//                      --warn-median/--alert (escolha o SEMÂNTICA do gate:
//                      faixa soft OU drift relativo). Exige --max e histórico
//                      (--history-file no modo TESTE; gh no modo REAL — o
//                      MESMO mecanismo do --warn-median, branch default).
//                      Sem histórico → ::notice:: + gate SÓ no teto (--max).
//                      Relatório: driftSource/driftWindow/driftMaxPct/
//                      driftMedianSecs/driftPct/driftHistoryCount/drifted.
//   --window N         janela do histórico do --fail-drift (default 4 runs
//                      anteriores — o mesmo default do trend guard). Exige
//                      --fail-drift.
//   --workflow NAME    workflow cujos runs fornecem o histórico da mediana
//                      (default benchmark-weekly.yml — o job semanal que
//                      executa o seed-guards.yml via reusable; os runs
//                      ANTERIORES do seed-guards estão nos runs do caller).
//   --history-file FILE JSON { runs: [{ runId, durationSecs }] } dos runs
//                      ANTERIORES (modo TESTE determinístico — sem gh, como o
//                      measure-mutation-trend.mjs). Exige --jobs-file +
//                      --warn-median OU --fail-drift.
//   --alert SECS       faixa SUAVE (opcional, exige --warn e deve ser < --warn):
//                      se SECS < duração <= --warn, emite ::notice:: e sai exit 0
//                      — ESCALADA SUAVE em três degraus abaixo do duro:
//                        d <= alert            → 'ok'     (silencioso)
//                        alert < d <= warn     → 'notice' (::notice::)
//                        warn < d <= max       → 'warn'   (::warning::)
//                        d > max               → 'fail'   (::error:: + exit 1)
//                      A faixa notice observa o drift cedo (ruído baixo) ANTES
//                      do warning acender — o relatório ganha alertSecs + zone
//                      de QUATRO níveis ('ok'|'notice'|'warn'|'fail') + noticed.
//                      O timing é o NATIVO do Actions (started_at/completed_at
//                      da jobs API — o mesmo que a UI do GitHub mostra).
//                      Relatório ganha budgetSecs + warnSecs + zone
//                      ('ok'|'warn'|'fail') + exceeded/warned (distingue de
//                      infra found:false)
//   --warn-only        com --max: em vez de FALHAR no budget duro, emite
//                      ::warning:: e sai com exit 0 — alerta não-bloqueante
//                      (para contextos onde regressão de overhead não pode
//                      bloquear, ex.: dispatch manual). Interage com
//                      --fail-drift: converte AMBAS as causas de fail (drift
//                      relativo OU teto absoluto) em ::warning:: + exit 0 —
//                      a mensagem ainda distingue a causa (drifted/exceeded)
//                      no relatório, mas o job não bloqueia (uso explícito
//                      para alerta manual; o job do PR NUNCA passa --warn-only).
//   --publish-baseline NAME publica a duração medida (com margem
//                      --baseline-margin) como repository variable NAME via
//                      `gh variable set NAME <valor> --repo <repo>` — o
//                      BASELINE auto-atualizado que os jobs do gate consultam
//                      em vez do literal (ex.: --warn
//                      ${{ vars.MUTATION_TIMING_BASELINE || '180' }}). Exige
//                      --max (paridade com --warn — o baseline é relativo ao
//                      budget; publicar sem budget seria no-op silencioso). Só
//                      no modo REAL (--run/--jobs-file) — NUNCA com --act-log
//                      (o timing do act é local, não o baseline do CI).
//                      Publica SÓ quando o budget PASSOU (zone ok/warn, exit
//                      0): um run lento (fail) não ratcheta o baseline. Valor
//                      clampado para < --max (a faixa warn nunca pode
//                      igualar/ultrapassar o duro). Falha de publish =
//                      não-bloqueante (::warning::, exit inalterado) — a
//                      medição é o sinal
//                      primário; o baseline fica stale e observável.
//   --baseline-margin FRAC margem de headroom sobre a duração medida
//                      (default 0.2 = 20%): valor publicado =
//                      ceil(durationSecs * (1 + FRAC)). Tolerância à variação
//                      de runner (o gate consulta a média + headroom, não o
//                      pico). Exige --publish-baseline.
//   --json OUT         salva o relatório JSON em OUT (além do stdout)
//   -h, --help         mostra esta ajuda
//
// Relatório JSON (stdout / --json):
//   {
//     runId, repo, jobName, stepName, startedAt, completedAt, durationSecs,
//     conclusion, found: true
//   }
//   Com --max: + { budgetSecs, exceeded: bool }
//   Com --warn: + { warnSecs, warned: bool }
//   Com --warn-median: + { warnSource: 'median', warnWindow, warnMargin,
//     warnMedianSecs, warnHistoryCount } (warnSecs = mediana * (1+margem)
//     clampada < --max; null = sem histórico suficiente → gate só no duro)
//   Com --fail-drift: + { driftSource: 'median', driftWindow, driftMaxPct,
//     driftMedianSecs, driftPct, driftHistoryCount, drifted: bool } — zone
//     'fail' por drift (drifted: true) OU por teto absoluto (exceeded: true)
//   Com --alert: + { alertSecs, zone: 'ok'|'notice'|'warn'|'fail', noticed: bool }
//   Com --publish-baseline: + { baseline: { name, value, published,
//     dryRun?|error? } } — publicado SÓ quando zone != 'fail' (budget passou)
// Em erro: { runId, repo, found: false, error: '<mensagem>' }
//
// Job semanal (benchmark-weekly.yml — mutation-coord-timing): mede, gateia E
// a faixa soft DERIVA da mediana dos últimos 4 runs (sem baseline var):
//   node scripts/measure-mutation-timing.mjs --run <id> --repo <owner/repo> --max 240 --warn-median 4 --warn-margin 0.2 --json /tmp/mutation-timing.json
// Job PR (pr-check.yml — mutation-coord-timing-guard, antes do merge): GATE DE
// DRIFT RELATIVO vs a mediana do histórico (--fail-drift, threshold
// configurável) + teto absoluto --max 240:
//   node scripts/measure-mutation-timing.mjs --run <id> --repo <owner/repo> --max 240 --fail-drift 50 --window 4 --json /tmp/mutation-timing.json
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { extractDurationFromLine } from "./check-setup-bun-common.mjs"

// ── Constantes de contrato — espelham os nomes REAIS do seed-guards.yml ────
// Job: 'Mutation Test (contrato coordenado — doc↔anchor↔código)'
// Step: 'Run mutation test (contrato coordenado — 5 cenários, 2 elos)'
// Se alguém RENOMEAR o job/step, este script falha com exit 2 — o drift de
// contrato é exatamente o que a medição deve acusar (não passar em silêncio).
export const JOB_NAME_MARKER = "contrato coordenado"
export const STEP_NAME_MARKER = "Run mutation test"

/**
 * Extrai o step do mutation-coord-update do payload bruto da jobs API.
 *
 * @param {unknown} jobsPayload payload de `gh api repos/X/actions/runs/<id>/jobs`
 *   (o objeto { jobs: [...] } da API do GitHub).
 * @returns {{ jobName: string, stepName: string, startedAt: string, completedAt: string, conclusion: string } | null}
 *   null quando o job/step não é encontrado (o CALLER decide o exit code).
 */
export function extractMutationStep(jobsPayload) {
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : []
  const job = jobs.find((j) => typeof j?.name === "string" && j.name.includes(JOB_NAME_MARKER))
  if (!job) return null
  const steps = Array.isArray(job?.steps) ? job.steps : []
  const step = steps.find((s) => typeof s?.name === "string" && s.name.includes(STEP_NAME_MARKER))
  if (!step) return null
  if (!step.started_at || !step.completed_at) return null
  return {
    jobName: job.name,
    stepName: step.name,
    startedAt: step.started_at,
    completedAt: step.completed_at,
    conclusion: step.conclusion ?? "unknown",
  }
}

/**
 * Extrai a duração do step de mutation do LOG DO ACT (modo --act-log).
 *
 * O act re-executa o job mutation-coord-update (imagem ubuntu-bun) e imprime
 * para cada step a linha `Success - Main <nome do step> [X.XXs]` — a mesma
 * técnica do check-tier1-fastpath.mjs (extractDurationFromLine, compartilhada
 * via check-setup-bun-common.mjs). Cobra PRs que ainda não têm o
 * seed-guards.yml na branch DEFAULT: o reusable não roda no CI real, então a
 * jobs API não mede nada; o act roda o job local com a imagem custom.
 *
 * @param {string} logText conteúdo do log do act
 * @returns {{ stepName: string, durationSecs: number } | null}
 *   null quando a linha 'Success - Main ... Run mutation test' não é
 *   encontrada (job não rodou, step renomeado, ou act morreu antes).
 */
export function extractMutationStepFromActLog(logText) {
  const lines = String(logText).split(/\r?\n/)
  const line = lines.find((l) => l.includes("Success - Main") && l.includes(STEP_NAME_MARKER))
  if (!line) return null
  const durationSecs = extractDurationFromLine(line)
  if (durationSecs === null) return null
  // Nome do step: trecho entre 'Success - Main ' e ' [<dur>]'.
  const nameMatch = line.match(/Success - Main\s+(.+?)\s+\[\d+[\d.]*(ms|µs|s)\]/)
  return {
    stepName: nameMatch ? nameMatch[1] : STEP_NAME_MARKER,
    durationSecs,
  }
}

/**
 * Duração em segundos entre duas timestamps ISO 8601 (arredondada para cima —
 * um step de 0.3s reporta 1s, nunca 0 — evita falso 'instantâneo').
 *
 * @param {string} startedAt ISO 8601 (ex.: 2026-08-02T20:16:40Z)
 * @param {string} completedAt ISO 8601
 * @returns {number} segundos (>= 1 quando ambos os timestamps existem)
 */
export function computeDurationSecs(startedAt, completedAt) {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(1, Math.ceil((end - start) / 1000))
}

// ── Helpers de MEDIANA + HISTÓRICO (compartilhados com o trend guard) ─────
// O measure-mutation-trend.mjs importa estes helpers daqui — a MESMA fonte
// de derivação da mediana (fonte única da verdade; o trend mede a DERIVADA,
// o medidor usa a mediana como baseline da faixa soft).

/**
 * Mediana de um array de números (imune a outliers — um run com runner lento
 * de 200s não distorce a tendência). Filtra não-finitos (NaN de data quebrada
 * não envenena o sort nem a mediana).
 *
 * @param {number[]} values
 * @returns {number | null} null quando vazio / sem valores finitos
 */
export function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v))
  if (finite.length === 0) return null
  const sorted = [...finite].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Programa jq do `gh run list` do histórico: exclui o run ATUAL e mantém só
 * runs COMPLETOS. Comparação por NÚMERO puro (o gh emite databaseId como JSON
 * number — `!= "123"` string compararia TIPOS diferentes e nunca excluiria o
 * run atual, que entraria na própria mediana e viciaria o baseline).
 *
 * @param {string | number} currentRunId id numérico do run atual
 * @returns {string} programa jq (ex.: `.[] | select(.databaseId != 123) | select(.status == "completed") | .databaseId`)
 */
export function buildRunListJq(currentRunId) {
  return (
    ".[] | select(.databaseId != " +
    Number(currentRunId) +
    ') | select(.status == "completed") | .databaseId'
  )
}

/**
 * Busca as durações do MESMO step de mutation nos N runs ANTERIORES do
 * benchmark-weekly.yml via gh run list + jobs API por run (o MESMO mecanismo
 * do trend guard — fonte única da derivação da mediana). Runs onde o step não
 * apareceu (falhou antes / contrato antigo) simplesmente não entram.
 *
 * @param {string | number} currentRunId run ATUAL (excluído do histórico)
 * @param {string} repo
 * @param {number} window quantos runs anteriores entram
 * @returns {{ history: { runId: string, durationSecs: number }[] } | { error: string }}
 */
export function fetchHistoryDurationsViaGh(currentRunId, repo, window, branch, workflow) {
  // O histórico SEMPRE vem da branch DEFAULT do repo (os runs semanais do
  // benchmark-weekly vivem lá). Num job de PR, o gh run list sem --branch
  // filtraria pela branch do PR (o checkout é a head do PR) → histórico
  // VAZIO → o soft derivado viraria no-op silencioso no próprio gate que a
  // derivação existe para servir. Resolve a default via gh repo view (o
  // github.event.repository é VAZIO em eventos schedule — não depender do
  // payload do evento) e passa --branch explícito.
  let runBranch = branch
  if (runBranch === null || runBranch === undefined) {
    const view = spawnSync(
      "gh",
      ["repo", "view", repo, "--json", "default_branch", "--jq", ".default_branch"],
      { encoding: "utf8", timeout: 60_000 },
    )
    if (view.error) return { error: `gh indisponível (repo view): ${view.error.message}` }
    if (view.status !== 0) {
      return {
        error: `gh repo view falhou (exit ${view.status}): ${(view.stderr ?? "").trim().slice(0, 300)}`,
      }
    }
    runBranch = view.stdout.trim()
    if (!runBranch)
      return {
        error: "gh repo view devolveu default_branch vazio — não dá para derivar o histórico",
      }
  }
  const list = spawnSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      workflow ?? "benchmark-weekly.yml",
      "--repo",
      repo,
      "--branch",
      runBranch,
      "--limit",
      String(window + 1), // corrente + N anteriores
      "--json",
      "databaseId,status",
      "--jq",
      buildRunListJq(currentRunId),
    ],
    { encoding: "utf8", timeout: 60_000 },
  )
  if (list.error) return { error: `gh indisponível (run list): ${list.error.message}` }
  if (list.status !== 0) {
    return {
      error: `gh run list falhou (exit ${list.status}): ${(list.stderr ?? "").trim().slice(0, 300)}`,
    }
  }
  const runIds = list.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))
    .slice(0, window)

  const history = []
  for (const runId of runIds) {
    const res = fetchJobsViaGh(runId, repo)
    if (res.error) continue // run com jobs API quebrada não entra (ruído)
    const step = extractMutationStep(res.payload)
    if (!step) continue // step não rodou nesse run — não entra na mediana
    history.push({ runId, durationSecs: computeDurationSecs(step.startedAt, step.completedAt) })
  }
  return { history }
}

/**
 * Deriva a faixa SOFT do budget a partir da MEDIANA do histórico: a duração
 * mediana dos últimos N runs com headroom de margem, clampada para SEMPRE
 * ficar < --max (reusa computeBaselineValue — a mesma semântica de clamp do
 * baseline publicado). Mediana null (sem histórico) → null.
 *
 * @param {number | null} medianSecs mediana das durações históricas
 * @param {number} margin fração de headroom (0.2 = +20% acima da mediana)
 * @param {number|null} maxSecs budget duro (clamp; null = sem clamp)
 * @returns {number | null} warn derivado (>= 1, < maxSecs quando dado)
 */
export function deriveWarnFromMedian(medianSecs, margin, maxSecs) {
  if (medianSecs === null) return null
  return computeBaselineValue(medianSecs, margin, maxSecs)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write(
    [
      "Uso:",
      "  node scripts/measure-mutation-timing.mjs --jobs-file FILE",
      "  node scripts/measure-mutation-timing.mjs --run <id> [--repo owner/repo] [--max SECS] [--warn SECS] [--alert SECS] [--publish-baseline NAME] [--baseline-margin FRAC] [--warn-only] [--json OUT]",
      "  node scripts/measure-mutation-timing.mjs --act-log FILE [--max SECS] [--warn SECS] [--alert SECS] [--act-exit CODE] [--json OUT]",
      "",
      "Exit codes:",
      "  0 — step encontrado, dentro do budget ou nas faixas de NOTICE/WARN (--alert < d <= --warn ou --warn < d <= --max)",
      "  1 — falha de infra OU budget duro excedido com --max (gate de overhead) OU act falhou antes do step (--act-exit != 0 sem evidência)",
      "  2 — step/job não encontrado (drift de contrato ou seed-guards não rodou)",
    ].join("\n") + "\n",
  )
}

function parseArgs(argv) {
  const out = {
    jobsFile: null,
    actLog: null,
    actExit: null,
    run: null,
    repo: process.env.GITHUB_REPOSITORY ?? null,
    json: null,
    max: null,
    warn: null,
    warnMedian: null, // N runs anteriores — deriva a faixa soft da MEDIANA
    warnMargin: null, // headroom sobre a mediana (default 0.2 quando --warn-median)
    failDrift: null, // PCT de drift relativo vs mediana que FALHA (--max vira teto absoluto)
    window: null, // janela do histórico do --fail-drift (default 4)
    workflow: null, // workflow do histórico (default benchmark-weekly.yml)
    historyFile: null, // histórico determinístico (modo TESTE --jobs-file)
    alert: null,
    warnOnly: false,
    branch: null, // branch do histórico da mediana (default: a DEFAULT do repo)
    publishBaseline: null,
    baselineMargin: null, // null = não passada (usa default 0.2); a validação
    // distingue 'não passada' de 'passada explicitamente' (senão
    // --baseline-margin 0.2 sem --publish-baseline passaria silencioso).
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--jobs-file": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--jobs-file exige um caminho" }
        out.jobsFile = v
        break
      }
      case "--act-log": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--act-log exige um caminho" }
        out.actLog = v
        break
      }
      case "--act-exit": {
        // Mesmo padrão do check-tier1-fastpath.mjs --act-exit: regex /^\d+$/
        // rejeita frações/negativos/ausência antes do parseInt.
        const raw = argv[++i]
        if (raw === undefined) return { ...out, error: "--act-exit exige um valor" }
        if (!/^\d+$/.test(raw))
          return { ...out, error: `--act-exit deve ser um inteiro >= 0 (obtido: '${raw}')` }
        out.actExit = parseInt(raw, 10)
        break
      }
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
      case "--json": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--json exige um caminho" }
        out.json = v
        break
      }
      case "--max": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) <= 0)
          return { ...out, error: `--max deve ser um inteiro positivo (obtido: '${v}')` }
        out.max = Number(v)
        break
      }
      case "--warn": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) <= 0)
          return { ...out, error: `--warn deve ser um inteiro positivo (obtido: '${v}')` }
        out.warn = Number(v)
        break
      }
      case "--warn-median": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1)
          return { ...out, error: `--warn-median deve ser um inteiro >= 1 (obtido: '${v}')` }
        out.warnMedian = Number(v)
        break
      }
      case "--warn-margin": {
        const v = argv[++i]
        if (v === undefined || !/^\d+(\.\d+)?$/.test(v) || Number(v) < 0)
          return { ...out, error: `--warn-margin deve ser um número >= 0 (obtido: '${v}')` }
        out.warnMargin = Number(v)
        break
      }
      case "--fail-drift": {
        const v = argv[++i]
        if (v === undefined || !/^\d+(\.\d+)?$/.test(v) || Number(v) < 0)
          return {
            ...out,
            error: `--fail-drift deve ser um número >= 0 (percentual, obtido: '${v}')`,
          }
        out.failDrift = Number(v)
        break
      }
      case "--window": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1)
          return { ...out, error: `--window deve ser um inteiro >= 1 (obtido: '${v}')` }
        out.window = Number(v)
        break
      }
      case "--workflow": {
        const v = argv[++i]
        if (v === undefined || v.trim() === "")
          return { ...out, error: "--workflow exige um nome de workflow" }
        out.workflow = v
        break
      }
      case "--branch": {
        const v = argv[++i]
        if (v === undefined || v.trim() === "")
          return { ...out, error: "--branch exige um nome de branch" }
        out.branch = v
        break
      }
      case "--history-file": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--history-file exige um caminho" }
        out.historyFile = v
        break
      }
      case "--alert": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) <= 0)
          return { ...out, error: `--alert deve ser um inteiro positivo (obtido: '${v}')` }
        out.alert = Number(v)
        break
      }
      case "--warn-only":
        out.warnOnly = true
        break
      case "--publish-baseline": {
        const v = argv[++i]
        if (v === undefined)
          return {
            ...out,
            error: "--publish-baseline exige o NOME da variable (ex.: MUTATION_TIMING_BASELINE)",
          }
        // Convenção do repo: variáveis em MAIÚSCULAS (GitHub aceita minúsculas,
        // mas o padrão do repo é uppercase — ex.: BUN_VERSION, MUTATION_TIMING_BASELINE).
        if (!/^[A-Z][A-Z0-9_]*$/.test(v))
          return {
            ...out,
            error: `--publish-baseline deve ser um nome de variable válido (maiúsculas/dígitos/_, ex.: MUTATION_TIMING_BASELINE — obtido: '${v}')`,
          }
        out.publishBaseline = v
        break
      }
      case "--baseline-margin": {
        const v = argv[++i]
        if (v === undefined || !/^\d+(\.\d+)?$/.test(v) || Number(v) < 0)
          return { ...out, error: `--baseline-margin deve ser um número >= 0 (obtido: '${v}')` }
        out.baselineMargin = Number(v)
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
  if (!out.jobsFile && !out.run && !out.actLog)
    return { ...out, error: "exija --jobs-file, --run OU --act-log" }
  if (out.actLog && (out.jobsFile || out.run))
    return {
      ...out,
      error: "--act-log não pode ser combinado com --jobs-file/--run (escolha uma fonte)",
    }
  if (out.warnOnly && out.max === null)
    return { ...out, error: "--warn-only exige --max (o budget é o que define o que é alerta)" }
  if (out.warn !== null && out.max === null)
    return { ...out, error: "--warn exige --max (a faixa soft é relativa ao budget duro)" }
  if (out.warn !== null && out.max !== null && out.warn >= out.max)
    return {
      ...out,
      error: `--warn deve ser MENOR que --max (faixa vazia: warn ${out.warn} >= max ${out.max})`,
    }
  // ── FAIXA SOFT DERIVADA DA MEDIANA (--warn-median N) ─────────────────
  // O warn se AUTO-AJUSTA ao runner real: mediana dos últimos N runs medidos
  // * (1 + --warn-margin), clampada < --max. Exclusivo com --warn (literal):
  // escolha a fonte da faixa soft. Exige --max (a faixa é relativa ao duro).
  // No modo TESTE (--jobs-file) o histórico NÃO vem do gh — exige
  // --history-file (fixtures determinísticos); nos modos --run/--act-log o
  // histórico vem do gh (mesmo mecanismo do trend guard).
  if (out.warnMedian !== null && out.max === null)
    return {
      ...out,
      error: "--warn-median exige --max (a faixa derivada é relativa ao budget duro)",
    }
  if (out.warnMedian !== null && out.warn !== null)
    return {
      ...out,
      error:
        "--warn-median não pode ser combinado com --warn (escolha: literal OU derivada da mediana)",
    }
  if (out.warnMedian !== null && out.jobsFile && !out.historyFile)
    return {
      ...out,
      error:
        "--warn-median com --jobs-file exige --history-file (modo TESTE — o histórico não vem do gh; use fixtures determinísticos)",
    }
  // ── GATE DE DRIFT RELATIVO (--fail-drift PCT) ──────────────────────
  // O PR compara o timing atual contra a MEDIANA do histórico e FALHA por
  // desvio relativo (--fail-drift PCT) — o --max vira TETO ABSOLUTO (d > max
  // falha SEMPRE). Exclusivo com as faixas (--warn/--warn-median/--alert):
  // escolha a SEMÂNTICA do gate. Exige histórico (gh no modo REAL;
  // --history-file no modo TESTE --jobs-file), igual ao --warn-median.
  if (out.failDrift !== null && out.max === null)
    return {
      ...out,
      error: "--fail-drift exige --max (o teto absoluto define a segurança)",
    }
  if (out.failDrift !== null && out.warn !== null)
    return {
      ...out,
      error:
        "--fail-drift não pode ser combinado com --warn (escolha a semântica do gate: faixa soft OU drift relativo)",
    }
  if (out.failDrift !== null && out.warnMedian !== null)
    return {
      ...out,
      error:
        "--fail-drift não pode ser combinado com --warn-median (escolha a semântica do gate: faixa derivada OU drift relativo)",
    }
  if (out.failDrift !== null && out.alert !== null)
    return {
      ...out,
      error:
        "--fail-drift não pode ser combinado com --alert (a escalada suave é da semântica de faixa)",
    }
  if (out.failDrift !== null && out.jobsFile && !out.historyFile)
    return {
      ...out,
      error:
        "--fail-drift com --jobs-file exige --history-file (modo TESTE — o histórico não vem do gh; use fixtures determinísticos)",
    }
  if (out.window !== null && out.failDrift === null)
    return { ...out, error: "--window exige --fail-drift (a janela define o histórico do drift)" }
  if (out.historyFile && out.warnMedian === null && out.failDrift === null)
    return {
      ...out,
      error:
        "--history-file exige --warn-median OU --fail-drift (o histórico alimenta a derivação)",
    }
  if (out.warnMargin !== null && out.warnMedian === null)
    return { ...out, error: "--warn-margin exige --warn-median (a margem define a faixa derivada)" }
  if (out.alert !== null && out.warn === null)
    return { ...out, error: "--alert exige --warn (a faixa notice é relativa à soft)" }
  if (out.alert !== null && out.warn !== null && out.alert >= out.warn)
    return {
      ...out,
      error: `--alert deve ser MENOR que --warn (faixa vazia: alert ${out.alert} >= warn ${out.warn})`,
    }
  if (out.actExit !== null && !out.actLog)
    return {
      ...out,
      error: "--act-exit exige --act-log (o exit do act só existe no modo --act-log)",
    }
  if (out.publishBaseline && out.actLog)
    return {
      ...out,
      error:
        "--publish-baseline NÃO pode ser combinado com --act-log (o timing do act é local, não o baseline do CI real)",
    }
  if (out.baselineMargin !== null && !out.publishBaseline)
    return {
      ...out,
      error: "--baseline-margin exige --publish-baseline (a margem define o baseline publicado)",
    }
  if (out.publishBaseline && out.max === null)
    return {
      ...out,
      error:
        "--publish-baseline exige --max (o baseline é relativo ao budget — publicar sem budget seria no-op silencioso)",
    }
  return out
}

// ── Derivação da faixa soft pela MEDIANA (--warn-median N) ───────────────

/**
 * Lê o histórico de durações do MESMO step: --history-file (fixtures
 * determinísticos — { runs: [{ runId, durationSecs }] }) no modo TESTE, ou gh
 * run list benchmark-weekly.yml + jobs API por run no modo REAL (o MESMO
 * mecanismo do trend guard — buildRunListJq/computeMedian compartilhados).
 *
 * @param {object} args args parseados (warnMedian/historyFile/run)
 * @param {string} repo owner/repo
 * @returns {{ runs: { runId: string, durationSecs: number }[] } | { error: string }}
 */
function readHistoryDurations(args, repo) {
  if (args.historyFile) {
    try {
      const data = JSON.parse(readFileSync(args.historyFile, "utf8"))
      return { runs: Array.isArray(data?.runs) ? data.runs : [] }
    } catch (e) {
      return { error: `falha ao ler --history-file '${args.historyFile}': ${e.message}` }
    }
  }
  // Modo REAL: histórico dos últimos N runs do workflow que executa o
  // seed-guards (default benchmark-weekly.yml — o semanal; --workflow permite
  // outro caller, ex.: pr-check.yml). A janela vem do --warn-median N OU do
  // --window do --fail-drift (default 4). Em --act-log o run atual não é um
  // run real do CI (o act é local) — passar o id 0 na exclusão é inofensivo
  // (nenhum run tem databaseId 0).
  const window = args.warnMedian ?? args.window ?? 4
  const res = fetchHistoryDurationsViaGh(args.run ?? 0, repo, window, args.branch, args.workflow)
  return res.error ? { error: res.error } : { runs: res.history }
}

/**
 * Deriva a faixa soft pela MEDIANA dos últimos N runs (--warn-median):
 * mediana * (1 + --warn-margin), clampada < --max (computeBaselineValue).
 * Sem histórico suficiente (primeiro run) → { warnSecs: null } — o gate opera
 * SÓ no duro (--max) com ::notice::; o primeiro run mede o baseline.
 *
 * @param {object} args args parseados (warnMedian/warnMargin/max/historyFile)
 * @param {string} repo owner/repo
 * @returns {{ warnSecs: number | null, medianSecs: number | null, historyCount: number } | { error: string }}
 */
function deriveMedianWarn(args, repo) {
  const hist = readHistoryDurations(args, repo)
  if (hist.error) return { error: hist.error }
  const durations = hist.runs.map((r) => r.durationSecs)
  const medianSecs = computeMedian(durations)
  if (medianSecs === null) {
    return { warnSecs: null, medianSecs: null, historyCount: durations.length }
  }
  const margin = args.warnMargin ?? 0.2
  return {
    warnSecs: deriveWarnFromMedian(medianSecs, margin, args.max),
    medianSecs,
    historyCount: durations.length,
  }
}

/**
 * Aplica a derivação da faixa soft (--warn-median) ao report ANTES do gate:
 * define report.warnSource/warnWindow/warnMargin/warnMedianSecs/warnHistoryCount
 * e, com histórico suficiente, `args.warn` (que o applyBudgetGate consome).
 * Sem histórico → ::notice:: + gate só no duro. Infra (gh/file) → exit 1.
 *
 * @param {object} report relatório (found: true, durationSecs já preenchido)
 * @param {object} args   args parseados
 * @param {string} repo   owner/repo
 */
function applyMedianWarnDerivation(report, args, repo) {
  if (args.warnMedian === null) return
  const derived = deriveMedianWarn(args, repo)
  if (derived.error) {
    // Modo TESTE (--history-file): o fixture quebrou → INFRA (exit 1). Modo
    // REAL (gh): a derivação DEGRADA para ::notice:: + gate só no duro — o
    // gate DURO (--max) é o sinal primário e continua funcionando; o
    // histórico é uma dependência SECUNDÁRIA (workflow ainda não na default
    // / gh fora) que não pode derrubar o gate do PR por um refinamento.
    if (args.historyFile) {
      const infra = { runId: args.run ?? "fixture", repo, found: false, error: derived.error }
      emit(infra, args.json)
      process.stdout.write(`${JSON.stringify(infra, null, 2)}\n`)
      process.stderr.write(`erro (infra): ${derived.error}\n`)
      process.exit(1)
    }
    process.stdout.write(
      `::notice::histórico da mediana indisponível (${derived.error}) — gate opera SÓ no duro (--max ${args.max}s); a faixa soft é restaurada assim que o histórico estiver disponível\n`,
    )
    report.warnSource = "median"
    report.warnWindow = args.warnMedian
    report.warnMargin = args.warnMargin ?? 0.2
    report.warnMedianSecs = null
    report.warnHistoryCount = 0
    return
  }
  report.warnSource = "median"
  report.warnWindow = args.warnMedian
  report.warnMargin = args.warnMargin ?? 0.2
  report.warnMedianSecs = derived.medianSecs
  report.warnHistoryCount = derived.historyCount
  if (derived.warnSecs === null) {
    // Sem histórico suficiente: o gate opera SÓ no duro; o primeiro run mede
    // o baseline (mesma semântica do trend guard — ::notice::, não falha).
    process.stdout.write(
      `::notice::sem histórico suficiente para a faixa soft (${derived.historyCount} runs anteriores < window ${args.warnMedian}) — gate opera SÓ no duro (--max ${args.max}s); o primeiro run mede o baseline\n`,
    )
    return
  }
  args.warn = derived.warnSecs // o applyBudgetGate consome a faixa derivada
}

/**
 * Deriva o DRIFT RELATIVO (--fail-drift) do step atual vs a MEDIANA do
 * histórico: `(durationSecs - medianSecs) / medianSecs * 100`. Reusa o MESMO
 * readHistoryDurations do --warn-median (fonte única do histórico — gh na
 * branch default no modo REAL, --history-file no modo TESTE). Sem histórico
 * → driftPct null (gate só no teto).
 *
 * @param {object} args args parseados (failDrift/window/workflow/historyFile/run)
 * @param {string} repo owner/repo
 * @returns {{ medianSecs: number | null, historyCount: number, window: number } | { error: string }}
 */
function deriveDriftStats(args, repo) {
  const hist = readHistoryDurations(args, repo)
  if (hist.error) return { error: hist.error }
  const durations = hist.runs.map((r) => r.durationSecs)
  return {
    medianSecs: computeMedian(durations),
    historyCount: durations.length,
    window: args.window ?? 4,
  }
}

/**
 * Aplica a derivação do DRIFT RELATIVO (--fail-drift) ao report ANTES do
 * gate: define report.driftSource/driftWindow/driftMaxPct/driftMedianSecs/
 * driftPct/driftHistoryCount — o applyBudgetGate consome report.driftPct
 * para a zone 'fail' por drift. Sem histórico (primeiro run) → ::notice:: +
 * gate SÓ no teto (--max). Infra (gh/file) → o MESMO contrato do
 * --warn-median: TESTE exit 1, REAL degrada para ::notice:: + teto.
 *
 * @param {object} report relatório (found: true, durationSecs já preenchido)
 * @param {object} args   args parseados
 * @param {string} repo   owner/repo
 */
function applyFailDriftDerivation(report, args, repo) {
  if (args.failDrift === null) return
  const stats = deriveDriftStats(args, repo)
  if (stats.error) {
    if (args.historyFile) {
      const infra = { runId: args.run ?? "fixture", repo, found: false, error: stats.error }
      emit(infra, args.json)
      process.stdout.write(`${JSON.stringify(infra, null, 2)}\n`)
      process.stderr.write(`erro (infra): ${stats.error}\n`)
      process.exit(1)
    }
    process.stdout.write(
      `::notice::histórico do drift indisponível (${stats.error}) — gate opera SÓ no teto absoluto (--max ${args.max}s); o drift é restaurado assim que o histórico estiver disponível\n`,
    )
    report.driftSource = "median"
    report.driftWindow = args.window ?? 4
    report.driftMaxPct = args.failDrift
    report.driftMedianSecs = null
    report.driftPct = null
    report.driftHistoryCount = 0
    return
  }
  report.driftSource = "median"
  report.driftWindow = stats.window
  report.driftMaxPct = args.failDrift
  report.driftMedianSecs = stats.medianSecs
  report.driftHistoryCount = stats.historyCount
  if (stats.medianSecs === null) {
    process.stdout.write(
      `::notice::sem histórico suficiente para o drift relativo (${stats.historyCount} runs anteriores < window ${stats.window}) — gate opera SÓ no teto absoluto (--max ${args.max}s); o primeiro run mede o baseline\n`,
    )
    report.driftPct = null
    return
  }
  report.driftPct = ((report.durationSecs - stats.medianSecs) / stats.medianSecs) * 100
}

/** Busca o payload de jobs via gh (GH_TOKEN do env — usado pelo Actions). */
function fetchJobsViaGh(runId, repo) {
  // per_page=100 via QUERY STRING: a jobs API tem default de 30 jobs/página; o
  // run semanal tem ~16+ jobs hoje e tende a crescer. NÃO usar --paginate:
  // o gh aplica o jq POR PÁGINA e concatena os resultados — como o endpoint
  // retorna um OBJETO ({ total_count, jobs }), 2+ páginas virariam
  // '{...}\n{...}' (JSON inválido para o JSON.parse abaixo). per_page=100
  // mantém o shape de objeto único que o parser espera (100 jobs >> qualquer
  // run razoável). ATENÇÃO: gh api NÃO aceita a flag --per-page (é do gh run
  // list) — o caminho correto é a query string na URL (?per_page=100).
  const res = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, "--jq", "."],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  )
  if (res.error) {
    return { error: `gh indisponível: ${res.error.message}` }
  }
  if (res.status !== 0) {
    return {
      error: `gh api falhou (exit ${res.status}): ${(res.stderr ?? "").trim().slice(0, 300)}`,
    }
  }
  try {
    return { payload: JSON.parse(res.stdout) }
  } catch (e) {
    return { error: `payload de jobs inválido do gh: ${e.message}` }
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

  // ── MODO --act-log: extrai a duração do LOG do act (sem gh, sem jobs API) ──
  // Re-execução local do job mutation-coord-update com a imagem ubuntu-bun
  // (job mutation-coord-timing-act-guard do pr-check.yml) — cobre PRs que
  // ainda não têm o seed-guards.yml na branch DEFAULT: o reusable não roda no
  // CI real (jobs API vazia), então a única medição possível é via act. A
  // mesma linha 'Success - Main <step> [X.XXs]' que o check-tier1-fastpath
  // parseia, com o MESMO gate de duas faixas (--max/--warn).
  if (args.actLog) {
    let logText
    try {
      logText = readFileSync(args.actLog, "utf8")
    } catch (e) {
      const report = {
        runId,
        repo,
        found: false,
        error: `falha ao ler --act-log '${args.actLog}': ${e.message}`,
      }
      emit(report, args.json)
      process.stderr.write(`erro (infra): ${report.error}\n`)
      process.exit(1)
    }
    const step = extractMutationStepFromActLog(logText)
    if (!step) {
      // Duas causas possíveis: act morreu ANTES do step (infra — imagem não
      // publicada?) ou o step não rodou (drift). --act-exit distingue: exit
      // != 0 sem evidência = act falhou cedo (infra, exit 1); exit 0 sem
      // evidência = step renomeado/skipped (drift, exit 2).
      if (typeof args.actExit === "number" && args.actExit !== 0) {
        const report = {
          runId,
          repo,
          found: false,
          error: `act exit ${args.actExit} ≠ 0 e SEM evidência do step de mutation no log — act falhou ANTES do step (imagem ghcr.io/<owner>/ubuntu-bun não publicada/disponível? erro de infra no act? workflow_call do seed-guards.yml sem trigger reconhecido pelo act? veja o log do act)`,
        }
        emit(report, args.json)
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
        process.stderr.write(`${report.error}\n`)
        process.exit(1)
      }
      const report = {
        runId,
        repo,
        found: false,
        error: `step de mutation não encontrado no log do act (markers: job '${JOB_NAME_MARKER}', step '${STEP_NAME_MARKER}') — drift de contrato ou o act não rodou o mutation-coord-update`,
      }
      emit(report, args.json)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.stderr.write(`${report.error}\n`)
      process.exit(2)
    }

    const report = {
      runId,
      repo,
      found: true,
      source: "act-log",
      jobName: JOB_NAME_MARKER,
      stepName: step.stepName,
      durationSecs: step.durationSecs,
      conclusion: "success",
    }

    // Faixa soft DERIVADA da mediana (--warn-median) OU drift relativo
    // (--fail-drift) — ANTES do gate, que consome args.warn (faixa) ou
    // report.driftPct (drift).
    applyMedianWarnDerivation(report, args, repo)
    applyFailDriftDerivation(report, args, repo)

    // GATE de duas faixas — o MESMO do modo jobs-file/run (helper
    // compartilhado applyBudgetGate — uma única fonte da verdade para a
    // semântica das zonas; o mutation test trava a paridade dos dois modos).
    applyBudgetGate(report, args, step.stepName, "(medido via act)")

    emit(report, args.json)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exit(0)
  }

  let payload
  let infraError = null
  if (args.jobsFile) {
    try {
      payload = JSON.parse(readFileSync(args.jobsFile, "utf8"))
    } catch (e) {
      infraError = `falha ao ler --jobs-file '${args.jobsFile}': ${e.message}`
    }
  } else {
    // RETRY no caminho gh: a jobs API do GitHub é eventualmente consistente —
    // o job alvo acabou de completar (needs: no workflow) e pode haver delay
    // de propagação. Se o job ainda não aparecer, tentamos de novo (10s x 5);
    // esgotado, é DRIFT REAL (renomearam o step) → exit 2 com mensagem clara.
    // Sleep síncrono (Node main thread — Atomics.wait bloqueia o loop de
    // eventos, aceitável aqui: main() é síncrono e não tem timers pendentes).
    const sleepSync = () => {
      const buf = new SharedArrayBuffer(4)
      const arr = new Int32Array(buf)
      Atomics.wait(arr, 0, 0, RETRY_S * 1000)
    }
    const MAX_ATTEMPTS = 5
    const RETRY_S = 10
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = fetchJobsViaGh(args.run, args.repo ?? "")
      // Retry TAMBÉM em falha de gh (transient 5xx do API): o job alvo acabou
      // de completar via needs — um 500 no 1º poll é plausível. Só desiste
      // (infra, exit 1) quando a falha persiste em TODAS as tentativas.
      if (res.error) {
        if (attempt < MAX_ATTEMPTS) {
          process.stderr.write(
            `aviso: gh api falhou (tentativa ${attempt}/${MAX_ATTEMPTS}) — aguardando ${RETRY_S}s...\n`,
          )
          sleepSync()
          continue
        }
        infraError = res.error
        break
      }
      payload = res.payload
      if (extractMutationStep(payload)) break
      if (attempt < MAX_ATTEMPTS) {
        process.stderr.write(
          `aviso: job/step ainda não visível na jobs API (tentativa ${attempt}/${MAX_ATTEMPTS}) — aguardando ${RETRY_S}s...\n`,
        )
        sleepSync()
      }
    }
  }

  if (infraError) {
    const report = { runId, repo, found: false, error: infraError }
    emit(report, args.json)
    process.stderr.write(`erro (infra): ${infraError}\n`)
    process.exit(1)
  }

  const step = extractMutationStep(payload)
  if (!step) {
    const report = {
      runId,
      repo,
      found: false,
      error: `step/job de mutation não encontrado (markers: job '${JOB_NAME_MARKER}', step '${STEP_NAME_MARKER}') — drift de contrato ou seed-guards não rodou o mutation-coord-update neste run`,
    }
    emit(report, args.json)
    // JSON do relatório também no stdout (paridade com o caso achado) — o
    // stderr carrega só a mensagem legível.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.stderr.write(`${report.error}\n`)
    process.exit(2)
  }

  const report = {
    runId,
    repo,
    found: true,
    jobName: step.jobName,
    stepName: step.stepName,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationSecs: computeDurationSecs(step.startedAt, step.completedAt),
    conclusion: step.conclusion,
  }

  // Faixa soft DERIVADA da mediana (--warn-median) OU drift relativo
  // (--fail-drift) — ANTES do gate, que consome args.warn (faixa) ou
  // report.driftPct (drift).
  applyMedianWarnDerivation(report, args, repo)
  applyFailDriftDerivation(report, args, repo)

  // ── GATE DE BUDGET EM DUAS FAIXAS (--max duro + --warn soft) ─────────
  // Previne regressão de overhead do contrato coordenado com ruído reduzido:
  //   zone 'ok'   — duração <= --warn (ou <= --max sem --warn) → exit 0
  //   zone 'warn' — --warn < duração <= --max (faixa SOFT) → ::warning:: + exit 0
  //   zone 'fail' — duração > --max (faixa DURO) → ::error:: + exit 1
  // (com --warn-only: a faixa fail também vira ::warning:: + exit 0). O
  // relatório carrega budgetSecs/warnSecs/zone/exceeded/warned — o caller
  // distingue warn (found:true, warned:true) de fail (exceeded:true) de
  // infra (found:false) e drift (exit 2). Helper único (applyBudgetGate)
  // compartilhado com o modo --act-log — semântica idêntica nas duas fontes.
  applyBudgetGate(report, args, step.stepName, "")

  emit(report, args.json)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}

/**
 * Valor do baseline a publicar (--publish-baseline): a duração medida com
 * headroom de margem, clampada para SEMPRE ficar < --max (a faixa warn nunca
 * pode igualar/ultrapassar o duro — senão o gate vira faixa vazia no run
 * seguinte). Mínimo 1s.
 *
 * @param {number} durationSecs duração medida do step
 * @param {number} margin fração de headroom (0.2 = +20%)
 * @param {number|null} maxSecs budget duro (clamp; null = sem clamp)
 * @returns {number} baseline a publicar (>= 1, < maxSecs quando maxSecs dado)
 */
export function computeBaselineValue(durationSecs, margin, maxSecs) {
  const raw = Math.max(1, Math.ceil(durationSecs * (1 + (margin ?? 0.2))))
  if (typeof maxSecs === "number" && maxSecs > 0 && raw >= maxSecs) {
    return Math.max(1, maxSecs - 1)
  }
  return raw
}

/**
 * Publica o baseline medido como repository variable (gh variable set) —
 * auto-atualização do limiar soft que os jobs do gate consultam em vez do
 * literal (ex.: --warn ${{ vars.MUTATION_TIMING_BASELINE || '180' }}).
 *
 * FAIL-SOFT: falha de publish NÃO altera o exit code (a medição é o sinal
 * primário; um baseline stale fica observável via report.baseline.published
 * false + ::warning::). DRY-RUN para testes: env
 * MEASURE_MUTATION_TIMING_DRY_PUBLISH=1 pula o spawn do gh (report marca
 * published: "dry-run" — os testes unit/mutation não precisam de gh real).
 *
 * @param {object} report relatório (durationSecs/zone já preenchidos)
 * @param {object} args   args parseados (publishBaseline/baselineMargin/max/repo)
 */
function maybePublishBaseline(report, args) {
  if (!args.publishBaseline) return
  if (report.zone === "fail") {
    // Budget NÃO passou — um run lento não deve ratchetar o baseline para
    // cima (senão a regressão viraria o novo normal). Publish só em ok/warn.
    return
  }
  const value = computeBaselineValue(report.durationSecs, args.baselineMargin ?? 0.2, args.max)
  const entry = { name: args.publishBaseline, value }
  if (process.env.MEASURE_MUTATION_TIMING_DRY_PUBLISH === "1") {
    entry.published = "dry-run"
    report.baseline = entry
    process.stdout.write(
      `::notice::[dry-run] gh variable set ${args.publishBaseline} ${value} --repo ${report.repo}\n`,
    )
    return
  }
  const res = spawnSync(
    "gh",
    ["variable", "set", args.publishBaseline, "--body", String(value), "--repo", report.repo],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "" },
    },
  )
  if (res.error || res.status !== 0) {
    entry.published = false
    entry.error = (res.error?.message ?? res.stderr ?? "").trim().slice(0, 300)
    report.baseline = entry
    process.stdout.write(
      `::warning::não foi possível publicar baseline ${args.publishBaseline}=${value}: ${entry.error}\n`,
    )
    return
  }
  entry.published = true
  report.baseline = entry
  process.stdout.write(
    `::notice::baseline ${args.publishBaseline} atualizado para ${value}s (medido ${report.durationSecs}s, margem ${args.baselineMargin ?? 0.2}) — o gate agora consulta a variável em vez do literal\n`,
  )
}

/**
 * Aplica o GATE de budget em TRÊS FAIXAS (--max duro + --warn soft + --alert
 * suave) sobre o report já montado — COMPARTILHADO entre os modos
 * --jobs-file/--run e --act-log (fonte única da verdade da semântica das
 * zonas; o mutation test trava a paridade dos dois modos). Escalada suave
 * em QUATRO níveis:
 *   'ok'     — d <= alert                          → exit 0, silencioso
 *   'notice' — alert < d <= warn (faixa SUAVE)     → ::notice:: + exit 0
 *   'warn'   — warn < d <= max (faixa SOFT)        → ::warning:: + exit 0
 *   'fail'   — d > max (faixa DURO)                → ::error:: + exit 1
 * (com --warn-only: a faixa fail também vira ::warning:: + exit 0). O
 * relatório carrega budgetSecs/warnSecs/alertSecs/zone/exceeded/warned/
 * noticed — o caller distingue notice (found:true, noticed:true) de warn
 * (warned:true) de fail (exceeded:true) de infra (found:false) e drift
 * (exit 2). Helper único (applyBudgetGate) compartilhado com o modo
 * --act-log — semântica idêntica nas duas fontes.
 *
 * @param {object} report relatório (já com durationSecs; ganha budget/warn/alert/zone)
 * @param {object} args   args parseados (max/warn/alert/warnOnly/json)
 * @param {string} stepName nome do step para a mensagem
 * @param {string} viaSuffix sufixo descritivo da fonte (ex.: '(medido via act)')
 */
function applyBudgetGate(report, args, stepName, viaSuffix) {
  if (args.max === null) return
  report.budgetSecs = args.max
  if (args.warn !== null) report.warnSecs = args.warn
  if (args.alert !== null) report.alertSecs = args.alert

  // ── ESCALADA SUAVE EM QUATRO NÍVEIS (--alert < --warn < --max) ───────
  // A faixa notice observa o drift cedo (ruído baixo, ::notice::) ANTES do
  // warning acender; a faixa warn tolera o ruído médio; o duro é o gate.
  // ── GATE DE DRIFT RELATIVO (--fail-drift PCT): o --max vira TETO ABSOLUTO
  // de segurança (d > max falha SEMPRE) e o drift relativo vs a MEDIANA do
  // histórico falha ANTES do teto quando `(d - mediana)/mediana > PCT` — o
  // PR pega a regressão por DESVIO RELATIVO mesmo num payload que ainda
  // caberia no teto. driftPct null (sem histórico) → gate só no teto.
  let zone = "ok"
  if (report.durationSecs > args.max) {
    zone = "fail" // TETO ABSOLUTO — falha sempre, mesmo com drift pequeno
  } else if (
    args.failDrift !== null &&
    typeof report.driftPct === "number" &&
    report.driftPct > args.failDrift
  ) {
    zone = "fail" // DRIFT RELATIVO excedeu o threshold configurável
  } else if (args.warn !== null && report.durationSecs > args.warn) {
    zone = "warn"
  } else if (args.alert !== null && report.durationSecs > args.alert) {
    zone = "notice"
  }
  report.zone = zone
  report.exceeded = report.durationSecs > args.max
  report.drifted =
    args.failDrift !== null &&
    typeof report.driftPct === "number" &&
    report.driftPct > args.failDrift
  report.warned = zone === "warn"
  report.noticed = zone === "notice"
  const via = viaSuffix ? ` ${viaSuffix}` : ""

  // Publish do baseline (--publish-baseline): SÓ quando o budget passou
  // (zone ok/notice/warn — exit 0). maybePublishBaseline filtra zone fail internamente
  // (defensivo) e o parseArgs já rejeita --publish-baseline + --act-log.
  maybePublishBaseline(report, args)

  if (zone === "fail") {
    // Duas causas de fail com --fail-drift: TETO ABSOLUTO (exceeded — d >
    // max) ou DRIFT RELATIVO (drifted — desvio vs mediana > PCT). A mensagem
    // distingue a causa para o PR debugar a regressão (teto = payload já
    // estourou; drift = lento RELATIVO à mediana, mesmo dentro do teto).
    const msg = report.drifted
      ? `drift relativo EXCEDIDO: step '${stepName}' durou ${report.durationSecs}s vs ` +
        `mediana ${report.driftMedianSecs}s (+${report.driftPct.toFixed(1)}% > limiar ` +
        `${args.failDrift}%) — regressão de overhead relativa ao histórico${via}; ` +
        `teto absoluto ${args.max}s intacto`
      : `budget de payload EXCEDIDO (faixa dura): step '${stepName}' durou ` +
        `${report.durationSecs}s > budget ${args.max}s — regressão de overhead ` +
        `do contrato coordenado${via}`
    if (args.warnOnly) {
      // ::warning:: no STDOUT (o runner do Actions parseia os comandos de
      // workflow do stdout do step) — alerta audível, não-bloqueante.
      process.stdout.write(`::warning::${msg}\n`)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      emit(report, args.json)
      process.exit(0)
    }
    // ::error:: no STDOUT (convenção do repo — os gates de CI usam
    // ::error:: para a anotação aparecer na UI do checks sem abrir o log): a
    // mensagem vem ANTES do JSON, que o teste extrai via regex de chaves e o
    // job lê do arquivo (--json), então não polui nada.
    process.stdout.write(`::error::${msg}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    emit(report, args.json)
    process.exit(1)
  }

  if (zone === "warn") {
    const msg =
      `budget de payload na faixa de WARN (soft): step '${stepName}' durou ` +
      `${report.durationSecs}s > warn ${args.warn}s (budget duro ` +
      `${args.max}s) — ruído de runner tolerado${via}, observa o drift antes ` +
      `do gate falhar`
    process.stdout.write(`::warning::${msg}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    emit(report, args.json)
    process.exit(0)
  }

  if (zone === "notice") {
    const msg =
      `budget de payload na faixa de NOTICE (suave): step '${stepName}' durou ` +
      `${report.durationSecs}s > alert ${args.alert}s (warn ${args.warn}s, ` +
      `budget duro ${args.max}s) — escalada suave: ruído de runner baixo${via}, ` +
      `observa o drift cedo antes do warning acender`
    process.stdout.write(`::notice::${msg}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    emit(report, args.json)
    process.exit(0)
  }
}

/** writeFileSync já importado no topo — helper de escrita do relatório. */
function emit(report, jsonPath) {
  const json = JSON.stringify(report, null, 2)
  if (jsonPath) {
    try {
      writeFileSync(jsonPath, json)
    } catch (e) {
      process.stderr.write(`aviso: não foi possível salvar --json '${jsonPath}': ${e.message}\n`)
    }
  }
}

// Guard de entry-point ESM: as funções puras (extractMutationStep,
// computeDurationSecs) são importadas pelos testes — main() só roda quando o
// script é executado DIRETAMENTE (node scripts/...), nunca no import.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntryPoint) {
  main()
}
