"use client"

/**
 * AdminRealtimeTelemetry — fechamento do loop do dashboard: gráfico de emits
 * por evento + o sinal de sockets órfãos do realtime.
 *
 * Data source: GET /api/admin/realtime/telemetry (proxy admin da telemetria
 * persistida pelo mini-service em Redis — janela deslizante por minuto, TTL
 * 24h). Poll a cada 15s (o realtime persiste a cada REALTIME_TELEMETRY_INTERVAL_MS,
 * default 30s — 15s de poll dá leitura quase-em-tempo do flag sem martelar).
 *
 * Renderiza:
 *   - Seletor de janela (30 min / 1 h / 6 h / 24 h → ?minutes da rota)
 *   - Cards de resumo: emits totais na janela, flag de órfãos AGORA (badge de
 *     ALERTA quando ativo), usuários multi-socket (último bucket), máx.
 *     sockets/usuário no período
 *   - Bar chart de emits POR EVENTO (Recharts, barras horizontais — nomes de
 *     evento são longos; top-5 também listado como fallback acessível)
 *   - Area chart do sinal de órfãos ao longo da janela (multi[] →
 *     usersWithMultipleSockets por bucket)
 *   - Banner de alerta âmbar quando flag ativo (o sintoma do socket órfão do
 *     HMR / multi-abas — mesmo contrato do SessionConflictAlert)
 *
 * Degradação graciosa (mesmo contrato das demais views admin): realtime fora
 * do ar / Redis indisponível (ok: false) → EmptyState com aviso, nunca quebra
 * o painel; erro de rede → ErrorState com retry.
 *
 * Nielsen heuristics (design system em admin-shared.tsx):
 *   H1 — FreshnessLabel + poll 15s + refresh manual
 *   H4 — cores consistentes: âmbar = alerta de órfãos, primary = emits
 *   H6 — ícones em todos os cards e badges, tooltip com o detalhe do bucket
 *   H7 — top-5 de eventos como fallback de leitura (além do chart)
 *   H9 — ErrorState com retry + EmptyState de degradação
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  RadioTower,
  RefreshCcw,
  SearchX,
  Users,
  Wifi,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { TOOLTIP_STYLE } from "./admin-chart-theme"
import { EmptyState, ErrorState, FreshnessLabel, PageSectionHeader, TableSkeleton } from "./_shared"

// ---------------------------------------------------------------------------
// Types — espelham a resposta do GET /api/admin/realtime/telemetry (route.ts)
// ---------------------------------------------------------------------------

type MultiBucket = {
  bucket: number
  ts: number
  total: number
  byRole: Record<string, number>
  usersWithMultipleSockets: number
  maxSocketsPerUser: number
}

type TelemetryResponse = {
  ok: boolean
  available: boolean
  minutes: number
  windowStart: number
  windowEnd: number
  /** event → total de emits na janela (agregado por bucket). */
  emits: Record<string, number>
  /** Buckets por minuto (oldest → newest) com o snapshot de sessões. */
  multi: MultiBucket[]
  /** Flag de sockets órfãos AGORA (self-clearing, TTL ≈ 2× persist). */
  flag: boolean
}

const WINDOW_OPTIONS = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 360, label: "6 h" },
  { minutes: 1440, label: "24 h" },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminRealtimeTelemetry() {
  const [minutes, setMinutes] = React.useState(60)

  // Poll 15s (persist do realtime = 30s por default; 15s de leitura mantém o
  // flag e o último bucket frescos sem martelar o proxy admin).
  const { data, isLoading, isError, refetch, isRefetching, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "realtime", "telemetry", minutes],
    queryFn: () => apiGet<TelemetryResponse>(`/api/admin/realtime/telemetry?minutes=${minutes}`),
    refetchInterval: 15_000,
    staleTime: 7_500,
  })

  // Emits por evento, ordenados desc (top no topo do chart + lista top-5).
  const emitsRows = React.useMemo(() => {
    const rows = Object.entries(data?.emits ?? {}).map(([event, count]) => ({ event, count }))
    return rows.sort((a, b) => b.count - a.count)
  }, [data])

  const totalEmits = React.useMemo(
    () => emitsRows.reduce((acc, r) => acc + r.count, 0),
    [emitsRows],
  )

  // Sinal de órfãos ao longo da janela (para o AreaChart) — label por bucket.
  const orphanSeries = React.useMemo(
    () =>
      (data?.multi ?? []).map((b) => ({
        ts: b.ts,
        label: formatRelative(b.ts),
        orphans: b.usersWithMultipleSockets,
        total: b.total,
      })),
    [data],
  )

  // Último bucket + pico de órfãos no período (cards de resumo).
  const lastMulti = data?.multi?.[data.multi.length - 1]
  const peakOrphans = React.useMemo(
    () => Math.max(0, ...(data?.multi ?? []).map((b) => b.usersWithMultipleSockets)),
    [data],
  )
  const peakMaxSockets = React.useMemo(
    () => Math.max(0, ...(data?.multi ?? []).map((b) => b.maxSocketsPerUser)),
    [data],
  )

  const flagActive = data?.flag === true
  const offline = data?.ok === false || data?.available === false

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Telemetria do Realtime"
        description="Emits por evento e o sinal de sockets órfãos (usuários com múltiplos sockets simultâneos — sintoma de HMR/multi-abas). Atualiza automaticamente a cada 15s."
        action={
          <div className="flex items-center gap-3">
            <FreshnessLabel updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isRefetching}
              className="h-8 gap-1.5"
              aria-label="Atualizar telemetria agora"
            >
              <RefreshCcw className={cn("size-3.5", isRefetching && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        }
      />

      {/* Seletor de janela (segmented buttons — mesmo padrão do filtro de role
          do AdminActiveSessions, sem aria-controls órfão) */}
      <div
        role="group"
        aria-label="Janela da telemetria"
        className="bg-card inline-flex h-auto w-fit items-center justify-center gap-1 rounded-lg p-1"
      >
        {WINDOW_OPTIONS.map((w) => {
          const active = minutes === w.minutes
          return (
            <button
              key={w.minutes}
              type="button"
              aria-pressed={active}
              onClick={() => setMinutes(w.minutes)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {w.label}
            </button>
          )
        })}
      </div>

      {/* Banner de alerta — flag de órfãos ATIVO (H4: âmbar = atenção) */}
      {flagActive ? (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-lg border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <span className="font-semibold">Sockets órfãos detectados agora.</span> Há usuários com
            múltiplos sockets simultâneos — verifique a página de Sessões Ativas para identificar
            quem.
          </span>
        </div>
      ) : null}

      {/* Estado: erro / carregando / realtime fora / vazio / conteúdo */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar a telemetria"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : offline ? (
        <EmptyState
          icon={Wifi}
          title="Telemetria indisponível"
          description="O realtime ou o Redis não respondeu. O painel segue funcionando — os gráficos aparecerão quando a telemetria voltar a ser persistida."
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5">
              <RefreshCcw className="size-3.5" />
              Tentar novamente
            </Button>
          }
        />
      ) : emitsRows.length === 0 && orphanSeries.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Sem telemetria na janela"
          description="Nenhum emit ou snapshot de sessão registrado no período. Quando o realtime emitir eventos, os gráficos aparecem aqui."
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5">
              <RefreshCcw className="size-3.5" />
              Atualizar
            </Button>
          }
        />
      ) : (
        <>
          {/* Cards de resumo — H1: visibilidade do estado em tempo real */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={BarChart3}
              label="Emits na janela"
              value={totalEmits}
              valueLabel={`${data?.minutes ?? minutes} min`}
            />
            <SummaryCard
              icon={RadioTower}
              label="Órfãos agora"
              value={flagActive ? "ATIVO" : "OK"}
              highlight={flagActive}
            />
            <SummaryCard
              icon={Users}
              label="Usuários multi-socket"
              value={lastMulti?.usersWithMultipleSockets ?? 0}
              valueLabel={`pico ${peakOrphans} no período`}
            />
            <SummaryCard
              icon={Activity}
              label="Máx. sockets/usuário"
              value={lastMulti?.maxSocketsPerUser ?? 0}
              valueLabel={`pico ${peakMaxSockets} no período`}
            />
          </div>

          {/* Gráficos — emits por evento + sinal de órfãos */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 rounded-xl border">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Emits por evento</h3>
                  <span className="text-muted-foreground text-xs">{emitsRows.length} eventos</span>
                </div>
                {emitsRows.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    Nenhum emit nesta janela.
                  </p>
                ) : (
                  <>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={emitsRows}
                          layout="vertical"
                          margin={{ left: 8, right: 16, top: 8, bottom: 0 }}
                        >
                          <CartesianGrid
                            horizontal={false}
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border) / 0.5)"
                          />
                          <XAxis
                            type="number"
                            allowDecimals={false}
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          />
                          <YAxis
                            type="category"
                            dataKey="event"
                            width={150}
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          />
                          <RTooltip
                            contentStyle={TOOLTIP_STYLE}
                            cursor={{ fill: "hsl(var(--muted) / 0.25)" }}
                          />
                          <Bar
                            dataKey="count"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={22}
                            fill="hsl(var(--primary))"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Top-5 como fallback acessível (H7 — leitura além do chart) */}
                    <ul className="border-border/40 space-y-1 border-t pt-2">
                      {emitsRows.slice(0, 5).map((r) => (
                        <li
                          key={r.event}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground truncate font-mono">
                            {r.event}
                          </span>
                          <span className="text-foreground font-semibold tabular-nums">
                            {r.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 rounded-xl border">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Sinal de sockets órfãos</h3>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                      flagActive
                        ? "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300",
                    )}
                  >
                    <AlertTriangle className="size-3" />
                    {flagActive ? "flag ativo" : "flag ok"}
                  </span>
                </div>
                {orphanSeries.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    Sem snapshots de sessão nesta janela.
                  </p>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={orphanSeries}
                        margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="orphanGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border) / 0.5)"
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          interval="preserveStartEnd"
                          minTickGap={24}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <RTooltip contentStyle={TOOLTIP_STYLE} />
                        <Area
                          type="monotone"
                          dataKey="orphans"
                          name="órfãos"
                          stroke="hsl(38, 92%, 50%)"
                          strokeWidth={2}
                          fill="url(#orphanGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  valueLabel,
  highlight,
}: {
  icon: React.ElementType
  label: string
  value: number | string
  valueLabel?: string
  highlight?: boolean
}) {
  return (
    <Card
      className={cn(
        "border-border/50 rounded-xl border transition-colors",
        highlight &&
          "border-amber-300/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20",
      )}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg",
            highlight && "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs">{label}</p>
          <p className="text-foreground text-xl font-bold tabular-nums">{value}</p>
          {valueLabel ? (
            <p className="text-muted-foreground truncate text-[11px]">{valueLabel}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default AdminRealtimeTelemetry
