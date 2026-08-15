"use client"

/**
 * AdminWebhookAudit — Log de Execuções de Webhooks de Eventos
 *
 * Mostra o histórico de quando cada regra de webhook foi executada,
 * quantos usuários foram notificados e quais erros ocorreram.
 *
 * Data source: GET /api/admin/push/webhooks/audit
 *
 * Status:
 *   success → Todos os pushes foram enviados com sucesso
 *   partial → Alguns falharam, outros não
 *   failed  → Todos falharam
 */

import * as React from "react"
import {
  Webhook,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCw,
  FilterX,
  Clock,
  Users,
  Smartphone,
  type LucideIcon,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ErrorState } from "./_shared"

// ── Types ──────────────────────────────────────────────────────────────────

type ExecutionRecord = {
  id: string
  webhookId: string
  event: string
  title: string
  body: string | null
  pushUrl: string | null
  targetRoles: unknown
  usersFound: number
  usersSent: number
  usersFailed: number
  errorMessage: string | null
  status: string
  context: unknown
  executionMs: number | null
  createdAt: string
}

type AuditResponse = {
  ok: boolean
  items: ExecutionRecord[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  filters: {
    days: number
    event: string
    status: string
    webhookId: string
  }
  availableEvents: Array<{ event: string; count: number }>
  availableStatuses: Array<{ status: string; count: number }>
  webhookRules: Array<{ id: string; title: string; event: string }>
}

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: LucideIcon; label: string; fg: string; bg: string }> = {
  success: {
    icon: CheckCircle2,
    label: "Sucesso",
    fg: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  partial: {
    icon: AlertTriangle,
    label: "Parcial",
    fg: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/30",
  },
  failed: {
    icon: XCircle,
    label: "Falha",
    fg: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30",
  },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status]
  if (!cfg)
    return (
      <Badge variant="outline" className="text-[10px]">
        {status}
      </Badge>
    )
  const Icon = cfg.icon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        cfg.bg,
        cfg.fg,
      )}
    >
      <Icon className="size-2.5" />
      {cfg.label}
    </span>
  )
}

// ── Event label mapping ────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  "booking.created": "Agendamento criado",
  "booking.confirmed": "Agendamento confirmado",
  "booking.cancelled": "Agendamento cancelado",
  "booking.completed": "Agendamento concluído",
  "review.created": "Nova avaliação",
  "quote.received": "Orçamento recebido",
  "quote.responded": "Orçamento respondido",
  "payment.confirmed": "Pagamento confirmado",
  "message.sent": "Nova mensagem",
  "provider.registered": "Prestador cadastrado",
}

// ── Period options ─────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
]

// ── Main Component ─────────────────────────────────────────────────────────

export function AdminWebhookAudit() {
  const [page, setPage] = React.useState(1)
  const [days, setDays] = React.useState("30")
  const [eventFilter, setEventFilter] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("")
  const [webhookIdFilter, setWebhookIdFilter] = React.useState("")

  // Reset page when filters change (adjust state during render)
  const filtersKey = JSON.stringify([days, eventFilter, statusFilter, webhookIdFilter])
  const [prevFiltersKey, setPrevFiltersKey] = React.useState(filtersKey)
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey)
    setPage(1)
  }

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: [
      "admin",
      "push",
      "webhooks",
      "audit",
      page,
      days,
      eventFilter,
      statusFilter,
      webhookIdFilter,
    ],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", "25")
      params.set("days", days)
      if (eventFilter) params.set("event", eventFilter)
      if (statusFilter) params.set("status", statusFilter)
      if (webhookIdFilter) params.set("webhookId", webhookIdFilter)
      return apiGet<AuditResponse>(`/api/admin/push/webhooks/audit?${params.toString()}`)
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o log de execução de webhooks"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <AuditSkeleton />
  }

  const hasActiveFilters = eventFilter || statusFilter || webhookIdFilter
  const eventOptions = data.availableEvents ?? []
  const statusOptions = data.availableStatuses ?? []
  const ruleOptions = data.webhookRules ?? []

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">Log de Webhooks</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {data.pagination.total} execução(ões) de regras de webhook — página{" "}
            {data.pagination.page} de {data.pagination.totalPages}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dataUpdatedAt ? (
            <span className="text-muted-foreground text-xs">
              Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void refetch()}
            disabled={isLoading}
            aria-label="Atualizar"
          >
            <RotateCw className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <section aria-label="Filtros" className="flex flex-wrap items-center gap-3">
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

        {eventOptions.length > 0 && (
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Evento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos os eventos</SelectItem>
              {eventOptions.map((opt) => (
                <SelectItem key={opt.event} value={opt.event}>
                  {EVENT_LABELS[opt.event] ?? opt.event} ({opt.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {statusOptions.length > 0 && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos os status</SelectItem>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.status} value={opt.status}>
                  {STATUS_CONFIG[opt.status]?.label ?? opt.status} ({opt.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {ruleOptions.length > 0 && (
          <Select value={webhookIdFilter} onValueChange={setWebhookIdFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Regra" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas as regras</SelectItem>
              {ruleOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id} className="text-xs">
                  {opt.title.length > 30 ? `${opt.title.slice(0, 30)}…` : opt.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-8 gap-1 text-xs"
            onClick={() => {
              setEventFilter("")
              setStatusFilter("")
              setWebhookIdFilter("")
            }}
          >
            <FilterX className="size-3.5" />
            Limpar
          </Button>
        )}
      </section>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Webhook className="text-muted-foreground/40 size-10" />
              <p className="text-muted-foreground text-sm">
                Nenhuma execução de webhook encontrada no período
              </p>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEventFilter("")
                    setStatusFilter("")
                    setWebhookIdFilter("")
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground h-9 border-b text-[10px] font-medium tracking-wider uppercase">
                    <th className="px-3 font-medium">Status</th>
                    <th className="px-3 font-medium">Evento</th>
                    <th className="px-3 font-medium">Título</th>
                    <th className="px-3 text-right font-medium">Encontrados</th>
                    <th className="px-3 text-right font-medium">Enviados</th>
                    <th className="px-3 text-right font-medium">Falhas</th>
                    <th className="px-3 text-right font-medium">Duração</th>
                    <th className="px-3 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((record) => (
                    <tr key={record.id} className="hover:bg-muted/20 h-11 transition-colors">
                      {/* Status */}
                      <td className="px-3">
                        <StatusBadge status={record.status} />
                      </td>

                      {/* Event */}
                      <td className="px-3">
                        <Badge variant="outline" className="font-mono text-[9px]">
                          {record.event}
                        </Badge>
                      </td>

                      {/* Title + Body */}
                      <td className="max-w-[250px] px-3">
                        <div className="min-w-0">
                          <p
                            className="text-foreground truncate text-xs font-medium"
                            title={record.title}
                          >
                            {record.title}
                          </p>
                          {record.body && (
                            <p
                              className="text-muted-foreground truncate text-[10px]"
                              title={record.body}
                            >
                              {record.body}
                            </p>
                          )}
                        </div>
                        {record.errorMessage && record.status === "failed" && (
                          <p
                            className="truncate text-[10px] text-red-500"
                            title={record.errorMessage}
                          >
                            {record.errorMessage}
                          </p>
                        )}
                      </td>

                      {/* Users found */}
                      <td className="px-3 text-right">
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums">
                          <Users className="size-3" />
                          {record.usersFound}
                        </span>
                      </td>

                      {/* Users sent */}
                      <td className="px-3 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs tabular-nums",
                            record.usersSent > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground/50",
                          )}
                        >
                          <Smartphone className="size-3" />
                          {record.usersSent}
                        </span>
                      </td>

                      {/* Users failed */}
                      <td className="px-3 text-right">
                        {record.usersFailed > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-red-500 tabular-nums">
                            <XCircle className="size-3" />
                            {record.usersFailed}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">0</span>
                        )}
                      </td>

                      {/* Execution time */}
                      <td className="px-3 text-right">
                        {record.executionMs !== null ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs tabular-nums",
                              record.executionMs > 2000
                                ? "text-amber-500"
                                : record.executionMs > 500
                                  ? "text-amber-500"
                                  : "text-muted-foreground",
                            )}
                          >
                            <Clock className="size-3" />
                            {record.executionMs}ms
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Created At */}
                      <td className="px-3">
                        <span className="text-muted-foreground text-[10px] tabular-nums">
                          {new Date(record.createdAt).toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            {data.pagination.total} registro(s) — página {data.pagination.page} de{" "}
            {data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 text-xs"
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 text-xs"
            >
              Próximo
            </Button>
          </div>
        </div>
      )}

      {/* ── Footer note ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">🔔 Sobre este log</p>
        <p className="mt-1">
          Cada linha representa uma execução de uma regra de webhook de eventos. Toda vez que um
          evento do sistema ocorre (agendamento criado, avaliação recebida, etc.), o sistema
          verifica se há regras ativas para aquele evento e dispara notificações push para os
          usuários elegíveis. <strong>Sucesso</strong> = todos os pushes foram enviados ·{" "}
          <strong>Parcial</strong> = alguns falharam · <strong>Falha</strong> = todos falharam.
        </p>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function AuditSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-8 w-[110px] rounded-lg" />
        <Skeleton className="h-8 w-[180px] rounded-lg" />
        <Skeleton className="h-8 w-[130px] rounded-lg" />
      </div>

      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  )
}

export default AdminWebhookAudit
