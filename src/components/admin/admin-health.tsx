"use client"

/**
 * AdminHealthDashboard — System Health Monitoring
 *
 * Exibe status em tempo real do sistema:
 *   - Overall health indicator (green/yellow/red)
 *   - Service-by-service status com latência
 *   - Cache stats (hit ratio, operations)
 *   - Process info (uptime, memory, version)
 *   - RabbitMQ queue depths + Workers status
 *
 * Data source: GET /api/health/detailed
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  MemoryStick,
  Rabbit,
  Server,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { DashboardHeader, ErrorState, MetricCard, TierBanner } from "./_shared"

import type { DetailedHealthResponse } from "@/app/api/health/detailed/route"


// ── Status helpers ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: LucideIcon; label: string; fg: string; bg: string }> = {
  healthy: {
    icon: CheckCircle2,
    label: "Saudável",
    fg: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  degraded: {
    icon: AlertTriangle,
    label: "Degradado",
    fg: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/30",
  },
  unhealthy: {
    icon: XCircle,
    label: "Crítico",
    fg: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30",
  },
  unknown: {
    icon: Activity,
    label: "Desconhecido",
    fg: "text-muted-foreground",
    bg: "bg-muted",
  },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown
}

// ── Main component ────────────────────────────────────────────────────────

export function AdminHealthDashboard() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "health", "detailed"],
    queryFn: () => apiGet<DetailedHealthResponse>("/api/health/detailed"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o health check"
        description="Verifique se o servidor está rodando e você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <HealthSkeleton />
  }

  const statusCfg = getStatusConfig(data.status)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <DashboardHeader
        title="Saúde do Sistema"
        description="Monitoramento em tempo real de todos os serviços"
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        dataUpdatedAt={dataUpdatedAt}
        refreshLabel="Atualizar health check"
        tierBanner={
          data.status !== "healthy"
            ? {
                state: data.status === "degraded" ? "degraded" : "critical",
                title: data.status === "degraded" ? "⚠️ Sistema degradado" : "🔴 Sistema crítico",
                description:
                  data.status === "degraded"
                    ? `${data.summary.degraded} serviço(s) operando com degradação.`
                    : `${data.summary.unhealthy} serviço(s) fora do ar.`,
              }
            : undefined
        }
      />

      {/* ── Overall Status Hero ──────────────────────────────────────── */}
      <section aria-label="Status geral do sistema">
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border p-6 transition-colors",
            data.status === "healthy"
              ? "to-background border-emerald-200 bg-gradient-to-br from-emerald-50/60 dark:border-emerald-900/30 dark:from-emerald-950/10"
              : data.status === "degraded"
                ? "to-background border-amber-200 bg-gradient-to-br from-amber-50/60 dark:border-amber-900/30 dark:from-amber-950/10"
                : "to-background border-red-200 bg-gradient-to-br from-red-50/60 dark:border-red-900/30 dark:from-red-950/10",
          )}
        >
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-2xl",
                statusCfg.bg,
              )}
            >
              <statusCfg.icon className={cn("size-7", statusCfg.fg)} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-foreground text-lg font-bold">{statusCfg.label}</h2>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    statusCfg.bg,
                    statusCfg.fg,
                  )}
                >
                  v{data.version}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {data.summary.healthy}/{data.summary.total} serviços operacionais
                {data.summary.degraded > 0 && ` · ${data.summary.degraded} degradados`}
                {data.summary.unhealthy > 0 && ` · ${data.summary.unhealthy} críticos`}
              </p>
            </div>
          </div>

          {/* Summary bars */}
          <div className="bg-muted mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full">
            <div
              className="bg-emerald-500 transition-all duration-500"
              style={{ width: `${(data.summary.healthy / data.summary.total) * 100}%` }}
            />
            <div
              className="bg-amber-500 transition-all duration-500"
              style={{ width: `${(data.summary.degraded / data.summary.total) * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${(data.summary.unhealthy / data.summary.total) * 100}%` }}
            />
          </div>
        </div>
      </section>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section
        aria-label="Indicadores do sistema"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <KpiCard
          icon={Server}
          label="Versão"
          value={`v${data.version}`}
          subtitle={`Uptime: ${formatUptime(data.uptime)}`}
        />
        <KpiCard
          icon={Activity}
          label="Serviços"
          value={String(data.summary.total)}
          subtitle={`${data.summary.healthy} saudáveis`}
          trend={data.summary.unhealthy > 0 ? "down" : "up"}
        />
        <KpiCard
          icon={Clock}
          label="Latência Média"
          value={calcAvgLatency(data.services)}
          subtitle="Entre todos os serviços"
        />
        <KpiCard
          icon={HardDrive}
          label="Memória RSS"
          value={formatBytes(getMemoryRSS(data))}
          trend={getMemoryRSS(data) > 300 * 1024 * 1024 ? "down" : "up"}
        />
      </section>

      {/* ── Service Cards Grid ───────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Wifi className="text-primary size-4" />
          <h2 className="text-foreground text-sm font-semibold">Serviços</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.services.map((svc) => (
            <ServiceCard key={svc.name} service={svc} />
          ))}
        </div>
      </section>

      {/* ── Cache Stats + Process Info ───────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cache */}
        <MetricCard icon={Database} title="Cache Stats">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Hit Ratio</span>
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  data.cache.total > 0 && data.cache.hits / data.cache.total > 0.8
                    ? "text-emerald-500"
                    : "text-amber-500",
                )}
              >
                {data.cache.total > 0
                  ? `${((data.cache.hits / data.cache.total) * 100).toFixed(1)}%`
                  : "—"}
              </span>
            </div>
            {data.cache.total > 0 && (
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${(data.cache.hits / data.cache.total) * 100}%` }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-lg font-bold text-emerald-500 tabular-nums">
                  {data.cache.hits.toLocaleString()}
                </p>
                <p className="text-muted-foreground text-[10px]">Hits</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-lg font-bold text-amber-500 tabular-nums">
                  {data.cache.misses.toLocaleString()}
                </p>
                <p className="text-muted-foreground text-[10px]">Misses</p>
              </div>
            </div>
          </div>
        </MetricCard>

        {/* Process Information */}
        <MetricCard icon={MemoryStick} title="Informações do Processo">
          <div className="space-y-2.5">
            <StatusRow label="Node.js" value={getNodeVersion(data)} />
            <StatusRow label="Plataforma" value={getPlatform(data)} />
            <StatusRow label="Uptime" value={formatUptime(data.uptime)} />
            <StatusRow
              label="Heap"
              value={getHeapInfo(data)}
              status={getHeapMB(data) > 200 ? "warn" : "ok"}
            />
            <StatusRow
              label="RSS"
              value={getRSSInfo(data)}
              status={getMemoryRSS(data) > 300 * 1024 * 1024 ? "warn" : "ok"}
            />
            <StatusRow label="DB Connection" value={getDbMode(data)} />
          </div>
        </MetricCard>
      </section>

      {/* ── RabbitMQ + Workers ────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* RabbitMQ */}
        <MetricCard icon={Rabbit} title="RabbitMQ — Filas">
          {renderRabbitMQDetails(data)}
        </MetricCard>

        {/* Workers */}
        <MetricCard icon={Activity} title="Workers">
          {renderWorkersDetails(data)}
        </MetricCard>
      </section>

      {/* ── Raw Timestamp ────────────────────────────────────────────── */}
      <div className="border-border/50 bg-muted/30 text-muted-foreground rounded-lg border px-4 py-2 text-[10px]">
        Último check: {new Date(data.timestamp).toLocaleString("pt-BR")} · Cache TTL: 15s · Refetch
        automático: 30s
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
  icon: LucideIcon
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
            <AlertTriangle className="size-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
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

function ServiceCard({ service }: { service: DetailedHealthResponse["services"][number] }) {
  const cfg = getStatusConfig(service.status)

  return (
    <div
      className={cn(
        "bg-card rounded-xl border p-4 transition-all hover:shadow-sm",
        service.status === "unhealthy" && "border-red-200 dark:border-red-900/30",
        service.status === "degraded" && "border-amber-200 dark:border-amber-900/30",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold capitalize">{service.name}</h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium capitalize",
                cfg.bg,
                cfg.fg,
              )}
            >
              <cfg.icon className="size-2.5" />
              {cfg.label}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 truncate text-[11px]">{service.message}</p>
        </div>
        {service.latencyMs !== null ? (
          <span
            className={cn(
              "ml-3 shrink-0 text-xs font-medium tabular-nums",
              service.latencyMs > 500
                ? "text-red-500"
                : service.latencyMs > 100
                  ? "text-amber-500"
                  : "text-emerald-500",
            )}
          >
            {service.latencyMs}ms
          </span>
        ) : null}
      </div>

      {/* Details expandable */}
      {service.details && Object.keys(service.details).length > 0 ? (
        <details className="mt-2">
          <summary className="text-muted-foreground hover:text-foreground cursor-default text-[10px] font-medium">
            Detalhes
          </summary>
          <pre className="bg-muted/50 text-muted-foreground mt-1 overflow-x-auto rounded-md p-2 text-[9px] leading-relaxed">
            {JSON.stringify(service.details, null, 2)}
          </pre>
        </details>
      ) : null}
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
          status === "ok" && "text-emerald-500",
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

// ── Helpers ───────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  return parts.join(" ") || "<1m"
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)}${sizes[i]}`
}

function calcAvgLatency(services: DetailedHealthResponse["services"]): string {
  const withLatency = services.filter((s) => s.latencyMs !== null)
  if (withLatency.length === 0) return "—"
  const avg = withLatency.reduce((a, s) => a + (s.latencyMs ?? 0), 0) / withLatency.length
  return `${Math.round(avg)}ms`
}

function getMemoryRSS(data: DetailedHealthResponse): number {
  const diskSvc = data.services.find((s) => s.name === "disk")
  if (diskSvc?.details?.rss) {
    const match = String(diskSvc.details.rss).match(/^(\d+)MB$/)
    if (match) return parseInt(match[1], 10) * 1024 * 1024
  }
  return 0
}

function getNodeVersion(data: DetailedHealthResponse): string {
  const appSvc = data.services.find((s) => s.name === "app")
  return String(appSvc?.details?.node ?? "—")
}

function getPlatform(data: DetailedHealthResponse): string {
  const appSvc = data.services.find((s) => s.name === "app")
  return String(appSvc?.details?.platform ?? "—")
}

function getHeapMB(data: DetailedHealthResponse): number {
  const diskSvc = data.services.find((s) => s.name === "disk")
  if (diskSvc?.details?.heapUsed) {
    const match = String(diskSvc.details.heapUsed).match(/^(\d+)MB$/)
    if (match) return parseInt(match[1], 10)
  }
  return 0
}

function getHeapInfo(data: DetailedHealthResponse): string {
  const diskSvc = data.services.find((s) => s.name === "disk")
  return String(diskSvc?.details?.heapUsed ?? "—")
}

function getRSSInfo(data: DetailedHealthResponse): string {
  const diskSvc = data.services.find((s) => s.name === "disk")
  return String(diskSvc?.details?.rss ?? "—")
}

function getDbMode(data: DetailedHealthResponse): string {
  const dbSvc = data.services.find((s) => s.name === "database")
  const mode = String(dbSvc?.details?.connectionMode ?? "direct")
  return mode === "pgbouncer" ? "✅ Via PgBouncer" : "🔓 Direto"
}

function renderRabbitMQDetails(data: DetailedHealthResponse): React.ReactNode {
  const rabbitmqSvc = data.services.find((s) => s.name === "rabbitmq")
  if (!rabbitmqSvc) {
    return <p className="text-muted-foreground text-xs">RabbitMQ não verificado</p>
  }

  if (rabbitmqSvc.status === "unhealthy" || rabbitmqSvc.status === "unknown") {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <XCircle className="size-3 text-red-500" />
        {rabbitmqSvc.message}
      </div>
    )
  }

  const queues = rabbitmqSvc.details?.queues as
    Record<string, { messages: number; consumers: number }> | undefined

  if (!queues) {
    return <p className="text-muted-foreground text-xs">{rabbitmqSvc.message}</p>
  }

  return (
    <div className="space-y-2">
      {Object.entries(queues).map(([qName, qData]) => (
        <div
          key={qName}
          className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-xs font-medium">{qName}</p>
            <p className="text-muted-foreground text-[10px]">{qData.consumers} consumers</p>
          </div>
          <span
            className={cn(
              "ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              qData.messages > 0
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
            )}
          >
            {qData.messages} msgs
          </span>
        </div>
      ))}
    </div>
  )
}

function renderWorkersDetails(data: DetailedHealthResponse): React.ReactNode {
  const workersSvc = data.services.find((s) => s.name === "workers")
  if (!workersSvc) {
    return <p className="text-muted-foreground text-xs">Workers não verificados</p>
  }

  const workers = workersSvc.details?.workers as Record<string, string> | undefined
  if (!workers) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <AlertTriangle className="size-3 text-amber-500" />
        {workersSvc.message}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {Object.entries(workers).map(([wName, wStatus]) => (
        <div
          key={wName}
          className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2"
        >
          <span className="text-foreground text-xs font-medium">{wName}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium",
              wStatus === "active"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {wStatus === "active" ? (
              <CheckCircle2 className="size-2.5" />
            ) : (
              <Clock className="size-2.5" />
            )}
            {wStatus}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function HealthSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      <Skeleton className="h-[116px] w-full rounded-2xl" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="mb-2">
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-4 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AdminHealthDashboard
