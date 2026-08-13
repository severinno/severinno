/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/admin/pgbouncer
 *
 * Retorna métricas em tempo real do PgBouncer via conexão com o banco virtual
 * `pgbouncer`. Os comandos SHOW POOLS, SHOW STATS e SHOW CONFIG expõem o
 * estado interno do pooler de conexões.
 *
 * Requer role ADMIN (protegido pelo middleware).
 *
 * Resposta:
 *   {
 *     ok: true,
 *     pools: PgBouncerPoolRow[],
 *     stats: PgBouncerStatRow[],
 *     config: PgBouncerConfigRow[],
 *     pgMaxConnections: number,
 *     available: true
 *   }
 *
 * Se o `psql` não estiver disponível (ex: container sem postgresql-client),
 * retorna { ok: false, available: false, error: "..." } — sem throw, para
 * que o dashboard mostre um estado "indisponível" elegante em vez de quebrar.
 */

import { NextResponse } from "next/server"
import { execSync } from "child_process"

// ── Types ──────────────────────────────────────────────────────────────────

type PgBouncerPoolRow = {
  database: string
  clActive: number
  clWaiting: number
  clCancelReq: number
  svActive: number
  svIdle: number
  svUsed: number
  svTested: number
  svLogin: number
  maxwait: number
  poolMode: string
}

type PgBouncerStatRow = {
  database: string
  totalQueryCount: number
  totalQueryTime: number
  avgQueryTime: number
  totalReceived: number
  totalSent: number
}

type PgBouncerConfigRow = {
  key: string
  value: string
  changeable: boolean
}

type PgBouncerResponse = {
  ok: boolean
  pools: PgBouncerPoolRow[]
  stats: PgBouncerStatRow[]
  config: PgBouncerConfigRow[]
  pgMaxConnections: number
  available: boolean
  error?: string
  cachedAt: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build env vars for psql subprocess. */
function psqlEnv(): Record<string, string> {
  return {
    PGHOST: process.env.PGBOUNCER_HOST ?? "localhost",
    PGPORT: process.env.PGBOUNCER_PORT ?? "6432",
    PGUSER: process.env.PGBOUNCER_USER ?? process.env.POSTGRES_USER ?? "severinno",
    PGPASSWORD: process.env.PGBOUNCER_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? "",
    PGDATABASE: "pgbouncer",
    PGSSLMODE: "disable",
  }
}

/** Run a psql command and return parsed tab-separated output. */
function psqlQuery(sql: string, timeoutMs = 5000): string[][] {
  const env = psqlEnv()
  const cmd = [
    `psql`,
    `-h "${env.PGHOST}"`,
    `-p "${env.PGPORT}"`,
    `-U "${env.PGUSER}"`,
    `-d "pgbouncer"`,
    `-At`,
    `-F "\\t"`,
    `-c "${sql.replace(/"/g, '\\"')}"`,
  ].join(" ")

  const result = execSync(cmd, {
    env: { ...process.env, ...env },
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    shell: true,
  } as any)

  return result
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
}

/** Get PostgreSQL max_connections (runs through PgBouncer). */
function getPgMaxConnections(): number {
  try {
    const env = psqlEnv()
    env.PGDATABASE = process.env.POSTGRES_DB ?? "severinno"
    const cmd = [
      `psql`,
      `-h "${env.PGHOST}"`,
      `-p "${env.PGPORT}"`,
      `-U "${env.PGUSER}"`,
      `-d "${env.PGDATABASE}"`,
      `-At`,
      `-c "SHOW max_connections;"`,
    ].join(" ")

    const result = execSync(cmd, {
      env: { ...process.env, ...env },
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024,
      shell: true,
    } as any)
    return Number(result.trim().split("\n").filter(Boolean)[0] ?? 100)
  } catch {
    return 100
  }
}

// ── In-memory cache (15s TTL) ─────────────────────────────────────────────

let inMemoryCache: { timestamp: number; result: PgBouncerResponse } | null = null
const CACHE_TTL_MS = 15_000

// ═════════════════════════════════════════════════════════════════════════
// Route Handler
// ═════════════════════════════════════════════════════════════════════════

export async function GET(): Promise<NextResponse<PgBouncerResponse>> {
  // Try cache first
  if (inMemoryCache && Date.now() - inMemoryCache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(inMemoryCache.result)
  }

  // Check if psql is available
  try {
    execSync("psql --version", { encoding: "utf-8", timeout: 3000 })
  } catch {
    const unavailable: PgBouncerResponse = {
      ok: false,
      pools: [],
      stats: [],
      config: [],
      pgMaxConnections: 0,
      available: false,
      error: "psql CLI não disponível. Instale postgresql-client no container.",
      cachedAt: new Date().toISOString(),
    }
    return NextResponse.json(unavailable)
  }

  try {
    // Sequential calls — psqlQuery usa execSync (bloqueante), então
    // Promise.all com wrappers não traria concorrência real.
    const poolRows = psqlQuery("SHOW POOLS;")
    const statRows = psqlQuery("SHOW STATS;")
    const configRows = psqlQuery("SHOW CONFIG;")

    const pools: PgBouncerPoolRow[] = poolRows.map((r) => ({
      database: r[0] ?? "",
      clActive: Number(r[1] ?? 0),
      clWaiting: Number(r[2] ?? 0),
      clCancelReq: Number(r[3] ?? 0),
      svActive: Number(r[4] ?? 0),
      svIdle: Number(r[5] ?? 0),
      svUsed: Number(r[6] ?? 0),
      svTested: Number(r[7] ?? 0),
      svLogin: Number(r[8] ?? 0),
      maxwait: Number(r[9] ?? 0),
      poolMode: r[10] ?? "",
    }))

    const stats: PgBouncerStatRow[] = statRows.map((r) => ({
      database: r[0] ?? "",
      totalQueryCount: Number(r[1] ?? 0),
      totalQueryTime: Number(r[2] ?? 0),
      avgQueryTime: Number(r[11] ?? 0),
      totalReceived: Number(r[13] ?? 0),
      totalSent: Number(r[14] ?? 0),
    }))

    const config: PgBouncerConfigRow[] = configRows.map((r) => ({
      key: r[0] ?? "",
      value: r[1] ?? "",
      changeable: (r[2] ?? "no") === "yes",
    }))

    const pgMaxConnections = getPgMaxConnections()

    const response: PgBouncerResponse = {
      ok: true,
      pools,
      stats,
      config,
      pgMaxConnections,
      available: true,
      cachedAt: new Date().toISOString(),
    }

    // Cache
    inMemoryCache = { timestamp: Date.now(), result: response }

    return NextResponse.json(response)
  } catch (err: any) {
    const errorResponse: PgBouncerResponse = {
      ok: false,
      pools: [],
      stats: [],
      config: [],
      pgMaxConnections: 0,
      available: false,
      error: `Erro ao consultar PgBouncer: ${err?.message ?? String(err)}`,
      cachedAt: new Date().toISOString(),
    }
    return NextResponse.json(errorResponse, { status: 200 }) // 200 even on error (UI handles it)
  }
}
