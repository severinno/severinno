"use client"

/**
 * AdminPgBouncer — Painel de Monitoramento do PgBouncer
 *
 * Exibe:
 *   - Status geral do pool (saudável, degradado, indisponível)
 *   - Pool state: cl_active, cl_waiting, sv_active, sv_idle, sv_login
 *   - Gráfico de barras da utilização do pool
 *   - Estatísticas: queries totais, avg query time, tráfego
 *   - Config atual: default_pool_size, max_client_conn, reserve_pool, timeouts
 *   - Comparação com max_connections do PostgreSQL
 *   - Auto-refresh a cada 30s
 *
 * Dependência: psql precisa estar instalado no servidor/container.
 * O componente lida graciosamente com psql ausente.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Database,
  Activity,
  AlertTriangle,
  RotateCw,
  CheckCircle2,
  Clock,
  Ban,
  RefreshCw,
  Gauge,
  Users,
  Server,
  BarChart3,
  ArrowUpDown,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ErrorState, FreshnessLabel } from "./_shared"

// ── Types ──────────────────────────────────────────────────────────────────

type PgBouncerPool = {
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

type PgBouncerStat = {
  database: string
  totalQueryCount: number
  totalQueryTime: number
  avgQueryTime: number
  totalReceived: number
  totalSent: number
}

type PgBouncerConfig = {
  key: string
  value: string
  changeable: boolean
}

type PgBouncerResponse = {
  ok: boolean
  pools: PgBouncerPool[]
  stats: PgBouncerStat[]
  config: PgBouncerConfig[]
  pgMaxConnections: number
  available: boolean
  error?: string
  cachedAt: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i] ?? "B"}`
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

// ── Status helpers ─────────────────────────────────────────────────────────

type PoolStatus = "healthy" | "degraded" | "critical" | "unavailable"

function getPoolStatus(pools: PgBouncerPool[], config: PgBouncerConfig[]): PoolStatus {
  if (pools.length === 0) return "unavailable"

  const mainPool = pools[0]
  if (!mainPool) return "unavailable"
  const maxWait = mainPool.maxwait
  const clWaiting = mainPool.clWaiting
  const defaultPoolSize = Number(config.find((c) => c.key === "default_pool_size")?.value ?? 25)
  const utilization = defaultPoolSize > 0 ? (mainPool.svActive / defaultPoolSize) * 100 : 0

  if (clWaiting > 10 || maxWait > 5) return "critical"
  if (clWaiting > 0 || maxWait > 1 || utilization > 90) return "degraded"
  return "healthy"
}

const STATUS_META: Record<
  PoolStatus,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  healthy: {
    label: "Saudável",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    icon: CheckCircle2,
  },
  degraded: {
    label: "Degradado",
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    icon: AlertTriangle,
  },
  critical: {
    label: "Crítico",
    color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-950/30",
    icon: Ban,
  },
  unavailable: {
    label: "Indisponível",
    color: "text-zinc-500",
    bg: "bg-zinc-50 dark:bg-zinc-950/30",
    icon: Ban,
  },
}

// ── Gauge Component ────────────────────────────────────────────────────────

function GaugeMeter({
  value,
  max,
  label,
  color,
}: {
  value: number
  max: number
  label: string
  color?: string
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const hue = pct > 90 ? 0 : pct > 75 ? 38 : 160

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative size-16">
        <svg className="size-16 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke={color ?? `hsl(${hue}, 70%, 45%)`}
            strokeWidth="3"
            strokeDasharray={`${pct * 0.9797} ${(100 - pct) * 0.9797}`}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums">
          {value}
        </span>
      </div>
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
    </div>
  )
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  className,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-border/50 bg-card hover:border-primary/20 rounded-xl border p-4 transition-colors",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span className="bg-primary/8 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4.5" />
        </span>
      </div>
      <p className="text-foreground mt-3 text-xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      {sub && <p className="text-muted-foreground mt-1 text-[10px]">{sub}</p>}
    </div>
  )
}

// ── Config Row ─────────────────────────────────────────────────────────────

function ConfigRow({ key: cfgKey, value, changeable }: PgBouncerConfig) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs">
          {cfgKey}
        </code>
        {changeable && <span className="text-muted-foreground text-[10px] italic">(runtime)</span>}
      </div>
      <span className="text-foreground font-mono text-xs font-medium tabular-nums">{value}</span>
    </div>
  )
}

// ── Loading Skeleton ───────────────────────────────────────────────────────

function PgBouncerSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-44" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4">
            <Skeleton className="size-9 rounded-lg" />
            <Skeleton className="mt-3 h-6 w-20" />
            <Skeleton className="mt-0.5 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="p-5">
              <Skeleton className="h-48 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════

export function AdminPgBouncer() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "pgbouncer"],
    queryFn: () => apiGet<PgBouncerResponse>("/api/admin/pgbouncer"),
    refetchInterval: 30_000, // auto-refresh every 30s
    staleTime: 15_000,
  })

  const freshnessDate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  if (isLoading) return <PgBouncerSkeleton />

  if (!data || !data.available) {
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState
          title="PgBouncer não disponível"
          description={
            data?.error ??
            "O cliente psql não está instalado no servidor. Adicione postgresql-client ao Dockerfile e configure as variáveis PGBOUNCER_HOST/PORT."
          }
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  const mainPool = data.pools[0]
  const mainStat = data.stats[0]
  const status = getPoolStatus(data.pools, data.config)
  const statusMeta = STATUS_META[status]
  const StatusIcon = statusMeta.icon
  const defaultPoolSize = Number(
    data.config.find((c) => c.key === "default_pool_size")?.value ?? 25,
  )
  const poolUtilization =
    defaultPoolSize > 0 ? ((mainPool?.svActive ?? 0) / defaultPoolSize) * 100 : 0
  const pgMaxConn = data.pgMaxConnections ?? 100

  // Group config by category
  const poolConfigKeys = [
    "default_pool_size",
    "max_client_conn",
    "reserve_pool_size",
    "reserve_pool_timeout",
  ]
  const timeoutConfigKeys = [
    "server_idle_timeout",
    "server_lifetime",
    "query_timeout",
    "client_idle_timeout",
  ]
  const otherConfigKeys = ["max_prepared_statements", "pool_mode", "pkt_buf", "max_packet_size"]

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
              statusMeta.bg,
              statusMeta.color,
            )}
          >
            <StatusIcon className="size-3.5" />
            {statusMeta.label}
          </div>
          <div>
            <h1 className="text-foreground text-xl font-bold tracking-tight">
              PgBouncer — Pool de Conexões
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {mainPool?.database ?? "—"} · {mainPool?.poolMode ?? "—"} mode
              {mainPool ? ` · ${mainPool.svActive}/${mainPool.svIdle} servidores` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <FreshnessLabel updatedAt={freshnessDate} />
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50"
            aria-label="Atualizar"
          >
            <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Pool State Cards ────────────────────────────────────── */}
      <section aria-label="Estado do pool" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Clientes ativos"
          value={mainPool?.clActive ?? 0}
          sub={
            mainPool && mainPool.clActive >= defaultPoolSize * 0.8
              ? "⚠️ Próximo do limite"
              : undefined
          }
        />
        <StatCard
          icon={Clock}
          label="Clientes em fila"
          value={mainPool?.clWaiting ?? 0}
          sub={
            mainPool && mainPool.clWaiting > 0
              ? `Máx. espera: ${mainPool.maxwait.toFixed(2)}s`
              : undefined
          }
          className={
            mainPool && mainPool.clWaiting > 0
              ? "border-amber-300 dark:border-amber-800"
              : undefined
          }
        />
        <StatCard
          icon={Server}
          label="Servidores ativos"
          value={`${mainPool?.svActive ?? 0}/${defaultPoolSize}`}
          sub={
            mainPool && poolUtilization > 0 ? `${poolUtilization.toFixed(0)}% do pool` : undefined
          }
        />
        <StatCard
          icon={RefreshCw}
          label="Servidores idle"
          value={mainPool?.svIdle ?? 0}
          sub={mainPool && mainPool.svLogin > 0 ? `${mainPool.svLogin} em login` : undefined}
        />
      </section>

      {/* ── Pool Utilization Gauges + PG Context ────────────────── */}
      <section aria-label="Utilização do pool" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gauges */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
              <Gauge className="text-muted-foreground size-4" />
              Utilização do Pool
            </h2>
          </div>
          <div className="flex items-center justify-around p-6">
            {mainPool && (
              <>
                <div className="flex flex-col items-center gap-3">
                  <GaugeMeter value={mainPool.clActive} max={defaultPoolSize} label="Clientes" />
                  <span className="text-muted-foreground text-[10px]">
                    {mainPool.clActive} / {defaultPoolSize}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <GaugeMeter value={mainPool.svActive} max={defaultPoolSize} label="Servidores" />
                  <span className="text-muted-foreground text-[10px]">
                    {mainPool.svActive} / {defaultPoolSize}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <GaugeMeter
                    value={mainPool.clWaiting}
                    max={10}
                    label="Fila"
                    color="hsl(38, 92%, 50%)"
                  />
                  <span className="text-muted-foreground text-[10px]">
                    {mainPool.clWaiting} cli. esperando
                  </span>
                </div>
              </>
            )}
            {!mainPool && <p className="text-muted-foreground py-8 text-sm">Nenhum pool ativo</p>}
          </div>
        </div>

        {/* PG Context */}
        <div className="border-border/50 bg-card rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="text-muted-foreground size-4" />
              Contexto — PostgreSQL
            </h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">max_connections</span>
              <span className="text-lg font-bold tabular-nums">{pgMaxConn}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Pool size (% de max_conn)</span>
              <span
                className={cn(
                  "text-lg font-bold tabular-nums",
                  defaultPoolSize / pgMaxConn > 0.7 ? "text-amber-600" : "text-emerald-600",
                )}
              >
                {((defaultPoolSize / pgMaxConn) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Slots livres no PG</span>
              <span className="text-lg font-bold tabular-nums">
                {pgMaxConn - (mainPool?.svActive ?? 0)}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <ArrowUpDown className="size-3" />
                Recomendação
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  defaultPoolSize / pgMaxConn > 0.7 ? "text-amber-600" : "text-emerald-600",
                )}
              >
                {defaultPoolSize / pgMaxConn > 0.7
                  ? "Reduza o pool ou aumente max_connections"
                  : "Pool adequado para o limite do PG"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats + Config ──────────────────────────────────────── */}
      {mainStat && (
        <section
          aria-label="Estatísticas de queries"
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
        >
          {/* Stats */}
          <div className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <Activity className="text-muted-foreground size-4" />
                Estatísticas de Queries
              </h2>
            </div>
            <div className="space-y-3 p-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
                    Total de queries
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {mainStat.totalQueryCount.toLocaleString("pt-BR")}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
                    Tempo total
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {formatDuration(mainStat.totalQueryTime)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
                    Tempo médio
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {mainStat.avgQueryTime.toFixed(2)}ms
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[10px] tracking-wider uppercase">Taxa</p>
                  <p className="text-lg font-bold tabular-nums">
                    {mainStat.totalQueryTime > 0
                      ? (mainStat.totalQueryCount / mainStat.totalQueryTime).toFixed(1)
                      : "—"}
                    /s
                  </p>
                </div>
              </div>
              <div className="border-t pt-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
                      Tráfego recebido
                    </p>
                    <p className="text-sm font-medium tabular-nums">
                      {formatBytes(mainStat.totalReceived)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
                      Tráfego enviado
                    </p>
                    <p className="text-sm font-medium tabular-nums">
                      {formatBytes(mainStat.totalSent)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Config */}
          <div className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <Database className="text-muted-foreground size-4" />
                Configuração do Pool
              </h2>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <h3 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
                  Pool
                </h3>
                <div className="divide-y">
                  {data.config
                    .filter((c) => poolConfigKeys.includes(c.key))
                    .map((c) => (
                      <ConfigRow key={c.key} value={c.value} changeable={c.changeable} />
                    ))}
                </div>
              </div>
              <div className="border-t pt-3">
                <h3 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
                  Timeouts
                </h3>
                <div className="divide-y">
                  {data.config
                    .filter((c) => timeoutConfigKeys.includes(c.key))
                    .map((c) => (
                      <ConfigRow key={c.key} value={c.value} changeable={c.changeable} />
                    ))}
                </div>
              </div>
              <div className="border-t pt-3">
                <h3 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
                  Outros
                </h3>
                <div className="divide-y">
                  {data.config
                    .filter((c) => otherConfigKeys.includes(c.key))
                    .map((c) => (
                      <ConfigRow key={c.key} value={c.value} changeable={c.changeable} />
                    ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Unavailable notice at bottom ────────────────────────── */}
      {!data.available && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="font-medium">PgBouncer indisponível</p>
          <p className="mt-1 text-amber-600 dark:text-amber-400">{data.error}</p>
        </div>
      )}
    </div>
  )
}

export default AdminPgBouncer
