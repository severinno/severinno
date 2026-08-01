"use client"

/**
 * AdminPerformanceDashboard — Performance Monitoring
 *
 * Exibe métricas de performance do sistema:
 *   - Endpoints: P50/P95/P99 por endpoint, taxa de erro
 *   - Banco de dados: queries lentas, chamadas, avg
 *   - Chamadas externas: serviços (Evolution, SMTP, etc.)
 *   - Cache: hit rate, operações
 *   - Erros: 5xx, 4xx, unhandled rejections
 *   - System health: memória, uptime, conexões
 *
 * Data source: GET /api/admin/performance
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  ExternalLink,
  Server,
  Timer,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ErrorState, MetricCard } from "./_shared"
import { TOOLTIP_STYLE } from "./admin-chart-theme"

import type { PerformanceMetrics } from "@/app/api/admin/performance/route"

// ── Chart tooltip style ──────────────────────────────────────────────────

// ── Color palette ────────────────────────────────────────────────────────

const CHART_COLORS = {
  p50: "hsl(160, 84%, 39%)",
  p95: "hsl(38, 92%, 50%)",
  p99: "hsl(0, 72%, 51%)",
  error: "hsl(0, 72%, 51%)",
  slow: "hsl(38, 92%, 50%)",
  healthy: "hsl(160, 84%, 39%)",
}

function barColor(value: number, threshold: number): string {
  return value > threshold
    ? CHART_COLORS.error
    : value > threshold * 0.5
      ? CHART_COLORS.slow
      : CHART_COLORS.healthy
}

// ── Period options ───────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
]

// ── Main component ───────────────────────────────────────────────────────

export function AdminPerformanceDashboard() {
  const [period, setPeriod] = React.useState("1h")

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "performance", period],
    queryFn: () => apiGet<PerformanceMetrics>("/api/admin/performance", { period }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar métricas de performance"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <PerformanceSkeleton />
  }

  // Top endpoints by P95 (sorted desc)
  const slowestEndpoints = [...data.endpoints].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 8)

  // Endpoints with highest error rate
  const errorProneEndpoints = [...data.endpoints]
    .sort((a, b) => b.errorRate - a.errorRate)
    .filter((e) => e.errorRate > 0)
    .slice(0, 6)

  // Slowest DB queries
  const slowestQueries = [...data.dbQueries].sort((a, b) => b.avgMs - a.avgMs).slice(0, 6)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">
            Performance Monitoring
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Métricas de tempo de resposta, banco de dados e serviços externos
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dataUpdatedAt ? (
            <span className="text-muted-foreground text-xs">
              Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
            </span>
          ) : null}

          <div className="bg-muted/50 inline-flex h-8 items-center rounded-lg border p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod(opt.value)}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                  period === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section aria-label="KPIs de performance" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Timer}
          label="P95 Geral"
          value={`${Math.round(data.endpoints.reduce((a, e) => Math.max(a, e.p95Ms), 0))}ms`}
          trend={data.endpoints.some((e) => e.p95Ms > 500) ? "down" : "up"}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Taxa de Erro"
          value={`${data.errorSummary.total5xx + data.errorSummary.total4xx}`}
          subtitle={`${data.errorSummary.total5xx} 5xx · ${data.errorSummary.total4xx} 4xx`}
          trend={data.errorSummary.total5xx > 10 ? "down" : "up"}
        />
        <KpiCard
          icon={Database}
          label="DB Slow Queries"
          value={`${data.dbQueries.reduce((a, q) => a + q.slowCount, 0)}`}
          subtitle={`${data.dbQueries.reduce((a, q) => a + q.calls, 0).toLocaleString()} chamadas`}
          trend={data.dbQueries.some((q) => q.slowCount > 5) ? "down" : "up"}
        />
        <KpiCard
          icon={Server}
          label="Memória"
          value={`${data.systemHealth.memoryUsageMb}MB`}
          subtitle={`Uptime: ${Math.round(data.systemHealth.uptime / 60)}min`}
          trend={data.systemHealth.memoryUsageMb > 300 ? "down" : "up"}
        />
      </section>

      {/* ── Charts row ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Bar: P50 / P95 / P99 por endpoint */}
        <MetricCard icon={BarChart3} title="Tempos de Resposta por Endpoint (ms)">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={slowestEndpoints}
                layout="vertical"
                margin={{ left: 100, right: 16, top: 8, bottom: 8 }}
              >
                <CartesianGrid
                  horizontal={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border) / 0.5)"
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  type="category"
                  dataKey="path"
                  tickLine={false}
                  axisLine={false}
                  width={90}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="p95Ms" name="P95" radius={[0, 3, 3, 0]} barSize={12}>
                  {slowestEndpoints.map((e) => (
                    <Cell key={e.path} fill={barColor(e.p95Ms, 500)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* Bar: Top endpoints com erro */}
        <MetricCard icon={AlertTriangle} title="Taxa de Erro por Endpoint (%)">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={errorProneEndpoints}
                layout="vertical"
                margin={{ left: 100, right: 16, top: 8, bottom: 8 }}
              >
                <CartesianGrid
                  horizontal={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border) / 0.5)"
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  type="category"
                  dataKey="path"
                  tickLine={false}
                  axisLine={false}
                  width={90}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`${v.toFixed(2)}%`, "Erro"]}
                />
                <Bar dataKey="errorRate" name="Erro" radius={[0, 3, 3, 0]} barSize={12}>
                  {errorProneEndpoints.map((e) => (
                    <Cell key={e.path} fill={barColor(e.errorRate, 1)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>
      </section>

      {/* ── Second row: DB + External + Cache ────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* DB Queries */}
        <MetricCard icon={Database} title="Queries Lentas (avg ms)">
          <div className="space-y-2">
            {slowestQueries.map((q) => (
              <div key={q.query} className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-xs font-medium">{q.query}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {q.calls.toLocaleString()} chamadas · {q.slowCount} lentas
                  </p>
                </div>
                <div className="ml-3 flex items-center gap-2">
                  <div
                    className="bg-muted h-2 w-16 rounded-full"
                    title={`avg: ${q.avgMs}ms, max: ${q.maxMs}ms`}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((q.avgMs / 200) * 100, 100)}%`,
                        backgroundColor: barColor(q.avgMs, 50),
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      "w-12 text-right text-xs font-medium tabular-nums",
                      q.avgMs > 50
                        ? "text-red-500"
                        : q.avgMs > 20
                          ? "text-amber-500"
                          : "text-emerald-500",
                    )}
                  >
                    {q.avgMs}ms
                  </span>
                </div>
              </div>
            ))}
          </div>
        </MetricCard>

        {/* External Services */}
        <MetricCard icon={ExternalLink} title="Serviços Externos">
          <div className="space-y-2">
            {data.externalCalls.map((s) => (
              <div key={s.service} className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-xs font-medium">{s.service}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {s.calls.toLocaleString()} chamadas
                  </p>
                </div>
                <div className="ml-3 flex items-center gap-2">
                  <span
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      s.avgMs > 500
                        ? "text-red-500"
                        : s.avgMs > 200
                          ? "text-amber-500"
                          : "text-emerald-500",
                    )}
                  >
                    {s.avgMs}ms
                  </span>
                  {s.errorRate > 1 ? <AlertTriangle className="size-3 text-red-500" /> : null}
                </div>
              </div>
            ))}
          </div>
        </MetricCard>

        {/* System Health + Sentry Status */}
        <MetricCard icon={Activity} title="Saúde do Sistema">
          <div className="space-y-4">
            {/* Sentry */}
            <div>
              <p className="text-foreground mb-2 text-xs font-semibold">Sentry / GlitchTip</p>
              <div className="space-y-1.5">
                <StatusRow
                  label="DSN"
                  value={data.sentryStatus.configured ? "✅ Configurado" : "❌ Não configurado"}
                />
                <StatusRow
                  label="Traces"
                  value={`${(data.sentryStatus.tracesSampleRate * 100).toFixed(0)}% amostragem`}
                />
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-foreground mb-2 text-xs font-semibold">Conexões</p>
              <div className="space-y-1.5">
                <StatusRow
                  label="PostgreSQL"
                  value={`${data.systemHealth.dbConnectionsActive} ativas`}
                  status={data.systemHealth.dbConnectionsActive > 0 ? "ok" : "warn"}
                />
                <StatusRow
                  label="Redis"
                  value={data.systemHealth.redisConnected ? "✅ Conectado" : "❌ Desconectado"}
                />
                <StatusRow
                  label="RabbitMQ"
                  value={data.systemHealth.rabbitmqConnected ? "✅ Conectado" : "⛔ Offline (dev)"}
                />
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-foreground mb-2 text-xs font-semibold">Recursos</p>
              <div className="space-y-1.5">
                <StatusRow
                  label="Memória"
                  value={`${data.systemHealth.memoryUsageMb} MB`}
                  status={data.systemHealth.memoryUsageMb > 300 ? "warn" : "ok"}
                />
                <StatusRow
                  label="Uptime"
                  value={`${Math.round(data.systemHealth.uptime / 60)} min`}
                />
              </div>
            </div>
          </div>
        </MetricCard>
      </section>

      {/* ── Top Errors Table ─────────────────────────────────────────── */}
      <section>
        <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <h2 className="text-foreground text-sm font-semibold">Top Erros</h2>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                {data.errorSummary.total5xx + data.errorSummary.total4xx} total
              </span>
            </div>
          </div>
          <div className="p-4">
            {data.errorSummary.topErrors.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center text-sm">
                Nenhum erro crítico no período. 🎉
              </div>
            ) : (
              <div className="space-y-3">
                {data.errorSummary.topErrors.map((err) => (
                  <div
                    key={err.message}
                    className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2"
                  >
                    <p className="text-foreground flex-1 truncate text-xs font-medium">
                      {err.message}
                    </p>
                    <span className="ml-3 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                      {err.count}x
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Nota ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300">
        <p className="font-medium">📊 Nota sobre os dados</p>
        <p className="mt-1">
          Os dados de performance são coletados localmente via logger e métricas do processo. Com o
          Sentry/GlitchTip configurado e o profiling ativo, este dashboard mostrará dados reais de
          transações e spans.
          {data.sentryStatus.configured
            ? " O DSN está configurado — as transações estão sendo enviadas para o GlitchTip."
            : " Configure SENTRY_DSN no .env para habilitar tracing real."}
        </p>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
}: {
  icon: React.ElementType
  label: string
  value: string
  subtitle?: string
  trend?: "up" | "down"
}) {
  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <div className="flex items-start justify-between">
        <span className="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </span>
        {trend ? (
          trend === "up" ? (
            <TrendingUp className="size-4 text-red-500" />
          ) : (
            <TrendingDown className="size-4 text-emerald-500" />
          )
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      {subtitle ? <p className="text-muted-foreground mt-0.5 text-[10px]">{subtitle}</p> : null}
    </div>
  )
}

function StatusRow({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status?: "ok" | "warn" | "error"
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn(
          "text-xs font-medium tabular-nums",
          status === "warn" && "text-amber-500",
          status === "error" && "text-red-500",
          !status && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function PerformanceSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="p-4">
              <Skeleton className="h-[280px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
