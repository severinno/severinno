#!/usr/bin/env node
// =============================================================================
// bench-guard-timing.mjs — benchmark de wall time do doctor e dos guards
//
// POR QUE EXISTE: a suíte do doctor e a bateria de guards são os gates que
// decidem o merge. Uma regressão de tempo nelas afeta CADA PR — mas sem
// medição versionada, a degradação é impressão, não dado comparável entre
// commits. Este script mede o wall time de cada guard individual e do doctor
// (perfil --ci), registra em JSON versionado (commit + timestamp) e permite
// comparação contra um baseline.
//
// Usage:
//   node scripts/bench-guard-timing.mjs                # mede e imprime
//   node scripts/bench-guard-timing.mjs --json         # salva em latest
//   node scripts/bench-guard-timing.mjs --save         # salva com data
//   node scripts/bench-guard-timing.mjs --compare      # mede e compara vs baseline
//   node scripts/bench-guard-timing.mjs --baseline     # salva como baseline
//   node scripts/bench-guard-timing.mjs --json --compare  # salva + compara
//
// Exit codes:
//   0 — benchmark completo
//   1 — falha de infra ou comparação com regressão
//   2 — argumento inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, "..")
const BENCH_DIR = join(REPO_ROOT, "docs", "benchmarks")
const LATEST_FILE = "guard-timing-latest.json"
const BASELINE_FILE = "guard-timing-baseline.json"

// ── Guards individuais (comando → label) ──────────────────────────────────
// Lista derivada de .gitea/workflows/ci.yml: cada `run:` do job `guards`
// que é um gate verificável. Ordem = ordem de execução na pipeline.
const GUARDS = [
  { cmd: "bun run check:required-checks", label: "check:required-checks" },
  { cmd: "node scripts/check-script-headers.mjs", label: "check:script-headers" },
  { cmd: "bun run check:prove-docs", label: "check:prove-docs" },
  { cmd: "bun run check:registry-source", label: "check:registry-source" },
  { cmd: "bun scripts/check-doctor-ci.mjs", label: "check:doctor-ci" },
  { cmd: "bun run check:runner-base", label: "check:runner-base" },
  { cmd: "bun run check:workflow-refs:internal", label: "check:workflow-refs" },
  { cmd: "bun run check:ts-nocheck", label: "check:ts-nocheck" },
  { cmd: "bun run check:forge-workflow-scope", label: "check:forge-workflow-scope" },
  { cmd: "bun run check:forge-parity", label: "check:forge-parity" },
  { cmd: "bun run check:bun-audit-baseline", label: "check:bun-audit" },
  { cmd: "bun scripts/rotate-secrets.mjs --check", label: "check:secret-leaks" },
  { cmd: "bun run check:seed-hooks", label: "check:seed-hooks" },
  { cmd: "bun run check:sentinel-producer", label: "check:sentinel-producer" },
  { cmd: "bun run check:bun-mirror", label: "check:bun-mirror" },
  { cmd: "bun run check:no-setup-bun", label: "check:no-setup-bun" },
  { cmd: "bun scripts/check-hooks-symmetry.mjs", label: "check:hooks-symmetry" },
  { cmd: "node scripts/prove-runner-image-gate.mjs", label: "runner-image:prove" },
]

// Doctor (perfil --ci): roda a bateria de guards + contrato + mirrors, sem
// docker/rede/proteção/runner-labels/board. Exit 0 = PRONTA, 2 = INDETERMINADA.
const DOCTOR_CMD =
  "node scripts/forge-doctor.mjs --ci --json --expected ${BUN_VERSION} --expected-var IMAGE_REGISTRY=${IMAGE_REGISTRY} --expected-var IMAGE_NAMESPACE=${IMAGE_NAMESPACE}"

// ── Helpers ───────────────────────────────────────────────────────────────

function getCommitHash() {
  try {
    const { stdout } = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5_000,
    })
    return stdout.trim()
  } catch {
    return "unknown"
  }
}

function getCommitTimestamp() {
  try {
    const { stdout } = spawnSync("git", ["log", "-1", "--format=%ci"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5_000,
    })
    return stdout.trim()
  } catch {
    return new Date().toISOString()
  }
}

/** Mede o wall time de um comando. Devolve {ms, exit, ok}. */
function measure(cmd, { timeoutMs = 120_000, env = process.env } = {}) {
  const start = performance.now()
  const res = spawnSync("bash", ["-c", cmd], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const ms = Math.round(performance.now() - start)
  return {
    ms,
    exit: res.status,
    ok: res.status === 0 || res.status === 2, // 2 = INDETERMINADA (doctor)
    stderr: (res.stderr ?? "").slice(-500),
  }
}

// ── Benchmark ─────────────────────────────────────────────────────────────

function runBenchmark() {
  const commit = getCommitHash()
  const commitDate = getCommitTimestamp()
  const timestamp = new Date().toISOString()

  // Envia vars do ambiente ou fallbacks para o doctor --ci
  const bunVersion = process.env.BUN_VERSION || "1.3.14"
  const imageRegistry = process.env.IMAGE_REGISTRY || "ghcr.io"
  const imageNamespace = process.env.IMAGE_NAMESPACE || "severinno"

  const doctorEnv = {
    ...process.env,
    BUN_VERSION: bunVersion,
    IMAGE_REGISTRY: imageRegistry,
    IMAGE_NAMESPACE: imageNamespace,
  }

  // ── Guards individuais ──────────────────────────────────────────────────
  const guards = []
  let guardsTotalMs = 0
  for (const g of GUARDS) {
    const r = measure(g.cmd)
    guards.push({
      label: g.label,
      cmd: g.cmd,
      ms: r.ms,
      exit: r.exit,
      ok: r.ok,
    })
    guardsTotalMs += r.ms
  }

  // ── Doctor (perfil --ci) ────────────────────────────────────────────────
  const doctorCmd = DOCTOR_CMD.replace(/\$\{BUN_VERSION\}/g, bunVersion)
    .replace(/\$\{IMAGE_REGISTRY\}/g, imageRegistry)
    .replace(/\$\{IMAGE_NAMESPACE\}/g, imageNamespace)
  const doctorResult = measure(doctorCmd, { env: doctorEnv })

  // ── Soma total ─────────────────────────────────────────────────────────
  const totalMs = guardsTotalMs + doctorResult.ms

  const result = {
    meta: {
      tool: "bench-guard-timing",
      version: 1,
      commit,
      commitDate,
      timestamp,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    summary: {
      guardsCount: guards.length,
      guardsTotalMs,
      doctorMs: doctorResult.ms,
      doctorExit: doctorResult.exit,
      totalMs,
    },
    guards,
    doctor: {
      label: "doctor --ci",
      cmd: doctorCmd,
      ms: doctorResult.ms,
      exit: doctorResult.exit,
      ok: doctorResult.ok,
    },
  }

  return result
}

// ── Relatório legível ─────────────────────────────────────────────────────

function printReport(result) {
  const { meta, summary, guards, doctor } = result
  console.log()
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log("   ⏱  BENCH — wall time do doctor e guards")
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log()
  console.log(`  commit: ${meta.commit} (${meta.commitDate})`)
  console.log(`  node: ${meta.nodeVersion} · ${meta.platform}/${meta.arch}`)
  console.log()

  // Tabela de guards
  console.log("  Guards individuais:")
  console.log("  ─────────────────────────────────────────────────────")
  for (const g of guards) {
    const mark = g.ok ? "✅" : "❌"
    const time = `${(g.ms / 1000).toFixed(1)}s`
    console.log(`    ${mark} ${g.label.padEnd(30)} ${time.padStart(8)}  (exit ${g.exit})`)
  }
  console.log("  ─────────────────────────────────────────────────────")
  console.log(
    `  Total guards: ${(summary.guardsTotalMs / 1000).toFixed(1)}s (${summary.guardsCount} gates)`,
  )
  console.log()

  // Doctor
  const dMark = doctor.ok ? "✅" : "❌"
  console.log(`  Doctor (--ci): ${dMark} ${(doctor.ms / 1000).toFixed(1)}s (exit ${doctor.exit})`)
  console.log()

  // Total
  console.log(`  TOTAL: ${(summary.totalMs / 1000).toFixed(1)}s`)
  console.log()
}

// ── Comparação ────────────────────────────────────────────────────────────

function loadBaseline() {
  const p = join(BENCH_DIR, BASELINE_FILE)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function compareReport(current, baseline) {
  if (!baseline) {
    console.log("  ⚠️  Sem baseline para comparar. Execute com --baseline primeiro.")
    return { regression: false }
  }

  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log("   📊 COMPARAÇÃO vs baseline")
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log()
  console.log(`  baseline: ${baseline.meta?.commit ?? "?"} (${baseline.meta?.timestamp ?? "?"})`)
  console.log(`  atual:    ${current.meta.commit} (${current.meta.timestamp})`)
  console.log()

  const THRESHOLD = 0.2 // 20% de piora é regressão
  let regression = false

  // Guards individuais
  const baselineGuards = new Map((baseline.guards ?? []).map((g) => [g.label, g]))
  console.log("  Guards:")
  console.log("  ─────────────────────────────────────────────────────")
  for (const g of current.guards) {
    const b = baselineGuards.get(g.label)
    if (!b) {
      console.log(`    ➕ ${g.label.padEnd(30)} ${(g.ms / 1000).toFixed(1)}s (novo)`)
      continue
    }
    const diff = g.ms - b.ms
    const pct = b.ms > 0 ? diff / b.ms : 0
    const arrow = diff > 0 ? "📈" : diff < 0 ? "📉" : "  "
    const sign = diff > 0 ? "+" : ""
    const flag = pct > THRESHOLD ? " ⚠️  REGRESSÃO" : ""
    console.log(
      `    ${arrow} ${g.label.padEnd(30)} ${(g.ms / 1000).toFixed(1)}s (${sign}${(diff / 1000).toFixed(1)}s, ${sign}${(pct * 100).toFixed(0)}%)${flag}`,
    )
    if (pct > THRESHOLD) regression = true
  }
  console.log("  ─────────────────────────────────────────────────────")

  // Doctor
  const bDoctor = baseline.doctor
  if (bDoctor) {
    const diff = current.doctor.ms - bDoctor.ms
    const pct = bDoctor.ms > 0 ? diff / bDoctor.ms : 0
    const arrow = diff > 0 ? "📈" : diff < 0 ? "📉" : "  "
    const sign = diff > 0 ? "+" : ""
    const flag = pct > THRESHOLD ? " ⚠️  REGRESSÃO" : ""
    console.log(
      `    ${arrow} doctor --ci${" ".repeat(20)} ${(current.doctor.ms / 1000).toFixed(1)}s (${sign}${(diff / 1000).toFixed(1)}s, ${sign}${(pct * 100).toFixed(0)}%)${flag}`,
    )
    if (pct > THRESHOLD) regression = true
  }

  // Total
  const bTotal = baseline.summary?.totalMs ?? 0
  const totalDiff = current.summary.totalMs - bTotal
  const totalPct = bTotal > 0 ? totalDiff / bTotal : 0
  const totalSign = totalDiff > 0 ? "+" : ""
  console.log()
  console.log(
    `  TOTAL: ${(current.summary.totalMs / 1000).toFixed(1)}s (${totalSign}${(totalDiff / 1000).toFixed(1)}s vs baseline)`,
  )
  if (totalPct > THRESHOLD) {
    console.log(`  ⚠️  REGRESSÃO DE TEMPO: +${(totalPct * 100).toFixed(0)}% (limiar: 20%)`)
    regression = true
  }

  console.log()
  return { regression }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    json: false,
    save: false,
    baseline: false,
    compare: false,
    help: false,
    error: null,
  }
  for (const arg of argv) {
    if (arg === "--json") opts.json = true
    else if (arg === "--save") opts.save = true
    else if (arg === "--baseline") opts.baseline = true
    else if (arg === "--compare") opts.compare = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else opts.error = `argumento desconhecido: ${arg}`
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(`bench-guard-timing — mede wall time do doctor e guards

Usage:
  node scripts/bench-guard-timing.mjs                # mede e imprime
  node scripts/bench-guard-timing.mjs --json         # salva em latest
  node scripts/bench-guard-timing.mjs --save         # salva com data
  node scripts/bench-guard-timing.mjs --baseline     # salva como baseline
  node scripts/bench-guard-timing.mjs --compare      # compara vs baseline
  node scripts/bench-guard-timing.mjs --json --compare  # salva + compara

Exit codes: 0 sucesso · 1 falha/regressão · 2 argumento inválido`)
    return 0
  }
  if (opts.error) {
    console.error(`bench-guard-timing: ${opts.error}`)
    return 2
  }

  const result = runBenchmark()
  printReport(result)

  // Salvar
  if (opts.json || opts.save || opts.baseline) {
    mkdirSync(BENCH_DIR, { recursive: true })
  }

  if (opts.baseline) {
    const p = join(BENCH_DIR, BASELINE_FILE)
    writeFileSync(p, JSON.stringify(result, null, 2) + "\n")
    console.log(`  📁 Baseline salvo: ${p}`)
  } else if (opts.json) {
    const p = join(BENCH_DIR, LATEST_FILE)
    writeFileSync(p, JSON.stringify(result, null, 2) + "\n")
    console.log(`  📁 Resultado salvo: ${p}`)
  }

  if (opts.save && !opts.baseline) {
    const date = new Date().toISOString().slice(0, 10)
    const p = join(BENCH_DIR, `guard-timing-${date}.json`)
    writeFileSync(p, JSON.stringify(result, null, 2) + "\n")
    console.log(`  📁 Resultado salvo: ${p}`)
  }

  // Comparar
  if (opts.compare) {
    const baseline = loadBaseline()
    const { regression } = compareReport(result, baseline)
    if (regression) return 1
  }

  return 0
}

process.exit(main())
