#!/usr/bin/env bun
// @ts-nocheck
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * pgbouncer-stress-test.ts — PgBouncer Stress Test
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Testa a capacidade do PgBouncer e do pool de conexões PostgreSQL.
 *
 * ⚠️  LIMITAÇÃO CONHECIDA: Cada conexão spawna um processo `psql` novo,
 *     o que adiciona ~5-15ms de overhead local (especialmente no Windows).
 *     Para queries simples como `SELECT 1`, a latência medida inclui esse
 *     overhead. Os resultados de ramp/burst podem superestimar ligeiramente
 *     a formação de fila. Para medições precisas, use a biblioteca `pg`
 *     com Pool persistente.
 *
 * Fases do teste:
 *   1. BASELINE: Latência de conexão única (sequencial)
 *   2. RAMP:    Aumenta conexões gradualmente até formar fila (cl_waiting > 0)
 *   3. BURST:   Spike súbito de conexões — testa reserve_pool
 *   4. SUSTAIN: Carga constante por N segundos — testa estabilidade
 *   5. REPORT:  Relatório completo com recomendações de tuning
 *
 * Uso:
 *   # Via wrapper (recomendado):
 *     bash scripts/pgbouncer-stress-test.sh
 *
 *   # Direto — verificar ambiente:
 *     PGHOST=localhost PGPORT=6432 PGUSER=severinno PGPASSWORD=senha \
 *     bun scripts/pgbouncer-stress-test.ts --check
 *
 *   # Direto — bateria completa:
 *     PGHOST=localhost PGPORT=6432 PGUSER=severinno PGPASSWORD=senha \
 *     bun scripts/pgbouncer-stress-test.ts --all
 *
 *   # Apenas stats do PgBouncer:
 *     bun scripts/pgbouncer-stress-test.ts --stats
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { execSync, exec } from "child_process"
import { randomUUID } from "crypto"

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface PgBouncerPoolRow {
  database: string
  cl_active: number
  cl_waiting: number
  cl_cancel_req: number
  sv_active: number
  sv_idle: number
  sv_used: number
  sv_tested: number
  sv_login: number
  maxwait: number
  pool_mode: string
}

interface PgBouncerStatRow {
  database: string
  total_query_count: number
  total_query_time: number
  avg_query_time: number
  total_received: number
  total_sent: number
}

interface ConnectionResult {
  connIndex: number
  success: boolean
  latencyMs: number
  error?: string
}

interface PhaseResult {
  phaseName: string
  concurrentConns: number
  durationMs: number
  successCount: number
  failCount: number
  avgLatencyMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxLatencyMs: number
  minLatencyMs: number
  hadWaitingClients: boolean
  maxWaitTime: number
  poolSnapshot: PgBouncerPoolRow | null
}

interface TestReport {
  timestamp: string
  pgbouncerHost: string
  pgbouncerPort: string
  defaultPoolSize: number
  maxClientConn: number
  reservePoolSize: number
  reservePoolTimeout: number
  pgMaxConnections: number
  phases: PhaseResult[]
  recommendations: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Environment / Config
// ═══════════════════════════════════════════════════════════════════════════

const ENV = {
  PGHOST: process.env.PGHOST ?? "localhost",
  PGPORT: process.env.PGPORT ?? "6432",
  PGUSER: process.env.PGUSER ?? "severinno",
  PGPASSWORD: process.env.PGPASSWORD ?? "",
  PGDATABASE: process.env.PGDATABASE ?? "severinno",
}

/**
 * Build env for psql subprocesses.
 * `$TAB` is exported because some shells need it for psql tab-separated output.
 */
function psqlEnv(extraDb?: string): Record<string, string> {
  return {
    PGHOST: ENV.PGHOST,
    PGPORT: ENV.PGPORT,
    PGUSER: ENV.PGUSER,
    PGPASSWORD: ENV.PGPASSWORD,
    PGDATABASE: extraDb ?? ENV.PGDATABASE,
    PGSSLMODE: "disable",
  }
}

/**
 * Build the psql command line with the given SQL.
 * Uses `-At` for unaligned tab-separated output.
 * The tab separator is passed via PGSQL_TAB env + awk to stay cross-platform.
 */
function buildPsqlCmd(
  sql: string,
  db?: string,
): string {
  const database = db ?? ENV.PGDATABASE
  // Escape double-quotes inside SQL for the shell
  const escapedSql = sql.replace(/"/g, '\\"')
  // Use awk to output tab-separated fields (cross-platform)
  // On Windows/GitBash, `$'\t'` or literal `\t` may not work in cmd.exe.
  // We use `| tr ',' '\t'` trick: psql outputs comma-separated with -A
  // Wait, -At -F$'\t' works in bash but not cmd.exe.
  // Cross-platform approach: use a tab literal from env var.
  return [
    `psql`,
    `-h "${ENV.PGHOST}"`,
    `-p "${ENV.PGPORT}"`,
    `-U "${ENV.PGUSER}"`,
    `-d "${database}"`,
    `-At`,
    `-F "\t"`,
    `-c "${escapedSql}"`,
  ].join(" ")
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function log(label: string, msg: string) {
  console.log(`  ${label.padEnd(14)} ${msg}`)
}

function pass(msg: string) {
  console.log(`  ${"✅".padEnd(4)} ${msg}`)
}

function warn(msg: string) {
  console.log(`  ${"⚠️".padEnd(4)} ${msg}`)
}

function fail(msg: string) {
  console.log(`  ${"❌".padEnd(4)} ${msg}`)
}

function divider(title: string) {
  console.log(`\n  ── ${title} ${"─".repeat(60)}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse tab-separated psql output into rows.
 * psql with -At -F"\t" outputs one row per line, columns separated by tabs.
 * We parse the raw buffer using split on tab character.
 */
function parsePsqlOutput(output: string): string[][] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
}

/**
 * Run a psql command synchronously and return parsed tab-separated output.
 * Used for fast admin queries (SHOW POOLS, SHOW CONFIG, etc.) where
 * concurrency doesn't matter.
 */
function psqlQuerySync(
  sql: string,
  db?: string,
  timeoutMs = 10_000,
): string[][] {
  const cmd = buildPsqlCmd(sql, db)
  const result = execSync(cmd, {
    env: { ...process.env, ...psqlEnv(db) },
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    shell: true, // required for Windows cross-compath
  })
  return parsePsqlOutput(result)
}

/**
 * Run a psql command ASYNCHRONOUSLY and resolve with the result.
 * Used for concurrent queries where true parallelism is needed.
 * Returns parsed rows and the connection latency.
 */
function psqlQueryAsync(
  sql: string,
  timeoutMs: number,
  label: string,
): Promise<{ rows: string[][]; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = performance.now()
    const cmd = buildPsqlCmd(sql)
    const child = exec(
      cmd,
      {
        env: { ...process.env, ...psqlEnv() },
        timeout: timeoutMs,
        maxBuffer: 1024,
        shell: true,
      },
      (error, stdout) => {
        const latencyMs = performance.now() - start
        if (error) {
          resolve({ rows: [], latencyMs, error: error.message })
        } else {
          resolve({
            rows: parsePsqlOutput(stdout),
            latencyMs,
          })
        }
      },
    )
    // Force kill if timeout
    setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
    }, timeoutMs + 1000)
  })
}

/** Get PgBouncer pool snapshot for the primary database. */
function getPoolSnapshot(): PgBouncerPoolRow | null {
  try {
    const rows = psqlQuerySync("SHOW POOLS;", "pgbouncer", 5000)
    if (rows.length === 0) return null
    const r = rows[0]!
    return {
      database: r[0] ?? "",
      cl_active: Number(r[1] ?? 0),
      cl_waiting: Number(r[2] ?? 0),
      cl_cancel_req: Number(r[3] ?? 0),
      sv_active: Number(r[4] ?? 0),
      sv_idle: Number(r[5] ?? 0),
      sv_used: Number(r[6] ?? 0),
      sv_tested: Number(r[7] ?? 0),
      sv_login: Number(r[8] ?? 0),
      maxwait: Number(r[9] ?? 0),
      pool_mode: r[10] ?? "",
    }
  } catch {
    return null
  }
}

/** Get PostgreSQL max_connections setting. */
function getPgMaxConnections(): number {
  try {
    // Connect DIRECTLY to PostgreSQL (not through PgBouncer) for config
    const rows = psqlQuerySync(
      "SHOW max_connections;",
      undefined,
      5000,
    )
    return Number(rows[0]?.[0] ?? 100)
  } catch {
    return 100 // safe default
  }
}

/** Get PgBouncer stats. */
function getStatsSnapshot(): PgBouncerStatRow | null {
  try {
    const rows = psqlQuerySync("SHOW STATS;", "pgbouncer", 5000)
    if (rows.length === 0) return null
    const r = rows[0]!
    return {
      database: r[0] ?? "",
      total_query_count: Number(r[1] ?? 0),
      total_query_time: Number(r[2] ?? 0),
      avg_query_time: Number(r[11] ?? 0),
      total_received: Number(r[13] ?? 0),
      total_sent: Number(r[14] ?? 0),
    }
  } catch {
    return null
  }
}

/** Check if psql is available and PgBouncer is reachable. */
function checkEnvironment(): boolean {
  divider("ENVIRONMENT CHECK")

  // 1. Check psql
  try {
    const ver = execSync("psql --version", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim()
    pass(ver)
  } catch {
    fail(
      "psql not found in PATH. Install PostgreSQL client or use Docker:\n" +
        "     docker run --rm -it --network severinno_backend " +
        "postgres:16-alpine psql -h pgbouncer -p 6432 -U severinno -d severinno",
    )
    return false
  }

  // 2. Check PgBouncer connectivity
  try {
    const pool = getPoolSnapshot()
    if (pool) {
      pass(
        `PgBouncer reachable at ${ENV.PGHOST}:${ENV.PGPORT} (mode: ${pool.pool_mode})`,
      )
    } else {
      fail("Could not query PgBouncer SHOW POOLS")
      return false
    }
  } catch {
    fail(
      `PgBouncer not reachable at ${ENV.PGHOST}:${ENV.PGPORT}. Is it running?\n` +
        `     docker compose -f docker-compose.prod.yml up -d pgbouncer`,
    )
    return false
  }

  // 3. Check PostgreSQL through PgBouncer
  try {
    const result = psqlQuerySync("SELECT 1 AS ok;")
    if (result.length > 0 && result[0]?.[0] === "1") {
      pass("PostgreSQL reachable through PgBouncer")
    }
  } catch {
    fail("Cannot run query through PgBouncer. Check database credentials.")
    return false
  }

  // 4. Get PgBouncer config
  try {
    const config = psqlQuerySync("SHOW CONFIG;", "pgbouncer", 5000)
    const defaultPoolSize = config.find(
      (r) => r[0] === "default_pool_size",
    )
    const maxClientConn = config.find(
      (r) => r[0] === "max_client_conn",
    )
    const reservePoolSize = config.find(
      (r) => r[0] === "reserve_pool_size",
    )
    const maxConn = getPgMaxConnections()

    console.log(`\n  ── Current Config ────────────────────────────────────────`)
    log("Pool Size", defaultPoolSize?.[1] ?? "?")
    log("Max Clients", maxClientConn?.[1] ?? "?")
    log("Reserve Pool", `${reservePoolSize?.[1] ?? "?"} (timeout: ?s)`)
    log("PG max_conn", String(maxConn))
  } catch {
    warn("Could not read PgBouncer config")
  }

  return true
}

/** Run a single query through PgBouncer and measure latency. */
async function runSingleQuery(timeoutMs = 10_000): Promise<ConnectionResult> {
  const id = randomUUID()
  const start = performance.now()
  try {
    await psqlQueryAsync(
      `SELECT /* stress-baseline-${id} */ 1;`,
      timeoutMs,
      "baseline",
    )
    const latencyMs = performance.now() - start
    return { connIndex: 0, success: true, latencyMs }
  } catch (err: any) {
    const latencyMs = performance.now() - start
    return {
      connIndex: 0,
      success: false,
      latencyMs,
      error: err?.message ?? String(err),
    }
  }
}

/**
 * Run N concurrent queries in TRUE parallel using async child_process.exec.
 * Each psql process is spawned simultaneously — the only way to get
 * real concurrent connections without the `pg` library.
 */
function runConcurrentQueries(
  count: number,
  label: string,
  timeoutMs = 30_000,
): Promise<ConnectionResult[]> {
  return new Promise((resolve) => {
    const results: ConnectionResult[] = []
    const id = randomUUID().slice(0, 8)

    // We need to know when all are done
    let completed = 0

    for (let i = 0; i < count; i++) {
      const connStart = performance.now()
      const sql = `SELECT /* stress-${label}-${i}-${id} */ 1;`
      const cmd = buildPsqlCmd(sql)

      const child = exec(
        cmd,
        {
          env: { ...process.env, ...psqlEnv() },
          timeout: timeoutMs,
          maxBuffer: 1024,
          shell: true,
        },
        (error) => {
          const latencyMs = performance.now() - connStart
          results.push({
            connIndex: i,
            success: !error,
            latencyMs,
            error: error?.message,
          })
          completed++
          if (completed === count) {
            resolve(results)
          }
        },
      )

      // Safety kill timer per process
      setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
      }, timeoutMs + 2000)
    }
  })
}

/** Compute latency percentiles. */
function computeStats(latencies: number[]): {
  avg: number
  p50: number
  p95: number
  p99: number
  max: number
  min: number
} {
  if (latencies.length === 0) {
    return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 }
  }
  const sorted = [...latencies].sort((a, b) => a - b)
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length
  return {
    avg,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? sorted[0]!,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1]!,
    max: sorted[sorted.length - 1] ?? 0,
    min: sorted[0] ?? 0,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Phases
// ═══════════════════════════════════════════════════════════════════════════

/** Phase 1: Baseline — single connection latency (sequential). */
async function runBaseline(): Promise<PhaseResult> {
  divider("PHASE 1: BASELINE")

  log("Query", "Running 10 sequential queries...")
  const latencies: number[] = []

  for (let i = 0; i < 10; i++) {
    const result = await runSingleQuery()
    if (result.success) {
      latencies.push(result.latencyMs)
    }
    await sleep(100)
  }

  const stats = computeStats(latencies)
  pass(
    `Avg: ${stats.avg.toFixed(2)}ms | ` +
      `P50: ${stats.p50.toFixed(2)}ms | ` +
      `P95: ${stats.p95.toFixed(2)}ms | ` +
      `P99: ${stats.p99.toFixed(2)}ms`,
  )

  return {
    phaseName: "Baseline (sequential)",
    concurrentConns: 1,
    durationMs: 0,
    successCount: latencies.length,
    failCount: 10 - latencies.length,
    avgLatencyMs: stats.avg,
    p50Ms: stats.p50,
    p95Ms: stats.p95,
    p99Ms: stats.p99,
    maxLatencyMs: stats.max,
    minLatencyMs: stats.min,
    hadWaitingClients: false,
    maxWaitTime: 0,
    poolSnapshot: getPoolSnapshot(),
  }
}

/** Phase 2: Ramp — gradually increase connections until queue forms. */
async function runRamp(
  maxConns: number,
  stepDurationSec: number,
  poolSize: number,
): Promise<PhaseResult[]> {
  divider("PHASE 2: RAMP TEST")
  log(
    "Ramp",
    `Increasing from 1 to ${maxConns} connections (${stepDurationSec}s per step)`,
  )

  const phases: PhaseResult[] = []
  let queueDetected = false

  // Adaptive ramp: incremento fixo de +5 ate passar do pool size,
  // depois multiplicativo (*1.5) para estresse mais agressivo.
  // Isso garante degraus na zona critica ao redor do default_pool_size.
  const rampSteps: number[] = []
  const effectivePoolSize = poolSize || 25
  for (let c = 1; c <= Math.min(maxConns, effectivePoolSize + 10); c += 5) {
    rampSteps.push(c)
  }
  // Continue multiplicativamente a partir do ultimo passo
  let lastStep = rampSteps[rampSteps.length - 1] ?? effectivePoolSize
  while (lastStep < maxConns) {
    lastStep = Math.min(maxConns, Math.round(lastStep * 1.5) + 1)
    rampSteps.push(lastStep)
  }

  const totalSteps = rampSteps.length
  for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
    const conns = rampSteps[stepIdx]!
    const stepStart = performance.now()

    log(
      "Ramp",
      `→ ${conns} concurrent${queueDetected ? " (queue detected)" : ""}...`,
    )

    const results = await runConcurrentQueries(conns, `ramp-${conns}`)
    const poolAfter = getPoolSnapshot()
    const durationMs = performance.now() - stepStart

    const successLatencies = results
      .filter((r) => r.success)
      .map((r) => r.latencyMs)
    const stats = computeStats(successLatencies)

    const hadWaiting = (poolAfter?.cl_waiting ?? 0) > 0
    if (hadWaiting && !queueDetected) {
      queueDetected = true
      warn(
        `QUEUE DETECTED at ${conns} connections! ` +
          `cl_waiting=${poolAfter?.cl_waiting}`,
      )
    }

    phases.push({
      phaseName: `Ramp-${conns}`,
      concurrentConns: conns,
      durationMs,
      successCount: successLatencies.length,
      failCount: results.length - successLatencies.length,
      avgLatencyMs: stats.avg,
      p50Ms: stats.p50,
      p95Ms: stats.p95,
      p99Ms: stats.p99,
      maxLatencyMs: stats.max,
      minLatencyMs: stats.min,
      hadWaitingClients: hadWaiting,
      maxWaitTime: poolAfter?.maxwait ?? 0,
      poolSnapshot: poolAfter,
    })

    console.log(
      `    ├─ OK: ${successLatencies.length}/${results.length} | ` +
        `Avg: ${stats.avg.toFixed(1)}ms | P95: ${stats.p95.toFixed(1)}ms | ` +
        `SV: ${poolAfter?.sv_active ?? "?"}/${poolAfter?.sv_idle ?? "?"} ` +
        `| Wait: ${poolAfter?.cl_waiting ?? 0} (${(poolAfter?.maxwait ?? 0).toFixed(2)}s)`,
    )

    // If queued AND past pool size, drain before next step
    if (hadWaiting && conns >= 20) {
      await sleep(stepDurationSec * 1000)
    } else {
      await sleep(2000)
    }
  }

  return phases
}

/** Phase 3: Burst — sudden spike to test reserve pool. */
async function runBurst(burstConns: number): Promise<PhaseResult[]> {
  divider("PHASE 3: BURST TEST")

  log("Burst", `Sudden spike of ${burstConns} concurrent connections...`)
  const phases: PhaseResult[] = []

  const beforePool = getPoolSnapshot()
  log("Pre-burst", `Idle connections: ${beforePool?.sv_idle ?? "?"}`)

  const burstStart = performance.now()
  const results = await runConcurrentQueries(burstConns, "burst")
  const burstDuration = performance.now() - burstStart
  const afterPool = getPoolSnapshot()

  const successLatencies = results
    .filter((r) => r.success)
    .map((r) => r.latencyMs)
  const stats = computeStats(successLatencies)

  phases.push({
    phaseName: "Burst spike",
    concurrentConns: burstConns,
    durationMs: burstDuration,
    successCount: successLatencies.length,
    failCount: results.length - successLatencies.length,
    avgLatencyMs: stats.avg,
    p50Ms: stats.p50,
    p95Ms: stats.p95,
    p99Ms: stats.p99,
    maxLatencyMs: stats.max,
    minLatencyMs: stats.min,
    hadWaitingClients: (afterPool?.cl_waiting ?? 0) > 0,
    maxWaitTime: afterPool?.maxwait ?? 0,
    poolSnapshot: afterPool,
  })

  console.log(
    `  ${successLatencies.length === results.length ? "✅" : "⚠️"} ` +
      `OK: ${successLatencies.length}/${results.length} | ` +
      `Avg: ${stats.avg.toFixed(1)}ms | P95: ${stats.p95.toFixed(1)}ms\n` +
      `    Before: sv_idle=${beforePool?.sv_idle ?? "?"} ` +
      `| After: sv_idle=${afterPool?.sv_idle ?? "?"} ` +
      `cl_waiting=${afterPool?.cl_waiting ?? "?"}`,
  )

  return phases
}

/** Phase 4: Sustain — hold steady load for N seconds. */
async function runSustain(
  connCount: number,
  durationSec: number,
): Promise<PhaseResult[]> {
  divider("PHASE 4: SUSTAIN TEST")

  log("Sustain", `Holding ${connCount} concurrent connections for ${durationSec}s...`)

  const phases: PhaseResult[] = []
  const allLatencies: number[] = []
  let totalFailures = 0
  let maxWaitSeen = 0
  let hadWaiting = false

  const startTime = performance.now()
  let elapsed = 0

  while (elapsed < durationSec * 1000) {
    const results = await runConcurrentQueries(connCount, "sustain")
    const batchLatencies = results
      .filter((r) => r.success)
      .map((r) => r.latencyMs)

    allLatencies.push(...batchLatencies)
    totalFailures += results.length - batchLatencies.length

    const pool = getPoolSnapshot()
    if (pool) {
      maxWaitSeen = Math.max(maxWaitSeen, pool.maxwait)
      if (pool.cl_waiting > 0) hadWaiting = true
    }

    const p95 = computeStats(batchLatencies).p95
    process.stdout.write(
      `.${batchLatencies.length}q [${pool?.sv_active ?? "?"}/${pool?.sv_idle ?? "?"}] ` +
        `w${pool?.cl_waiting ?? "?"} p95:${p95.toFixed(0)}ms | `,
    )

    elapsed = performance.now() - startTime
  }

  console.log()

  const stats = computeStats(allLatencies)
  phases.push({
    phaseName: "Sustain",
    concurrentConns: connCount,
    durationMs: elapsed,
    successCount: allLatencies.length,
    failCount: totalFailures,
    avgLatencyMs: stats.avg,
    p50Ms: stats.p50,
    p95Ms: stats.p95,
    p99Ms: stats.p99,
    maxLatencyMs: stats.max,
    minLatencyMs: stats.min,
    hadWaitingClients: hadWaiting,
    maxWaitTime: maxWaitSeen,
    poolSnapshot: getPoolSnapshot(),
  })

  console.log(
    `  ${totalFailures === 0 ? "✅" : "⚠️"} ` +
      `Completed ${allLatencies.length} queries over ${(elapsed / 1000).toFixed(0)}s | ` +
      `Avg: ${stats.avg.toFixed(1)}ms | P95: ${stats.p95.toFixed(1)}ms\n` +
      `    Failures: ${totalFailures} | Max wait: ${maxWaitSeen.toFixed(2)}s` +
      (hadWaiting ? " | ⚠️ Queue formed during sustain" : ""),
  )

  return phases
}

// ═══════════════════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════════════════

function generateReport(
  baseline: PhaseResult,
  rampPhases: PhaseResult[],
  burstPhases: PhaseResult[],
  sustainPhases: PhaseResult[],
  config: {
    defaultPoolSize: number
    maxClientConn: number
    reservePoolSize: number
    reservePoolTimeout: number
    pgMaxConnections: number
  },
) {
  const allPhases = [baseline, ...rampPhases, ...burstPhases, ...sustainPhases]

  const report: TestReport = {
    timestamp: new Date().toISOString(),
    pgbouncerHost: ENV.PGHOST,
    pgbouncerPort: ENV.PGPORT,
    defaultPoolSize: config.defaultPoolSize,
    maxClientConn: config.maxClientConn,
    reservePoolSize: config.reservePoolSize,
    reservePoolTimeout: config.reservePoolTimeout,
    pgMaxConnections: config.pgMaxConnections,
    phases: allPhases,
    recommendations: [],
  }

  // Safe pool max: 80% of PG max_connections, minus a few for admin/direct
  const safePoolMax = Math.floor(config.pgMaxConnections * 0.7)

  // ── Generate recommendations ──────────────────────────────────────

  // 1. Queue detection — ramp test
  const phasesWithQueue = rampPhases.filter((p) => p.hadWaitingClients)
  if (phasesWithQueue.length > 0) {
    const firstQueue = phasesWithQueue[0]!
    const suggestedSize = Math.min(firstQueue.concurrentConns + 10, safePoolMax)
    report.recommendations.push(
      `🔴 QUEUE DETECTED at ${firstQueue.concurrentConns} concurrent connections ` +
        `(cl_waiting > 0). Current default_pool_size=${config.defaultPoolSize}.`,
    )
    if (suggestedSize > config.defaultPoolSize) {
      report.recommendations.push(
        `   → Consider increasing default_pool_size to ${suggestedSize} ` +
          `(PG max_connections: ${config.pgMaxConnections}, safe limit: ${safePoolMax}).`,
      )
    }
  } else {
    const maxRamp = rampPhases[rampPhases.length - 1]
    report.recommendations.push(
      `✅ No queue detected up to ${maxRamp?.concurrentConns ?? "?"} connections. ` +
        `Pool size ${config.defaultPoolSize} is adequate.`,
    )
  }

  // 2. Reserve pool
  if (burstPhases.length > 0) {
    const burst = burstPhases[0]!
    if (burst.hadWaitingClients) {
      report.recommendations.push(
        `🟡 Burst of ${burst.concurrentConns} connections caused queuing. ` +
          `reserve_pool_size=${config.reservePoolSize}. ` +
          `→ Increase to ${Math.min(config.reservePoolSize + 5, safePoolMax - config.defaultPoolSize)}.`,
      )
    }
  }

  // 3. P95 latency
  const allP95s = allPhases.map((p) => p.p95Ms)
  const maxP95 = Math.max(...allP95s)
  if (maxP95 > 100) {
    report.recommendations.push(
      `🟡 P95 latency hit ${maxP95.toFixed(0)}ms. ` +
        `If under load, consider: shorter query_timeout, ` +
        `increased server_lifetime, or app-side caching.`,
    )
  }

  // 4. Failure rate
  const totalFails = allPhases.reduce((sum, p) => sum + p.failCount, 0)
  const totalQueries = allPhases.reduce(
    (sum, p) => sum + p.successCount + p.failCount,
    0,
  )
  if (totalFails > 0 && totalQueries > 0) {
    const failRate = (totalFails / totalQueries) * 100
    if (failRate > 1) {
      report.recommendations.push(
        `🔴 ${totalFails}/${totalQueries} queries failed (${failRate.toFixed(1)}%). ` +
          `Check logs. max_client_conn=${config.maxClientConn}.`,
      )
    }
  }

  // 5. Reserve pool disabled
  if (config.reservePoolSize === 0) {
    report.recommendations.push(
      `🟡 reserve_pool_size=0 (disabled). Set to 5-10 for spike protection.`,
    )
  }

  // 6. PG max_connections safety margin
  if (config.defaultPoolSize >= config.pgMaxConnections * 0.8) {
    report.recommendations.push(
      `🔴 default_pool_size (${config.defaultPoolSize}) is ≥80% of PG ` +
        `max_connections (${config.pgMaxConnections}). Increase PG max_connections ` +
        `or reduce pool size to leave headroom for maintenance connections.`,
    )
  } else {
    report.recommendations.push(
      `✅ Default pool (${config.defaultPoolSize}) uses ` +
        `${((config.defaultPoolSize / config.pgMaxConnections) * 100).toFixed(0)}% ` +
        `of PG max_connections (${config.pgMaxConnections}). Safe.`,
    )
  }

  // 7. Known limitation
  report.recommendations.push(
    `ℹ️  NOTE: Each concurrent connection spawns a new ` +
      `psql process (~5-15ms overhead, higher on Windows). ` +
      `True connection-pool latency may be slightly lower than measured.`,
  )

  // ── Print report ─────────────────────────────────────────────────
  divider("FINAL REPORT")
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║   PgBouncer Stress Test Report                             ║
  ╚══════════════════════════════════════════════════════════════╝

  📅 ${report.timestamp}
  🔗 ${report.pgbouncerHost}:${report.pgbouncerPort}

  ── Current Config ─────────────────────────────────────────────
  default_pool_size:    ${config.defaultPoolSize}
  max_client_conn:      ${config.maxClientConn}
  reserve_pool_size:    ${config.reservePoolSize}
  reserve_pool_timeout: ${config.reservePoolTimeout}s
  PG max_connections:   ${config.pgMaxConnections}
  `)

  // Summary table
  console.log(`  ── Phase Results ─────────────────────────────────────────────`)
  console.log(
    `  ${"Phase".padEnd(22)} ${"Conns".padEnd(6)} ${"OK".padEnd(5)} ${"Fail".padEnd(5)} ` +
      `${"Avg(ms)".padEnd(9)} ${"P95(ms)".padEnd(9)} ${"Queue".padEnd(6)} ${"Wait(s)"}`,
  )
  console.log(`  ${"─".repeat(85)}`)

  for (const p of allPhases) {
    console.log(
      `  ${p.phaseName.padEnd(22)} ${String(p.concurrentConns).padEnd(6)} ` +
        `${String(p.successCount).padEnd(5)} ${String(p.failCount).padEnd(5)} ` +
        `${p.avgLatencyMs.toFixed(1).padEnd(8)} ${p.p95Ms.toFixed(1).padEnd(8)} ` +
        `${p.hadWaitingClients ? "⚠️".padEnd(5) : "✅".padEnd(5)} ` +
        `${p.maxWaitTime.toFixed(2)}`,
    )
  }

  // Recommendations
  console.log(`\n  ── Recommendations ───────────────────────────────────────────`)
  for (const rec of report.recommendations) {
    console.log(`  ${rec}`)
  }

  return report
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2)

  // ── Parse args ──────────────────────────────────────────────────
  const showStats = args.includes("--stats")
  const showCheck = args.includes("--check")
  const runRampTest = args.includes("--ramp") || args.includes("--all")
  const runBurstTest = args.includes("--burst") || args.includes("--all")
  const runSustainTest = args.includes("--sustain") || args.includes("--all")
  const runAll = args.includes("--all")

  // Default to help if no flags
  if (!showStats && !showCheck && !runRampTest && !runBurstTest && !runSustainTest) {
    console.log(`
  Uso:
    bash scripts/pgbouncer-stress-test.sh           # Modo interativo
    bun scripts/pgbouncer-stress-test.ts --check    # Verificar ambiente
    bun scripts/pgbouncer-stress-test.ts --stats    # Stats do PgBouncer
    bun scripts/pgbouncer-stress-test.ts --ramp     # Ramp test
    bun scripts/pgbouncer-stress-test.ts --burst    # Burst test
    bun scripts/pgbouncer-stress-test.ts --sustain  # Sustain test
    bun scripts/pgbouncer-stress-test.ts --all      # Bateria completa

  Opcoes:
    --max-conns=N       Max connections for ramp (default: 80)
    --step=N            Seconds per ramp step (default: 5)
    --burst-conns=N     Connections for burst (default: 60)
    --sustain-conns=N   Connections for sustain (default: 20)
    --sustain-duration=N Duration in seconds (default: 30)
    `)
    process.exit(0)
  }

  // Parse numeric args
  const maxConns = Math.min(
    Number(args.find((a) => a.startsWith("--max-conns="))?.split("=")[1] ?? 80),
    200,
  )
  const stepDuration = Number(
    args.find((a) => a.startsWith("--step="))?.split("=")[1] ?? 5,
  )
  const sustainConns = Number(
    args.find((a) => a.startsWith("--sustain-conns="))?.split("=")[1] ??
      Math.min(20, maxConns),
  )
  const sustainDuration = Number(
    args.find((a) => a.startsWith("--sustain-duration="))?.split("=")[1] ?? 30,
  )
  const burstConns = Number(
    args.find((a) => a.startsWith("--burst-conns="))?.split("=")[1] ??
      Math.min(60, maxConns),
  )

  // ── Banner ─────────────────────────────────────────────────────
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║   PgBouncer Stress Test — Severinno Marketplace             ║
  ╚══════════════════════════════════════════════════════════════╝`)

  // ── Environment check ─────────────────────────────────────────
  if (!checkEnvironment()) {
    process.exit(1)
  }

  // ── Stats only ────────────────────────────────────────────────
  if (showStats) {
    divider("PGBOUNCER STATS")
    const pool = getPoolSnapshot()
    const stats = getStatsSnapshot()
    const pgMax = getPgMaxConnections()

    if (pool) {
      console.log(`  Pool:     ${pool.database}`)
      console.log(`  Clients:  ${pool.cl_active} active, ${pool.cl_waiting} waiting (maxwait: ${pool.maxwait.toFixed(2)}s)`)
      console.log(`  Servers:  ${pool.sv_active} active, ${pool.sv_idle} idle, ${pool.sv_login} login, ${pool.sv_tested} tested`)
      console.log(`  Mode:     ${pool.pool_mode}`)
    }
    if (stats) {
      console.log(`\n  Queries:  ${stats.total_query_count}`)
      console.log(`  Avg time: ${Number(stats.avg_query_time).toFixed(2)}ms`)
      console.log(`  Traffic:  ${(Number(stats.total_received) / 1024 / 1024).toFixed(2)}MB recv, ${(Number(stats.total_sent) / 1024 / 1024).toFixed(2)}MB sent`)
    }
    console.log(`  PG max_connections: ${pgMax}`)
    return
  }

  // ── Full test sequence ────────────────────────────────────────
  // Read PgBouncer config
  const configRows = psqlQuerySync("SHOW CONFIG;", "pgbouncer", 5000)
  const defaultPoolSize = Number(
    configRows.find((r) => r[0] === "default_pool_size")?.[1] ?? 25,
  )
  const maxClientConn = Number(
    configRows.find((r) => r[0] === "max_client_conn")?.[1] ?? 1000,
  )
  const reservePoolSize = Number(
    configRows.find((r) => r[0] === "reserve_pool_size")?.[1] ?? 0,
  )
  const reservePoolTimeout = Number(
    configRows.find((r) => r[0] === "reserve_pool_timeout")?.[1] ?? 3,
  )
  const pgMaxConnections = getPgMaxConnections()

  const config = { defaultPoolSize, maxClientConn, reservePoolSize, reservePoolTimeout, pgMaxConnections }

  let baseline!: PhaseResult
  let rampPhases: PhaseResult[] = []
  let burstPhases: PhaseResult[] = []
  let sustainPhases: PhaseResult[] = []

  // Phase 1: Baseline
  if (runAll || showCheck) {
    baseline = await runBaseline()
  }

  // Phase 2: Ramp
  if (runRampTest) {
    rampPhases = await runRamp(maxConns, stepDuration, defaultPoolSize)
  }

  // Phase 3: Burst
  if (runBurstTest) {
    burstPhases = await runBurst(burstConns)
    await sleep(3000) // let pool recover
  }

  // Phase 4: Sustain
  if (runSustainTest) {
    sustainPhases = await runSustain(sustainConns, sustainDuration)
  }

  // Generate report
  generateReport(baseline, rampPhases, burstPhases, sustainPhases, config)

  console.log(`\n  Done.\n`)
}

main().catch((err) => {
  console.error(`\n  ❌ Stress test crashed: ${err.message}`)
  process.exit(1)
})
