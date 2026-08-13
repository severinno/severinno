"use client"

/**
 * AdminPushAudit — Push Notification Audit Log
 *
 * Log completo de auditoria de push notifications: mostra QUEM (admin)
 * enviou/agendou, QUANDO, para QUANTOS, e o RESULTADO completo.
 *
 * Data source: GET /api/admin/push/audit
 *
 * Actions:
 *   manual_send     → Envio manual direto
 *   manual_schedule → Agendamento futuro
 *   scheduled_send  → Disparo via cron (agendado)
 *   recurring_send  → Disparo via cron (recorrente)
 */

import * as React from "react"
import {
  BellOff,
  Send,
  CalendarClock,
  Repeat,
  Timer,
  FilterX,
  RotateCw,
  Users,
  CheckCircle2,
  XCircle,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { ErrorState } from "./_shared"

// ── Types ──────────────────────────────────────────────────────────────────

type AuditRecord = {
  id: string
  adminId: string
  action: string
  title: string
  body: string | null
  pushUrl: string
  notificationType: string
  recipientCount: number
  sentCount: number
  errorCount: number
  directPushCount: number
  metadata: Record<string, unknown> | null
  createdAt: string
  admin: {
    id: string
    name: string
    email: string
    avatarUrl: string | null
  } | null
}

type AuditResponse = {
  ok: boolean
  items: AuditRecord[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  filters: {
    days: number
    action: string
    type: string
    adminId: string
  }
  availableActions: Array<{ action: string; count: number }>
  availableTypes: Array<{ type: string; count: number }>
}

// ── Action config ──────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: LucideIcon; label: string; fg: string; bg: string }> = {
  manual_send: {
    icon: Send,
    label: "Envio direto",
    fg: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/30",
  },
  manual_schedule: {
    icon: CalendarClock,
    label: "Agendamento",
    fg: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-900/30",
  },
  scheduled_send: {
    icon: Timer,
    label: "Disparo agendado",
    fg: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/30",
  },
  recurring_send: {
    icon: Repeat,
    label: "Disparo recorrente",
    fg: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
  },
}

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action]
  if (!cfg) return <Badge variant="outline" className="text-[10px]">{action}</Badge>
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", cfg.bg, cfg.fg)}>
      <Icon className="size-2.5" />
      {cfg.label}
    </span>
  )
}

// ── Period options ─────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
]

const ACTION_OPTIONS = [
  { value: "all", label: "Todas as ações" },
  { value: "manual_send", label: "Envio direto" },
  { value: "manual_schedule", label: "Agendamentos" },
  { value: "scheduled_send", label: "Disparos agendados" },
  { value: "recurring_send", label: "Disparos recorrentes" },
]

// ── Main Component ─────────────────────────────────────────────────────────

export function AdminPushAudit() {
  const [page, setPage] = React.useState(1)
  const [days, setDays] = React.useState("30")
  const [actionFilter, setActionFilter] = React.useState("all")
  const [typeFilter, setTypeFilter] = React.useState("")

  // Reset page when filters change
  React.useEffect(() => { setPage(1) }, [days, actionFilter, typeFilter])

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "push", "audit", page, days, actionFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", "25")
      params.set("days", days)
      if (actionFilter !== "all") params.set("action", actionFilter)
      if (typeFilter) params.set("type", typeFilter)
      return apiGet<AuditResponse>(`/api/admin/push/audit?${params.toString()}`)
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o log de auditoria"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <AuditSkeleton />
  }    const hasActiveFilters = actionFilter !== "all" || typeFilter
    const typeOptions = data.availableTypes ?? []

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Log de Auditoria — Push
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data.pagination.total} operaçōes registradas — página {data.pagination.page} de {data.pagination.totalPages}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dataUpdatedAt ? (
            <span className="text-xs text-muted-foreground">
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
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Ação" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {typeOptions.length > 0 && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos os tipos</SelectItem>
              {typeOptions.map((opt) => (
                <SelectItem key={opt.type} value={opt.type}>
                  {opt.type} ({opt.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => { setActionFilter("all"); setTypeFilter("") }}
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
              <BellOff className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhuma operação de push registrada no período</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={() => { setActionFilter("all"); setTypeFilter("") }}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="h-9 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    <th className="px-3 font-medium">Ação</th>
                    <th className="px-3 font-medium">Admin</th>
                    <th className="px-3 font-medium">Título</th>
                    <th className="px-3 font-medium">Tipo</th>
                    <th className="px-3 text-right font-medium">Dest.</th>
                    <th className="px-3 text-right font-medium">Enviados</th>
                    <th className="px-3 text-right font-medium">Erros</th>
                    <th className="px-3 font-medium">Fallback</th>
                    <th className="px-3 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((record) => (
                    <tr
                      key={record.id}
                      className="h-11 transition-colors hover:bg-muted/20"
                    >
                      {/* Action */}
                      <td className="px-3">
                        <ActionBadge action={record.action} />
                      </td>

                      {/* Admin */}
                      <td className="px-3">
                        {record.admin ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="size-6 shrink-0">
                              {record.admin.avatarUrl ? (
                                <AvatarImage src={record.admin.avatarUrl} alt={record.admin.name} />
                              ) : null}
                              <AvatarFallback className="text-[8px] font-semibold bg-primary/10 text-primary">
                                {record.admin.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-foreground max-w-[140px]">
                                {record.admin.name}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground max-w-[140px]">
                                {record.admin.email}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Admin removido</span>
                        )}
                      </td>

                      {/* Title */}
                      <td className="max-w-[200px] px-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground" title={record.title}>
                            {record.title}
                          </p>
                          {record.body && (
                            <p className="truncate text-[10px] text-muted-foreground" title={record.body}>
                              {record.body}
                            </p>
                          )}
                        </div>
            {(record.metadata && typeof (record.metadata as Record<string, unknown>).scheduleId === 'string') && (
              <p className="text-[9px] text-muted-foreground/60 font-mono truncate" title={String((record.metadata as Record<string, unknown>).scheduleId ?? "")}>
                Agendamento: {String((record.metadata as Record<string, unknown>).scheduleId ?? "").slice(0,12)}…
              </p>
            )}
                      </td>

                      {/* Type */}
                      <td className="px-3">
                        <Badge variant="outline" className="text-[9px] font-mono">
                          {record.notificationType}
                        </Badge>
                      </td>

                      {/* Recipients */}
                      <td className="px-3 text-right">
                        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                          <Users className="size-3" />
                          {record.recipientCount}
                        </span>
                      </td>

                      {/* Sent */}
                      <td className="px-3 text-right">
                        {record.sentCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" />
                            {record.sentCount}
                          </span>
                        ) : record.sentCount === 0 && record.action === "manual_schedule" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground/50">
                            <XCircle className="size-3" />
                            {record.sentCount}
                          </span>
                        )}
                      </td>

                      {/* Errors */}
                      <td className="px-3 text-right">
                        {record.errorCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-red-500">
                            <XCircle className="size-3" />
                            {record.errorCount}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </td>

                      {/* Direct push fallback */}
                      <td className="px-3">
                        {record.directPushCount > 0 ? (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            {record.directPushCount} direto
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Created At */}
                      <td className="px-3">
                        <span className="text-[10px] tabular-nums text-muted-foreground">
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
          <p className="text-xs text-muted-foreground">
            {data.pagination.total} registro(s) — página {data.pagination.page} de {data.pagination.totalPages}
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

      {/* ── Footer stats ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-medium">📋 Log de Auditoria</p>
        <p className="mt-1">
          Este log registra <strong>todas as operações</strong> de push realizadas por administradores:
          envios manuais diretos, agendamentos futuros, disparos via cron job e notificações recorrentes.
          Cada linha mostra <strong>quem</strong> executou a ação, <strong>quando</strong>, para
          <strong> quantos</strong> destinatários, e o <strong>resultado</strong> final da operação.
          Fallback = envio direto sem RabbitMQ (quando a fila estava indisponível).
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
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-8 w-[110px] rounded-lg" />
        <Skeleton className="h-8 w-[160px] rounded-lg" />
        <Skeleton className="h-8 w-[150px] rounded-lg" />
      </div>

      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  )
}

export default AdminPushAudit
