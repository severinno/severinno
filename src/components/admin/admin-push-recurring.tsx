"use client"

/**
 * AdminPushRecurring — Dashboard de Notificações Push Recorrentes
 *
 * Gerencia agendamentos recorrentes (diário, semanal, mensal).
 * Exibe lista com status, frequência, horário, última execução.
 * Permite criar, editar, pausar/resumir, arquivar.
 *
 * Data source: GET/POST/PATCH/DELETE /api/admin/push/recurring
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Plus,
  RotateCw,
  Pencil,
  Pause,
  Play,
  Archive,
  Trash2,
  Clock,
  CalendarClock,
  Users,
  Bell,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react"

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/admin/admin-shared"

// ── Types ──────────────────────────────────────────────────────────────────

type RecurringItem = {
  id: string
  frequency: "daily" | "weekly" | "monthly"
  time: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  timezone: string
  title: string
  body: string | null
  pushUrl: string
  type: string
  targetRoles: string[]
  filterCity: string | null
  status: "ACTIVE" | "PAUSED" | "ARCHIVED"
  lastSentAt: string | null
  totalSent: number
  createdAt: string
  updatedAt: string
}

type RecurringResponse = {
  ok: boolean
  items: RecurringItem[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  filters: { status: string }
}

// ── Constants ──────────────────────────────────────────────────────────────

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Diário",
  weekly: "Semanal",
  monthly: "Mensal",
}

const FREQUENCY_ICONS: Record<string, React.ElementType> = {
  daily: Clock,
  weekly: CalendarClock,
  monthly: CalendarClock,
}

const DAY_NAMES = [
  "Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado",
]

const TARGET_ROLE_OPTIONS = [
  { value: "CLIENT", label: "Clientes" },
  { value: "PROVIDER", label: "Prestadores" },
  { value: "ADMIN", label: "Administradores" },
]

type RecurringFormData = {
  frequency: string
  time: string
  dayOfWeek: string
  dayOfMonth: string
  title: string
  body: string
  pushUrl: string
  type: string
  targetRoles: string[]
  filterCity: string
}

const EMPTY_FORM: RecurringFormData = {
  frequency: "daily",
  time: "09:00",
  dayOfWeek: "1",
  dayOfMonth: "1",
  title: "",
  body: "",
  pushUrl: "/",
  type: "RECURRING",
  targetRoles: ["CLIENT", "PROVIDER"],
  filterCity: "",
}

// ── Frequency description ──────────────────────────────────────────────────

function describeSchedule(item: RecurringItem): string {
  switch (item.frequency) {
    case "daily":
      return `Todo dia às ${item.time}`
    case "weekly":
      return `Toda ${DAY_NAMES[item.dayOfWeek ?? 0]} às ${item.time}`
    case "monthly":
      return `Dia ${item.dayOfMonth} de cada mês às ${item.time}`
    default:
      return `${item.frequency} às ${item.time}`
  }
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; fg: string; bg: string }> = {
    ACTIVE: { label: "Ativo", fg: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
    PAUSED: { label: "Pausado", fg: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
    ARCHIVED: { label: "Arquivado", fg: "text-muted-foreground", bg: "bg-muted" },
  }
  const c = cfg[status] ?? { label: status, fg: "text-muted-foreground", bg: "bg-muted" }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", c.bg, c.fg)}>
      {c.label}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function AdminPushRecurring() {
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [statusFilter, setStatusFilter] = React.useState("ACTIVE")
  const [showForm, setShowForm] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<RecurringFormData>(EMPTY_FORM)

  // Confirmation dialogs
  const [confirmActionId, setConfirmActionId] = React.useState<string | null>(null)
  const [confirmActionType, setConfirmActionType] = React.useState<"archive" | "pause" | "activate" | null>(null)
  const [confirmTitle, setConfirmTitle] = React.useState("")

  // ── Query ────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin", "push", "recurring", page, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      params.set("page", String(page))
      params.set("limit", "25")
      return apiGet<RecurringResponse>(`/api/admin/push/recurring?${params.toString()}`)
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...form, body: form.body || null, filterCity: form.filterCity || null }
      if (form.frequency !== "weekly") body.dayOfWeek = null
      if (form.frequency !== "monthly") body.dayOfMonth = null
      if (editId) return apiPatch("/api/admin/push/recurring", { id: editId, ...body })
      return apiPost("/api/admin/push/recurring", body)
    },
    onSuccess: () => {
      toast.success(editId ? "Agendamento atualizado!" : "Agendamento recorrente criado!")
      queryClient.invalidateQueries({ queryKey: ["admin", "push", "recurring"] })
      closeForm()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao salvar."),
  })

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) =>
      apiPatch("/api/admin/push/recurring", { id, status: newStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "push", "recurring"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiDelete("/api/admin/push/recurring", { id }) as any,
    onSuccess: () => {
      toast.success("Agendamento arquivado.")
      queryClient.invalidateQueries({ queryKey: ["admin", "push", "recurring"] })
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao arquivar."),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openNewForm = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEditForm = (item: RecurringItem) => {
    setEditId(item.id)
    setForm({
      frequency: item.frequency,
      time: item.time,
      dayOfWeek: String(item.dayOfWeek ?? "1"),
      dayOfMonth: String(item.dayOfMonth ?? "1"),
      title: item.title,
      body: item.body ?? "",
      pushUrl: item.pushUrl,
      type: item.type,
      targetRoles: item.targetRoles,
      filterCity: item.filterCity ?? "",
    })
    setShowForm(true)
  }

  const openConfirm = (id: string, type: "archive" | "pause" | "activate", title: string) => {
    setConfirmActionId(id)
    setConfirmActionType(type)
    setConfirmTitle(title)
  }

  const executeConfirmedAction = () => {
    if (!confirmActionId || !confirmActionType) return
    const id = confirmActionId
    const type = confirmActionType
    setConfirmActionId(null)
    setConfirmActionType(null)

    if (type === "archive") {
      archiveMutation.mutate(id)
    } else if (type === "pause") {
      toggleStatusMutation.mutate({ id, newStatus: "PAUSED" })
    } else if (type === "activate") {
      toggleStatusMutation.mutate({ id, newStatus: "ACTIVE" })
    }
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setForm(EMPTY_FORM)
  }

  const updateField = <K extends keyof RecurringFormData>(
    key: K,
    value: RecurringFormData[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  const toggleRole = (role: string) => {
    setForm((prev) => ({
      ...prev,
      targetRoles: prev.targetRoles.includes(role)
        ? prev.targetRoles.filter((r) => r !== role)
        : [...prev.targetRoles, role],
    }))
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Notificações Recorrentes
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Agende notificações push que disparam automaticamente todo dia, semana ou mês.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Ativos</SelectItem>
              <SelectItem value="PAUSED">Pausados</SelectItem>
              <SelectItem value="ARCHIVED">Arquivados</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => void refetch()} disabled={isFetching}>
            <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={openNewForm}>
            <Plus className="mr-1.5 size-4" />
            Novo
          </Button>
        </div>
      </div>

      {/* Error */}
      {isError && (
        <ErrorState
          title="Erro ao carregar agendamentos recorrentes"
          onRetry={() => void refetch()}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && data && data.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarClock className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Nenhum agendamento recorrente {statusFilter !== "all" ? statusFilter.toLowerCase() : ""} encontrado.
            </p>
            <Button size="sm" onClick={openNewForm}>
              <Plus className="mr-1.5 size-4" />
              Criar primeiro agendamento
            </Button>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {!isLoading && !isError && data && data.items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => {
            const Icon = FREQUENCY_ICONS[item.frequency] ?? CalendarClock
            return (
              <Card key={item.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <CardTitle className="text-sm truncate">{item.title}</CardTitle>
                        <CardDescription className="text-xs truncate">
                          {describeSchedule(item)}
                        </CardDescription>
                      </div>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {item.body && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.body}</p>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {(item.targetRoles as string[]).map((r) => (
                      <Badge key={r} variant="secondary" className="text-[9px] px-1.5 py-0">
                        {r === "CLIENT" ? "Clientes" : r === "PROVIDER" ? "Prest." : r}
                      </Badge>
                    ))}
                    {item.filterCity && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        {item.filterCity}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t">
                    <span>Total: {item.totalSent} envios</span>
                    {item.lastSentAt && (
                      <span>Último: {new Date(item.lastSentAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 pt-1">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => openEditForm(item)} title="Editar">
                      <Pencil className="size-3.5" />
                    </Button>

                    {item.status === "ACTIVE" ? (
                      <Button variant="ghost" size="icon" className="size-7 text-amber-500 hover:text-amber-600"
                        onClick={() => openConfirm(item.id, "pause", item.title)}
                        disabled={toggleStatusMutation.isPending} title="Pausar">
                        <Pause className="size-3.5" />
                      </Button>
                    ) : item.status === "PAUSED" ? (
                      <Button variant="ghost" size="icon" className="size-7 text-emerald-500 hover:text-emerald-600"
                        onClick={() => openConfirm(item.id, "activate", item.title)}
                        disabled={toggleStatusMutation.isPending} title="Ativar">
                        <Play className="size-3.5" />
                      </Button>
                    ) : null}

                    {item.status !== "ARCHIVED" && (
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => openConfirm(item.id, "archive", item.title)}
                        disabled={archiveMutation.isPending} title="Arquivar">
                        <Archive className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {data.pagination.total} registro(s) · página {data.pagination.page} de {data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Próximo
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/*  Create/Edit Dialog                                             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) closeForm() }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar agendamento" : "Novo agendamento recorrente"}</DialogTitle>
            <DialogDescription>
              {editId ? "Atualize os campos do agendamento." : "Configure uma notificação push automática e recorrente."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Frequency */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Frequência</label>
              <Select value={form.frequency} onValueChange={(v) => updateField("frequency", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Diário — todo dia</SelectItem>
                  <SelectItem value="weekly">Semanal — um dia da semana</SelectItem>
                  <SelectItem value="monthly">Mensal — um dia do mês</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Horário <span className="text-destructive">*</span></label>
              <Input type="time" value={form.time} onChange={(e) => updateField("time", e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Horário local (America/Sao_Paulo)</p>
            </div>

            {/* Day of week (weekly) */}
            {form.frequency === "weekly" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Dia da semana <span className="text-destructive">*</span></label>
                <Select value={form.dayOfWeek} onValueChange={(v) => updateField("dayOfWeek", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((name, idx) => (
                      <SelectItem key={idx} value={String(idx)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Day of month (monthly) */}
            {form.frequency === "monthly" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Dia do mês <span className="text-destructive">*</span></label>
                <Input type="number" min={1} max={31} value={form.dayOfMonth}
                  onChange={(e) => updateField("dayOfMonth", e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Entre 1 e 31. Se o mês tiver menos dias, dispara no último dia.</p>
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Título <span className="text-destructive">*</span></label>
              <Input placeholder="Ex: Bom dia! Confira os prestadores perto de você"
                value={form.title} onChange={(e) => updateField("title", e.target.value.slice(0, 200))} maxLength={200} />
              <p className="text-right text-[10px] text-muted-foreground">{form.title.length}/200</p>
            </div>

            {/* Body */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Corpo da mensagem</label>
              <Textarea placeholder="Ex: Novos prestadores cadastrados na sua região..."
                value={form.body} onChange={(e) => updateField("body", e.target.value.slice(0, 500))} maxLength={500} rows={2} />
              <p className="text-right text-[10px] text-muted-foreground">{form.body.length}/500</p>
            </div>

            {/* Push URL */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">URL de destino</label>
              <Input placeholder="/" value={form.pushUrl} onChange={(e) => updateField("pushUrl", e.target.value)} />
            </div>

            {/* Target roles */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Quem recebe?</label>
              <div className="flex flex-wrap gap-2">
                {TARGET_ROLE_OPTIONS.map((opt) => (
                  <Button key={opt.value} type="button"
                    variant={form.targetRoles.includes(opt.value) ? "default" : "outline"} size="sm"
                    onClick={() => toggleRole(opt.value)}
                    className="h-8 text-xs">
                    {opt.label}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Selecione quais tipos de usuário recebem a notificação. O envio é feito apenas para usuários com push subscription ativa.
              </p>
            </div>

            {/* City filter */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Filtrar por cidade (opcional)</label>
              <Input placeholder="Ex: São Paulo" value={form.filterCity}
                onChange={(e) => updateField("filterCity", e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Deixe vazio para enviar para todos.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.title.trim()}>
              {saveMutation.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editId ? "Salvar alterações" : "Criar agendamento"}
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-[10px] text-muted-foreground">
            <Info className="mr-1 inline size-3 align-text-top" />
            O cron job verifica a cada minuto se há agendamentos para disparar.
            O schedule é processado no fuso horário America/Sao_Paulo.
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/*  Confirmation Dialog                                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <AlertDialog
        open={confirmActionId !== null && confirmActionType !== null}
        onOpenChange={(open) => { if (!open) { setConfirmActionId(null); setConfirmActionType(null) } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirmActionType === "archive" ? (
                <Archive className="size-5 text-muted-foreground" />
              ) : confirmActionType === "pause" ? (
                <Pause className="size-5 text-amber-500" />
              ) : (
                <Play className="size-5 text-emerald-500" />
              )}
              {confirmActionType === "archive"
                ? "Arquivar agendamento?"
                : confirmActionType === "pause"
                  ? "Pausar agendamento?"
                  : "Reativar agendamento?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmActionType === "archive" && (
                <>O agendamento <strong>"{confirmTitle}"</strong> será arquivado e não disparará mais notificações. É possível criar um novo posteriormente.</>
              )}
              {confirmActionType === "pause" && (
                <>O agendamento <strong>"{confirmTitle}"</strong> será pausado. Notificações programadas não serão enviadas até que seja reativado.</>
              )}
              {confirmActionType === "activate" && (
                <>O agendamento <strong>"{confirmTitle}"</strong> será reativado e voltará a disparar notificações conforme a programação.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setConfirmActionId(null); setConfirmActionType(null) }}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={executeConfirmedAction}
              className={cn(
                "gap-2",
                confirmActionType === "archive" && "bg-destructive hover:bg-destructive/90",
              )}
            >
              {confirmActionType === "archive" ? (
                <><Archive className="size-4" /> Arquivar</>
              ) : confirmActionType === "pause" ? (
                <><Pause className="size-4" /> Pausar</>
              ) : (
                <><Play className="size-4" /> Reativar</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default AdminPushRecurring
