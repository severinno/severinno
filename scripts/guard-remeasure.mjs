#!/usr/bin/env node
/**
 * guard-remeasure.mjs - a re-mediacao do guard-gates em 1 comando (2026-08-12).
 *
 * WHY: a re-mediacao da sec 8.1 (a banda 19-23.5s do step test:guard do
 * guard-gates.yml) era um ciclo MANUAL de 4 passos: (1) dispatch do
 * guard-gates via ci-proof-run, (2) abrir o log capturado no tmpdir, (3)
 * extrair os timestamps do step "Run guard vitest suites" e subtrair, (4)
 * comparar com a banda e escrever o veredito na doc. A re-mediacao (6)
 * (sec 8.1, run 31595541005) foi a ultima a pagar esse custo. Este helper
 * automatiza o ciclo completo no padrao do doc-revalidate (sec 11.61): o
 * ciclo manual vira 1 invocacao, e o veredito do no-filter e impresso.
 *
 * FLUXO:
 *   1. parse + validacao (--branch ci-proof/*, --band "min-max").
 *   2. [ciclo] spawn do ci-proof-run (o helper de prova-CI existente, sec
 *      11.20): dispatch do guard-gates.yml, poll do job 'Guard Gates
 *      (fragile-range + golden-copy)', --expect success, captura do log do
 *      JOB no tmpdir (--only-jobs - o log do job, nao o run inteiro). O
 *      DONE line do ci-proof-run (`DONE run=... conclusion=success
 *      log=<path>`) entrega o path do log capturado.
 *   3. extracao (pura): stepSpan(log, STEP_NAME) - o span wall-clock entre
 *      a 1a linha do step (o ##[group] com o timestamp) e a 1a linha do
 *      PROXIMO step (o delimitador de fim) - o MESMO numero que a tabela da
 *      sec 8.1 reporta (22.47s na re-mediacao (6) vs vitest Duration
 *      21.87s - o span do step e o custo que o CI cobra).
 *   4. veredito (puro): dentro da banda (GUARD_BAND) = no-filter continua
 *      calibrado (exit 0, o padrao --check dos guards); fora = ALERTA de
 *      reabertura da decisao (exit 1) - a regra da sec 8.1 ("se a proxima
 *      re-mediacao confirmar a subida, a decisao deve ser re-aberta").
 *
 * USO (bash/git-bash):
 *   node scripts/guard-remeasure.mjs [--branch ci-proof/remeasure-<date>]
 *     [--band "19-23.5"] [--timeout <s>] [--keep-branch]
 *     [--stash-uncommitted] [--clean] [--dry-run]
 *   node scripts/guard-remeasure.mjs --log <path> [--band "19-23.5"]
 *   --log <path>: extracao read-only de um log JA capturado (sem dispatch)
 *     - util para re-vereditar um log de um run anterior.
 *   --band "min-max": override da banda registrada (default GUARD_BAND,
 *     o fato calibrado da sec 8.1; pinado contra a doc no teste).
 *   --timeout/--keep-branch/--stash-uncommitted/--clean: repassados ao
 *     ci-proof-run (--clean adiciona --expect-success-implies-clean, sec
 *     11.43 - a limpeza do run vira contrato, nao leitura manual).
 *   --dry-run: imprime o plano (comando do ci-proof-run + a extracao +
 *     o veredito esperado) sem executar nada.
 *
 * Exit codes: 0 = step dentro da banda (no-filter calibrado, sec 8.1); 1 =
 * step FORA da banda (o ALERTA de reabertura - o padrao --check dos
 * guards) OU falha de execucao (ci-proof-run nao success, log ausente,
 * step nao encontrado no log); 2 = usage (flag desconhecida / --band
 * malformado).
 *
 * HERMETICIDADE (testes): o subprocesso do ci-proof-run e spawnado via
 * GUARD_REMEASURE_CIPROOF_CMD (env override apontando para o fixture
 * guard-remeasure-fake-cmd.mjs - o mesmo padrao do DOC_REVALIDATE_CLI_CMD
 * da sec 8.37/11.61); o fake imprime um DONE line apontando para um log
 * que o teste escreve, e a extracao REAL roda sobre ele. As funcoes de
 * extracao sao puras (testadas com log sintetico, incluindo o BOM do
 * ##[group] e os timestamps ISO). ASCII puro (gate file). Puro node, sem
 * deps.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// O fato calibrado da sec 8.1 (re-mediacoes 2-6: 20 -> 20.9 -> 19 -> 22.2 ->
// 23.5 -> 22.5s). Exported (o teste pina contra o texto da doc - uma
// recalibracao da banda exige editar os DOIS lugares, nao so este const).
export const GUARD_BAND = { min: 19, max: 23.5 }

// O job e o step alvo: o DISPLAY name do job (o --only-jobs do ci-proof-run
// casa pelo display name, nao pelo key) e o name: do step que a sec 8.1
// mede (Run guard vitest suites).
const JOB_DISPLAY = "Guard Gates (fragile-range + golden-copy)"
const STEP_NAME = "Run guard vitest suites (BASELINE + divergence guards)"
const WORKFLOW = ".github/workflows/guard-gates.yml"

const USAGE =
  "usage: node scripts/guard-remeasure.mjs [--branch ci-proof/remeasure-<date>] [--band \"19-23.5\"] [--timeout <s>] [--keep-branch] [--stash-uncommitted] [--clean] [--dry-run] | --log <path>"

/**
 * parseArgs - SEMPRE retorna a shape completa { branch, band, log, timeout,
 * keep, stash, clean, dryRun, error } com error: null no sucesso. O branch
 * default e ci-proof/remeasure-<data-local> (o namespace Type E, sec 11.20);
 * o band default e GUARD_BAND.
 */
export function parseArgs(argv) {
  const out = {
    branch: null,
    band: { ...GUARD_BAND },
    log: null,
    timeout: null,
    keep: false,
    stash: false,
    clean: false,
    dryRun: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--branch") {
      out.branch = argv[i + 1] ?? null
      i++
    } else if (a === "--band") {
      const raw = argv[i + 1] ?? null
      i++
      const m = raw ? raw.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/) : null
      if (!m) {
        out.error = `--band deve ser \"min-max\" (ex.: \"19-23.5\"): recebido '${raw}'`
        break
      }
      out.band = { min: Number(m[1]), max: Number(m[2]) }
      if (out.band.min > out.band.max) {
        out.error = `--band com min > max: ${raw}`
        break
      }
    } else if (a === "--log") {
      out.log = argv[i + 1] ?? null
      i++
    } else if (a === "--timeout") {
      out.timeout = Number(argv[i + 1]) || null
      i++
    } else if (a === "--keep-branch") out.keep = true
    else if (a === "--stash-uncommitted") out.stash = true
    else if (a === "--clean") out.clean = true
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--help") {
      out.error = USAGE
      break
    } else {
      out.error = `flag desconhecida: ${a}`
      break
    }
  }
  if (!out.branch) out.branch = `ci-proof/remeasure-${todayLocal()}`
  return out
}

/** A data LOCAL de hoje (YYYY-MM-DD) - a convencao das secoes 8.x (sec 11.61). */
function todayLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * parseLogTs - extrai o timestamp ISO do campo de log do GitHub Actions
 * (`<job>\t<step>\t<TIMESTAMP> <resto>`; o 1o ##[group] do log carrega um
 * BOM \uFEFF antes do timestamp). Retorna ms | null.
 */
export function parseLogTs(field) {
  const m = (field || "").match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/)
  if (!m) return null
  const ms = Date.parse(m[1])
  return Number.isNaN(ms) ? null : ms
}

/**
 * stepSpan - o span wall-clock do step: a 1a linha do step (o ##[group] com
 * o timestamp inicial) ate a 1a linha do PROXIMO step (o delimitador de
 * fim). Retorna { startMs, endMs, seconds } | null (step nao encontrado ou
 * log incompleto - sem o proximo step para delimitar o fim).
 */
export function stepSpan(log, stepName) {
  const lines = (log || "").split(/\r?\n/)
  let startMs = null
  for (const line of lines) {
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const step = parts[1]
    const ts = parseLogTs(parts[2])
    if (ts == null) continue
    if (startMs === null && step === stepName) {
      startMs = ts
      continue
    }
    if (startMs !== null && step !== stepName) {
      return { startMs, endMs: ts, seconds: (ts - startMs) / 1000 }
    }
  }
  return null
}

/**
 * extractTestCounts - o resumo do vitest do log (Test Files N passed /
 * Tests M passed, ANSI-stripped). Retorna { files, tests } | null.
 */
export function extractTestCounts(log) {
  const strip = (log || "").replace(/\u001b\[[0-9;]*m/g, "")
  const files = strip.match(/Test Files\s+(\d+) passed/)
  const tests = strip.match(/Tests\s+(\d+) passed/)
  if (!files || !tests) return null
  return { files: Number(files[1]), tests: Number(tests[1]) }
}

/**
 * bandVerdict - o veredito do no-filter (sec 8.1): dentro da banda =
 * calibrado (ok); fora = o ALERTA de reabertura da decisao. Pure.
 */
export function bandVerdict(seconds, band) {
  if (seconds >= band.min && seconds <= band.max) {
    return {
      ok: true,
      message: `step test:guard = ${seconds.toFixed(1)}s - dentro da banda ${band.min}-${band.max}s - no-filter continua calibrado (sec 8.1)`,
    }
  }
  return {
    ok: false,
    message: `ALERTA: step test:guard = ${seconds.toFixed(1)}s FORA da banda ${band.min}-${band.max}s - reabrir a decisao da sec 8.1 (o ALERTA de monitoramento vigora pela banda, nao pela saturacao)`,
  }
}

/**
 * parseDoneLine - o DONE line do ci-proof-run: `DONE run=<id>
 * url=<url> conclusion=<c> log=<path>` (o path do log capturado no tmpdir).
 * Retorna { run, url, conclusion, log } | null.
 */
export function parseDoneLine(stdout) {
  const m = (stdout || "").match(/DONE run=(\d+) url=(\S+) conclusion=(\w+) log=(\S+)/)
  if (!m) return null
  return { run: m[1], url: m[2], conclusion: m[3], log: m[4] }
}

/**
 * buildCiproveCmd - o comando default do ci-proof-run (dispatch do
 * guard-gates + poll do job + --expect success + captura do log do job).
 * Exported (o dry-run o imprime e o teste pina a forma).
 */
export function buildCiproveCmd(opts) {
  let cmd = `node scripts/ci-proof-run.mjs --branch ${opts.branch} --workflow ${WORKFLOW} --only-jobs "${JOB_DISPLAY}" --expect success`
  if (opts.stash) cmd += " --stash-uncommitted"
  if (opts.timeout) cmd += ` --timeout ${opts.timeout}`
  if (opts.clean) cmd += " --expect-success-implies-clean"
  if (opts.keep) cmd += " --keep-branch"
  return cmd
}

function fail(code, msg) {
  console.error(`guard-remeasure: ${msg}`)
  return code
}

/** O veredito sobre um log (a extracao + a comparacao com a banda). */
function verdict(log, band) {
  const span = stepSpan(log, STEP_NAME)
  if (!span) {
    return fail(
      1,
      `step '${STEP_NAME}' nao encontrado no log (ou log incompleto - sem o step seguinte para delimitar o fim): o log do job guard-gates tem as linhas '<job>\\t<step>\\t<timestamp> ...'`,
    )
  }
  const counts = extractTestCounts(log)
  console.log(
    `guard-remeasure: ${STEP_NAME} = ${span.seconds.toFixed(2)}s (${new Date(span.startMs).toISOString()} -> ${new Date(span.endMs).toISOString()})` +
      (counts ? ` - ${counts.files} suites / ${counts.tests} testes` : ""),
  )
  const v = bandVerdict(span.seconds, band)
  console.log(`guard-remeasure: veredito: ${v.message}`)
  return v.ok ? 0 : 1
}

/**
 * Main flow. Retorna o exit code (o entry-point guard seta process.exitCode).
 * Exit 0 = calibrado (ou dry-run); 1 = fora da banda / falha de execucao;
 * 2 = usage.
 */
export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.error) return fail(2, opts.error)

  if (opts.dryRun) {
    console.log(`guard-remeasure: PLAN (dry-run) branch=${opts.branch} workflow=${WORKFLOW} job='${JOB_DISPLAY}' (nenhum comando executado)`)
    console.log(`  shell: ${buildCiproveCmd(opts)}`)
    console.log(`  extracao: stepSpan(log, '${STEP_NAME}') -> seconds`)
    console.log(`  veredito: dentro da banda ${opts.band.min}-${opts.band.max}s = no-filter calibrado (exit 0); fora = ALERTA (exit 1, sec 8.1)`)
    return 0
  }

  // Modo extracao read-only: um log ja capturado, sem dispatch.
  if (opts.log) {
    const logPath = path.resolve(opts.log)
    if (!fs.existsSync(logPath)) return fail(1, `log nao encontrado: ${logPath}`)
    return verdict(fs.readFileSync(logPath, "utf8"), opts.band)
  }

  // Ciclo completo: dispatch + poll + captura via ci-proof-run (o helper de
  // prova-CI existente - o DONE line entrega o path do log no tmpdir).
  const cmd = process.env.GUARD_REMEASURE_CIPROOF_CMD || buildCiproveCmd(opts)
  console.log(`guard-remeasure: dispatch do guard-gates (${opts.branch}) - poll do job '${JOB_DISPLAY}'`)
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", cwd: process.cwd() })
  if (r.status !== 0) {
    return fail(1, `ci-proof-run falhou (exit ${r.status}): ${(r.stderr || r.stdout || "").slice(-400)}`)
  }
  const done = parseDoneLine(r.stdout || "")
  if (!done) {
    return fail(1, `nao achou o DONE line do ci-proof-run no stdout (esperava 'DONE run=... log=<path>')`)
  }
  console.log(`guard-remeasure: run #${done.run} (${done.conclusion}) - ${done.url}`)
  if (done.conclusion !== "success") {
    return fail(1, `o run nao concluiu success (${done.conclusion}) - sem step para medir`)
  }
  const logPath = done.log.replace(/^"|"$/g, "")
  if (!fs.existsSync(logPath)) return fail(1, `log capturado nao encontrado: ${logPath}`)
  return verdict(fs.readFileSync(logPath, "utf8"), opts.band)
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// as funcoes puras para os testes sem efeitos colaterais - o padrao da sec
// 11.37).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
