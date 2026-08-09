"use client"

/**
 * AdminPushHistory — Push Notification History Dashboard
 *
 * Lista todas as notificações push enviadas com:
 *   - Status (enviado, clicado, rejeitado, falha)
 *   - Destinatário (nome, email, role)
 *   - Título e corpo da mensagem
 *   - Tipo e origem (manual, auto, webhook, etc.)
 *   - Dispositivos e latência
 *   - Deep link / URL de destino
 *   - Data de envio e clique
 *
 * Data source: GET /api/admin/push/history
 */

import * as React from "react"
import {
  BellOff,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  Smartphone,
  MousePointerClick,
  FilterX,
  ThumbsUp,
  ThumbsDown,
  Eye,
  type LucideIcon,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { ErrorState } from "@/components/admin/admin-shared"

// ── Types ──────────────────────────────────────────────────────────────────

type HistoryRecord = {
  id: string
  userId: string
  title: string
  body: string | null
  type: string
  source: string
  status: string
  deviceCount: number
  latencyMs: number | null
  errorMessage: string | null
  clickedAt: string | null
  createdAt: string
  user: {
    id: string
    name: string
    email: string
    role: string
    avatarUrl: string | null
  } | null
  action: string | null
  actionResult: string | null
  bookingId: string | null
}

type HistoryResponse = {
  ok: boolean
  items: HistoryRecord[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  filters: {
    days: number
    status: string
    type: string
    source: string
    userId: string
    query: string
  }
  availableTypes: Array<{ type: string; count: number }>
  availableSources: Array<{ source: string; count: number }>
  availableActions: string[]
}

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: LucideIcon; label: string; fg: string; bg: string }> = {
  sent: {
    icon: CheckCircle2,
    label: "Enviado",
    fg: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  clicked: {
    icon: MousePointerClick,
    label: "Clicado",
    fg: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/30",
  },
  bounced: {
    icon: XCircle,
    label: "Rejeitado",
    fg: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/30",
  },
  failed: {
    icon: AlertTriangle,
    label: "Falha",
    fg: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30",
  },
}

// ── Action config ──────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { icon: LucideIcon; label: string; fg: string; bg: string }> = {
  accept: {
    icon: ThumbsUp,
    label: "Aceito",
    fg: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  reject: {
    icon: ThumbsDown,
    label: "Recusado",
    fg: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30",
  },
  view: {
    icon: Eye,
    label: "Visualizado",
    fg: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-100 dark:bg-sky-900/30",
  },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status]
  if (!cfg) return <Badge variant="outline" className="text-[10px]">{status}</Badge>
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

const STATUS_OPTIONS = [
  { value: "all", label: "Todos os status" },
  { value: "sent", label: "Enviados" },
  { value: "clicked", label: "Clicados" },
  { value: "bounced", label: "Rejeitados" },
  { value: "failed", label: "Falhas" },
]

function ActionBadge({ action, actionResult }: { action: string | null; actionResult: string | null }) {
  if (!action) return null
  const cfg = ACTION_CONFIG[action]
  if (!cfg) {
    return <Badge variant="outline" className="text-[9px]">{action}: {actionResult ?? "—"}</Badge>
  }
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", cfg.bg, cfg.fg)} title={actionResult ? `Resultado: ${actionResult}` : undefined}>
      <Icon className="size-2.5" />
      {cfg.label}
      {actionResult && (
        <span className="ml-0.5 opacity-70">· {actionResult}</span>
      )}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function AdminPushHistory() {
  const [page, setPage] = React.useState(1)
  const [days, setDays] = React.useState("30")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [typeFilter, setTypeFilter] = React.useState("")
  const [sourceFilter, setSourceFilter] = React.useState("")
  const [actionFilter, setActionFilter] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  // Debounce search input
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // Reset page when filters change — adjust state during render (no effect:
  // react-hooks/set-state-in-effect gate).
  const filterKey = `${days}|${statusFilter}|${typeFilter}|${sourceFilter}|${actionFilter}`
  const [prevFilterKey, setPrevFilterKey] = React.useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPage(1)
  }

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "push", "history", page, days, statusFilter, typeFilter, sourceFilter, actionFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", "25")
      params.set("days", days)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (typeFilter) params.set("type", typeFilter)
      if (sourceFilter) params.set("source", sourceFilter)
      if (actionFilter) params.set("action", actionFilter)
      if (debouncedSearch) params.set("q", debouncedSearch)
      return apiGet<HistoryResponse>(`/api/admin/push/history?${params.toString()}`)
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o histórico de push"
        description="Verifique se você está autenticado como administrador."
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading || !data) {
    return <HistorySkeleton />
  }

  const hasActiveFilters = statusFilter !== "all" || typeFilter || sourceFilter || actionFilter || debouncedSearch
  const typeOptions = data.availableTypes ?? []
  const sourceOptions = data.availableSources ?? []
  const actionOptions = data.availableActions ?? []

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Histórico de Push
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data.pagination.total} notificação(ns) enviada(s) — página {data.pagination.page} de {data.pagination.totalPages}
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
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título..."
            className="h-8 w-full rounded-lg border bg-muted/50 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:bg-background"
          />
        </div>

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

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
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

        {sourceOptions.length > 0 && (
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas as origens</SelectItem>
              {sourceOptions.map((opt) => (
                <SelectItem key={opt.source} value={opt.source}>
                  {opt.source} ({opt.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {actionOptions.length > 0 && (
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas as ações</SelectItem>
              {actionOptions.map((act) => (
                <SelectItem key={act} value={act}>
                  {ACTION_CONFIG[act]?.label ?? act}
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
            onClick={() => { setStatusFilter("all"); setTypeFilter(""); setSourceFilter(""); setActionFilter(""); setSearch("") }}
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
              <p className="text-sm text-muted-foreground">Nenhuma notificação push encontrada</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={() => { setStatusFilter("all"); setTypeFilter(""); setSourceFilter(""); setSearch("") }}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="h-9 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    <th className="px-3 font-medium">Status</th>
                    <th className="px-3 font-medium">Título</th>
                    <th className="px-3 font-medium">Destinatário</th>
                    <th className="px-3 font-medium">Tipo</th>
                    <th className="px-3 font-medium">Origem</th>
                    <th className="px-3 font-medium">Ação</th>
                    <th className="px-3 text-right font-medium">Disp.</th>
                    <th className="px-3 text-right font-medium">Latência</th>
                    <th className="px-3 font-medium">Enviado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((record) => (
                    <tr
                      key={record.id}
                      className="h-11 transition-colors hover:bg-muted/20"
                    >
                      {/* Status */}
                      <td className="px-3">
                        <StatusBadge status={record.status} />
                      </td>

                      {/* Title + Body */}
                      <td className="max-w-[220px] px-3">
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
                        {record.errorMessage && record.status === "failed" && (
                          <p className="truncate text-[10px] text-red-500" title={record.errorMessage}>
                            {record.errorMessage}
                          </p>
                        )}
                      </td>

                      {/* User */}
                      <td className="px-3">
                        {record.user ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="size-6 shrink-0">
                              {record.user.avatarUrl ? (
                                <AvatarImage src={record.user.avatarUrl} alt={record.user.name} />
                              ) : null}
                              <AvatarFallback className="text-[8px] font-semibold bg-primary/10 text-primary">
                                {record.user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-foreground">
                                {record.user.name}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {record.user.email}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Usuário removido</span>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-3">
                        <Badge variant="outline" className="text-[9px] font-mono">
                          {record.type}
                        </Badge>
                      </td>

                      {/* Source */}
                      <td className="px-3">
                        <span className="text-[10px] capitalize text-muted-foreground">
                          {record.source}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-3">
                        <ActionBadge action={record.action} actionResult={record.actionResult} />
                      </td>

                      {/* Devices */}
                      <td className="px-3 text-right">
                        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                          <Smartphone className="size-3" />
                          {record.deviceCount}
                        </span>
                      </td>

                      {/* Latency */}
                      <td className="px-3 text-right">
                        {record.latencyMs !== null ? (
                          <span className={cn(
                            "text-xs tabular-nums",
                            record.latencyMs > 2000 ? "text-amber-500" : record.latencyMs > 500 ? "text-amber-500" : "text-muted-foreground",
                          )}>
                            {record.latencyMs}ms
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Created At + Clicked */}
                      <td className="px-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {new Date(record.createdAt).toLocaleDateString("pt-BR", {
                              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                          {record.clickedAt && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-500">
                              <MousePointerClick className="size-2.5" />
                              Clique {new Date(record.clickedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
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

      {/* ── Footer note ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300">
        <p className="font-medium">📊 Sobre os dados</p>
        <p className="mt-1">
          Os registros de push são criados automaticamente no banco de dados (PushAnalytics) a cada envio.
          Status &quot;sent&quot; = notificação entregue ao push service · &quot;clicked&quot; = usuário clicou na notificação ·
          &quot;bounced&quot; = subscription expirou (410) · &quot;failed&quot; = erro após {3} tentativas de retry.
          Ações: &quot;Aceito&quot; = provider confirmou agendamento · &quot;Recusado&quot; = provider recusou ·
          &quot;Visualizado&quot; = usuário abriu sem ação.
        </p>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function HistorySkeleton() {
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
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-8 w-[110px] rounded-lg" />
        <Skeleton className="h-8 w-[140px] rounded-lg" />
        <Skeleton className="h-8 w-[150px] rounded-lg" />
      </div>

      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  )
}

export default AdminPushHistory
