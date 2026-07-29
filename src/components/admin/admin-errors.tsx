"use client"

/**
 * AdminErrorTrends — Error Monitoring Dashboard
 *
 * Exibe tendências de erro por:
 *   - Endpoint (method, path, status 5xx/4xx, tendência)
 *   - Usuário (count, endpoints, último erro)
 *   - Versão (release, novos/resolvidos, status)
 *   - Timeline (últimas 24h)
 *   - Top erros (mais frequentes)
 *
 * Data source: GET /api/admin/errors
 */

import * as React from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bug,
  Clock,
  Minus,
  Search,
  Server,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/admin/admin-shared"

import type { ErrorTrendsData } from "@/app/api/admin/errors/route"

// ── Tooltip ───────────────────────────────────────────────────────────────

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
  padding: "8px 10px",
}

// ── Colors ────────────────────────────────────────────────────────────────

const TREND_COLORS: Record<string, string> = {
  "5xx": "hsl(0, 72%, 51%)",
  "4xx": "hsl(38, 92%, 50%)",
  error: "hsl(0, 72%, 51%)",
  line: "hsl(160, 84%, 39%)",
}

// ── Period options ───────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "1h",  label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d",  label: "7d" },
  { value: "30d", label: "30d" },
]

// ── Main component ───────────────────────────────────────────────────────

export function AdminErrorTrends() {
  const [period, setPeriod] = React.useState("24h")
  const [endpointFilter, setEndpointFilter] = React.useState("")
  const [searchText, setSearchText] = React.useState("")
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "errors", period, endpointFilter],
    queryFn: () =>
      apiGet<ErrorTrendsData>("/api/admin/errors", {
        period,
        ...(endpointFilter ? { endpoint: endpointFilter } : {}),
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar métricas de erro"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <ErrorsSkeleton />
  }

  // Top endpoints by error count
  const topEndpoints = [...data.byEndpoint].sort((a, b) => b.count - a.count).slice(0, 8)

  // Timeline data
  const timelineData = data.timeline

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Monitoramento de Erros
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Tendências de erro por endpoint, usuário e versão
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Filtro por endpoint */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value)
                if (debounceRef.current) clearTimeout(debounceRef.current)
                debounceRef.current = setTimeout(() => setEndpointFilter(e.target.value), 300)
              }}
              placeholder="Filtrar por endpoint..."
              className="h-8 w-44 rounded-lg border bg-muted/50 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:bg-background"
            />
          </div>

          <div className="inline-flex h-8 items-center rounded-lg border bg-muted/50 p-0.5">
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
      <section aria-label="Resumo de erros" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={AlertTriangle}
          label="Total de Erros"
          value={data.summary.totalErrors.toLocaleString()}
          trend={data.summary.changeFromPrevious < 0 ? "down" : "up"}
          trendLabel={`${data.summary.changeFromPrevious > 0 ? "+" : ""}${data.summary.changeFromPrevious}% vs período anterior`}
        />
        <KpiCard
          icon={BarChart3}
          label="Endpoints Afetados"
          value={String(data.summary.uniqueEndpoints)}
          subtitle={`${data.byEndpoint.filter((e) => e.trend === "up").length} em alta`}
        />
        <KpiCard
          icon={Users}
          label="Usuários Afetados"
          value={String(data.summary.uniqueUsers)}
          subtitle={`Top ${data.byUser.length} usuários`}
        />
        <KpiCard
          icon={Clock}
          label="Média por Hora"
          value={String(Math.round(data.summary.avgErrorsPerHour))}
          subtitle={`Pico às ${data.summary.peakHour}h (${data.summary.peakCount} erros)`}
        />
      </section>

      {/* ── Timeline Chart ──────────────────────────────────────────── */}
      <section>
        <div className="rounded-xl border border-border/50 bg-card">
          <div className="flex items-center gap-2 border-b px-5 py-4">
            <TrendingUp className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Timeline de Erros (24h)
            </h2>
          </div>
          <div className="p-4">
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border) / 0.5)"
                  />
                  <XAxis
                    dataKey="hour"
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <RTooltip contentStyle={TOOLTIP_STYLE} />
                  <Line
                    type="monotone"
                    dataKey="errors"
                    stroke={TREND_COLORS.line}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: TREND_COLORS.line }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ── Charts row ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Bar: Errors by endpoint */}
        <MetricCard icon={BarChart3} title="Erros por Endpoint">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topEndpoints}
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
                <Bar dataKey="count" name="Erros" radius={[0, 3, 3, 0]} barSize={12}>
                  {topEndpoints.map((e) => (
                    <Cell
                      key={e.path}
                      fill={e.trend === "up" ? TREND_COLORS.error : TREND_COLORS["4xx"]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        {/* Table: Top Errors */}
        <MetricCard icon={Bug} title="Top Erros">
          <div className="space-y-2">
            {data.topErrors.slice(0, 6).map((err) => (
              <div
                key={err.message}
                className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground" title={err.message}>
                    {err.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {err.type} · {err.users} usuários · HTTP {err.statusCode}
                  </p>
                </div>
                <span className="ml-3 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  {err.count}x
                </span>
              </div>
            ))}
          </div>
        </MetricCard>
      </section>

      {/* ── Bottom row: Users + Versions ────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Table: Users with most errors */}
        <MetricCard icon={Users} title="Usuários com Mais Erros">
          <div className="divide-y">
            {data.byUser.slice(0, 6).map((u) => (
              <div key={u.userId} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {u.userName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {u.userRole} · {u.uniqueEndpoints} endpoints · {u.lastEndpoint}
                  </p>
                </div>
                <div className="ml-3 flex items-center gap-2">
                  <span className="text-xs font-medium tabular-nums text-red-500">
                    {u.errorCount}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    erros
                  </span>
                </div>
              </div>
            ))}
          </div>
        </MetricCard>

        {/* Table: Errors by version */}
        <MetricCard icon={Server} title="Erros por Versão">
          <div className="divide-y">
            {data.byVersion.map((v) => (
              <div key={v.version} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{v.version}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                        v.status === "stable"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : v.status === "monitoring"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                      )}
                    >
                      {v.status === "stable" ? "✅" : v.status === "monitoring" ? "🔍" : "🔙"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {v.newErrors} novos · {v.resolvedErrors} resolvidos · top: {v.topEndpoint}
                  </p>
                </div>
                <span className="ml-3 text-xs font-medium tabular-nums">
                  {v.count}
                </span>
              </div>
            ))}
          </div>
        </MetricCard>
      </section>

      {/* ── Endpoint detail table ────────────────────────────────────── */}
      <section>
        <MetricCard icon={BarChart3} title="Detalhamento por Endpoint">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="h-8 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  <th className="px-2 font-medium">Endpoint</th>
                  <th className="px-2 font-medium">Method</th>
                  <th className="px-2 text-right font-medium">Erros</th>
                  <th className="px-2 text-right font-medium">5xx</th>
                  <th className="px-2 text-right font-medium">4xx</th>
                  <th className="px-2 text-right font-medium">Usuários</th>
                  <th className="px-2 font-medium">Tendência</th>
                  <th className="px-2 font-medium">Último erro</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {topEndpoints.map((e) => (
                  <tr key={e.path} className="h-9 transition-colors hover:bg-muted/20">
                    <td className="max-w-[160px] truncate px-2 font-medium text-foreground">
                      {e.path}
                    </td>
                    <td className="px-2">
                      <span
                        className={cn(
                          "rounded px-1 py-0.5 font-mono text-[10px] font-medium",
                          e.method === "POST"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                        )}
                      >
                        {e.method}
                      </span>
                    </td>
                    <td className="px-2 text-right font-medium tabular-nums">{e.count}</td>
                    <td className="px-2 text-right tabular-nums text-red-500">{e.status5xx}</td>
                    <td className="px-2 text-right tabular-nums text-amber-500">{e.status4xx}</td>
                    <td className="px-2 text-right tabular-nums">{e.uniqueUsers}</td>
                    <td className="px-2">
                      {e.trend === "up" ? (
                        <span className="inline-flex items-center gap-0.5 text-red-500">
                          <ArrowUp className="size-3" /> {e.pctChange > 0 ? "+" : ""}{e.pctChange}%
                        </span>
                      ) : e.trend === "down" ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-500">
                          <ArrowDown className="size-3" /> {e.pctChange}%
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                          <Minus className="size-3" />
                        </span>
                      )}
                    </td>
                    <td className="max-w-[140px] truncate px-2 text-muted-foreground">
                      {e.lastError}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MetricCard>
      </section>

      {/* ── Sentry config note ──────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300">
        <p className="font-medium">📊 Sobre os dados</p>
        <p className="mt-1">
          Os dados de erro são coletados do logger (pino) e do Sentry/GlitchTip.
          {data.sentryConfig.configured
            ? ` Release: ${data.sentryConfig.release ?? "não definido"} · Ambiente: ${data.sentryConfig.environment}`
            : " Configure SENTRY_DSN no .env para habilitar o monitoramento de erros."}
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
  trend,
  trendLabel,
  subtitle,
}: {
  icon: React.ElementType
  label: string
  value: string
  trend?: "up" | "down"
  trendLabel?: string
  subtitle?: string
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 transition-colors hover:border-primary/20">
      <div className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/8 text-primary">
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
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      {trendLabel && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{trendLabel}</p>
      )}
      {subtitle && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  )
}

function MetricCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Icon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function ErrorsSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="border-b px-5 py-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="p-4">
          <Skeleton className="h-[200px] w-full rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-40" />
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
