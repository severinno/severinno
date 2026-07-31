"use client"

/**
 * AdminPushMetrics — Push Notification Analytics Dashboard
 *
 * Exibe métricas agregadas de push notifications:
 *   - Overview cards: delivery rate, click rate, bounce rate, failure rate
 *   - Action breakdown (accept/reject/view + resultados)
 *   - Timeline de envios (últimos 30 dias)
 *   - Top tipos / origens
 *   - Usuários alcançados e inscritos
 *
 * Data source: GET /api/admin/push/metrics?days=30
 */

import * as React from "react"
import {
  Bell,
  BellRing,
  MousePointerClick,
  XCircle,
  AlertTriangle,
  RotateCw,
  Users,
  Smartphone,
  Clock,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  ThumbsUp,
  ThumbsDown,
  Eye,
  Activity,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ErrorState } from "./_shared"

// ── Types ──────────────────────────────────────────────────────────────────

type PushMetrics = {
  ok: boolean
  period: { days: number; since: string }
  overview: {
    total: number
    sent: number
    clicked: number
    bounced: number
    failed: number
    deliveryRate: number
    clickRate: number
    bounceRate: number
    failureRate: number
    actionRate: number
  }
  actions: Array<{
    action: string
    actionResult: string | null
    count: number
  }>
  timeline: Array<{
    date: string
    total: number
    clicked: number
    bounced: number
    failed: number
  }>
  topTypes: Array<{ type: string; count: number }>
  topSources: Array<{ source: string; count: number }>
  users: {
    reachable: number
    subscribed: number
  }
  averages: {
    latencyMs: number | null
    deviceCount: number | null
  }
}

// ── Period options ─────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
]

// ── Metric card ────────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  trendLabel,
  color,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  trend?: "up" | "down" | "neutral"
  trendLabel?: string
  color?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
        <Icon className={cn("size-4", color ?? "text-muted-foreground")} />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium",
                trend === "up" && "text-emerald-600",
                trend === "down" && "text-red-600",
                trend === "neutral" && "text-muted-foreground",
              )}
            >
              {trend === "up" && <TrendingUp className="size-3" />}
              {trend === "down" && <TrendingDown className="size-3" />}
              {trend === "neutral" && <Minus className="size-3" />}
              {trendLabel}
            </span>
          )}
        </div>
        {sub && <p className="text-muted-foreground mt-1 text-xs">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────

function ProgressBar({
  value,
  label,
  color = "bg-primary",
  showValue = true,
}: {
  value: number
  label: string
  color?: string
  showValue?: boolean
}) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {showValue && <span className="font-medium tabular-nums">{clamped.toFixed(1)}%</span>}
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

// ── Timeline bar (simplified) ──────────────────────────────────────────────

function TimelineBar({ date, total, max }: { date: string; total: number; max: number }) {
  const pct = max > 0 ? (total / max) * 100 : 0
  const day = new Date(date).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
  })

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-14 shrink-0 text-right tabular-nums">{day}</span>
      <div className="flex-1">
        <div className="bg-muted h-5 w-full overflow-hidden rounded">
          <div
            className="bg-primary/70 h-full rounded transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-muted-foreground w-8 shrink-0 text-right font-medium tabular-nums">
        {total}
      </span>
    </div>
  )
}

// ── Action breakdown badge ─────────────────────────────────────────────────

const ACTION_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  accept: { icon: ThumbsUp, label: "Aceito", color: "text-emerald-600" },
  reject: { icon: ThumbsDown, label: "Recusado", color: "text-red-600" },
  view: { icon: Eye, label: "Visualizado", color: "text-sky-600" },
}

// ── Main component ─────────────────────────────────────────────────────────

export function AdminPushMetrics() {
  const [days, setDays] = React.useState("30")

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "push", "metrics", days],
    queryFn: () => apiGet<PushMetrics>(`/api/admin/push/metrics?days=${days}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as métricas de push"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <MetricsSkeleton />
  }

  const { overview, timeline, topTypes, topSources, actions, users, averages } = data

  const maxTimeline = Math.max(...timeline.map((t) => t.total), 1)

  // Compute click-through funnel
  const sentPct = overview.total > 0 ? 100 : 0
  const clickedPct = overview.total > 0 ? (overview.clicked / overview.total) * 100 : 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">Métricas de Push</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {overview.total} notificação(ns) nos últimos {days} dias
            {dataUpdatedAt && (
              <span className="ml-2 text-xs">
                · Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Atualizar"
          >
            <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* ── Overview cards ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={Bell}
          label="Total enviados"
          value={overview.total}
          sub={`${overview.sent} entregues, ${overview.failed} falhas`}
        />
        <MetricCard
          icon={MousePointerClick}
          label="Taxa de clique"
          value={`${overview.clickRate.toFixed(1)}%`}
          sub={`${overview.clicked} cliques em ${overview.total} envios`}
          trend={overview.clickRate > 5 ? "up" : overview.clickRate > 1 ? "neutral" : "down"}
          trendLabel={`${overview.clicked} cliques`}
          color="text-blue-500"
        />
        <MetricCard
          icon={XCircle}
          label="Taxa de rejeição"
          value={`${overview.bounceRate.toFixed(1)}%`}
          sub={`${overview.bounced} subscriptions expiradas`}
          trend={overview.bounceRate < 5 ? "up" : overview.bounceRate < 15 ? "neutral" : "down"}
          trendLabel={overview.bounceRate < 5 ? "Saudável" : "Alerta"}
          color="text-amber-500"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Taxa de falha"
          value={`${overview.failureRate.toFixed(1)}%`}
          sub={`${overview.failed} falhas após retry`}
          trend={overview.failureRate < 1 ? "up" : overview.failureRate < 5 ? "neutral" : "down"}
          trendLabel={overview.failureRate < 1 ? "Saudável" : "Crítico"}
          color="text-red-500"
        />
      </div>

      {/* ── Delivery quality bar + funnel ────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Delivery quality */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4 text-emerald-500" />
              Qualidade de entrega
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressBar
              value={overview.deliveryRate}
              label="Delivery rate (sent + clicked)"
              color="bg-emerald-500"
            />
            <ProgressBar
              value={overview.clickRate}
              label="Click rate (engajamento)"
              color="bg-blue-500"
            />
            <ProgressBar
              value={overview.bounceRate}
              label="Bounce rate (subscriptions expiradas)"
              color="bg-amber-500"
            />
            <ProgressBar
              value={overview.failureRate}
              label="Failure rate (erros não recuperáveis)"
              color="bg-red-500"
            />
          </CardContent>
        </Card>

        {/* Click funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-blue-500" />
              Funil de clique
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Enviados</span>
                  <span className="font-medium">{overview.total}</span>
                </div>
                <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
                  <div className="bg-primary h-full rounded-full" style={{ width: "100%" }} />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Entregues</span>
                  <span className="font-medium">{overview.sent}</span>
                </div>
                <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${sentPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Clicados</span>
                  <span className="font-medium">{overview.clicked}</span>
                </div>
                <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${clickedPct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-3 text-xs">
              <p className="text-muted-foreground mb-1 font-medium">Taxas de conversão</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-muted-foreground">Delivery rate</p>
                  <p className="text-lg font-bold text-emerald-600">
                    {overview.deliveryRate.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Click rate</p>
                  <p className="text-lg font-bold text-blue-600">
                    {overview.clickRate.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Bounce rate</p>
                  <p className="text-lg font-bold text-amber-600">
                    {overview.bounceRate.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Failure rate</p>
                  <p className="text-lg font-bold text-red-600">
                    {overview.failureRate.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Actions + Users + Averages ───────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Action breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4 text-purple-500" />
              Ações executadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {actions.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Nenhuma ação registrada no período
              </p>
            ) : (
              actions.map((a) => {
                const meta = ACTION_META[a.action]
                const Icon = meta?.icon ?? Activity
                return (
                  <div
                    key={`${a.action}-${a.actionResult}`}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("size-4", meta?.color ?? "text-muted-foreground")} />
                      <div>
                        <p className="font-medium">{meta?.label ?? a.action}</p>
                        {a.actionResult && (
                          <p className="text-muted-foreground">{a.actionResult}</p>
                        )}
                      </div>
                    </div>
                    <span className="font-bold tabular-nums">{a.count}</span>
                  </div>
                )
              })
            )}

            <div className="text-muted-foreground pt-2 text-xs">
              <p>
                Taxa de ação:{" "}
                <span className="text-foreground font-medium">
                  {overview.actionRate.toFixed(1)}%
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Users + Subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-sky-500" />
              Usuários
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Bell className="text-muted-foreground size-4" />
                <span className="font-medium">Alcançados no período</span>
              </div>
              <span className="font-bold tabular-nums">{users.reachable}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Users className="text-muted-foreground size-4" />
                <span className="font-medium">Usuários com push ativo</span>
              </div>
              <span className="font-bold tabular-nums">{users.subscribed}</span>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Smartphone className="text-muted-foreground size-4" />
                <span className="font-medium">Média de dispositivos</span>
              </div>
              <span className="font-bold tabular-nums">
                {averages.deviceCount?.toFixed(1) ?? "—"}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="text-muted-foreground size-4" />
                <span className="font-medium">Latência média</span>
              </div>
              <span className="font-bold tabular-nums">
                {averages.latencyMs != null ? `${averages.latencyMs}ms` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Top types */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4 text-orange-500" />
              Top tipos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topTypes.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Nenhum tipo registrado
              </p>
            ) : (
              topTypes.map((t, i) => {
                const maxCount = topTypes[0]?.count ?? 1
                const pct = (t.count / maxCount) * 100
                return (
                  <div key={t.type} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="max-w-[180px] truncate font-medium">
                        {i + 1}. {t.type}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{t.count}</span>
                    </div>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-orange-400/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}

            {topSources.length > 0 && (
              <>
                <h4 className="text-muted-foreground mt-4 text-xs font-medium">Origens</h4>
                {topSources.map((s) => (
                  <div key={s.source} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{s.source}</span>
                    <span className="font-medium tabular-nums">{s.count}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-violet-500" />
            Timeline de envios
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">
              Nenhum envio no período
            </p>
          ) : (
            <div className="space-y-1">
              {timeline.map((t) => (
                <TimelineBar key={t.date} date={t.date} total={t.total} max={maxTimeline} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Health indicators ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-emerald-500" />
            Indicadores de saúde
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <HealthIndicator
              label="Delivery rate"
              value={`${overview.deliveryRate.toFixed(1)}%`}
              status={
                overview.deliveryRate > 90 ? "good" : overview.deliveryRate > 75 ? "warn" : "bad"
              }
            />
            <HealthIndicator
              label="Click rate"
              value={`${overview.clickRate.toFixed(1)}%`}
              status={overview.clickRate > 5 ? "good" : overview.clickRate > 1 ? "warn" : "bad"}
            />
            <HealthIndicator
              label="Bounce rate"
              value={`${overview.bounceRate.toFixed(1)}%`}
              status={overview.bounceRate < 5 ? "good" : overview.bounceRate < 15 ? "warn" : "bad"}
              invert
            />
            <HealthIndicator
              label="Failure rate"
              value={`${overview.failureRate.toFixed(1)}%`}
              status={overview.failureRate < 1 ? "good" : overview.failureRate < 5 ? "warn" : "bad"}
              invert
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Health indicator sub-component ─────────────────────────────────────────

function HealthIndicator({
  label,
  value,
  status,
  invert = false,
}: {
  label: string
  value: string
  status: "good" | "warn" | "bad"
  invert?: boolean
}) {
  const dotColor = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
  }

  const statusLabel = {
    good: invert ? "Baixo" : "Bom",
    warn: invert ? "Médio" : "Médio",
    bad: invert ? "Crítico" : "Crítico",
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div className={cn("size-2.5 rounded-full", dotColor[status])} />
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold">{value}</p>
      <p
        className={cn(
          "text-[10px] font-medium",
          status === "good" && "text-emerald-600",
          status === "warn" && "text-amber-600",
          status === "bad" && "text-red-600",
        )}
      >
        {statusLabel[status]}
      </p>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function MetricsSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-[300px] w-full rounded-xl" />
      <Skeleton className="h-[200px] w-full rounded-xl" />
    </div>
  )
}

export default AdminPushMetrics
