"use client"

/**
 * AdminPushNotifications — Dashboard para envio manual de push notifications,
 * agendamento futuro, e gestão de webhooks de eventos automáticos.
 *
 * Abas:
 *   "send"      → Envio manual imediato (existente)
 *   "scheduled" → Notificações agendadas para futuro
 *   "webhooks"  → Regras de webhook de eventos automáticos
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Bell,
  BellOff,
  Search,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Users,
  Smartphone,
  CheckSquare,
  Square,
  AlertTriangle,
  RotateCw,
  CalendarClock,
  Clock,
  Trash2,
  CalendarOff,
  Zap,
  Webhook,
  Plus,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Info,
  Variable,
  BarChart3,
  TrendingUp,
  TrendingDown,
  MousePointerClick,
  ArrowUp,
  ArrowDown,
  Sparkles,
} from "lucide-react"

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
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

// ── Types ──────────────────────────────────────────────────────────────────

type PushUser = {
  id: string
  name: string
  email: string
  role: string
  avatarUrl: string | null
  city: string | null
  state: string | null
  subscriptionsCount: number
}

type UsersResponse = {
  items: PushUser[]
  total: number
  page: number
  limit: number
  totalSubscriptions: number
}

type ScheduledItem = {
  id: string
  scheduledAt: string
  status: "PENDING" | "SENT" | "CANCELLED" | "FAILED"
  title: string
  body: string | null
  pushUrl: string
  type: string
  sentCount: number
  errorCount: number
  sentAt: string | null
  createdAt: string
  userIdsCount: number
}

type ScheduleResponse = {
  ok: boolean
  items: ScheduledItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

type EventWebhookItem = {
  id: string
  event: string
  title: string
  body: string | null
  pushUrl: string
  targetRoles: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

type PushAnalyticsResponse = {
  rates?: {
    deliveryRate?: number
    clickRate?: number
    bounceRate?: number
    failureRate?: number
  }
  summary?: {
    totalSent?: number
    delivered?: number
    clicked?: number
    bounced?: number
    failed?: number
  }
  activeSubscriptions?: number
  bySource?: Array<{ source: string; count: number }>
  byType?: Array<{ type: string; count: number }>
  daily?: Array<{
    date: string
    sent: number
    clicked: number
    bounced: number
    failed: number
  }>
  topNotifications?: Array<{ title: string; sent: number; devices: number }>
}

// ── Constants ──────────────────────────────────────────────────────────────

const EVENTS_LIST = [
  {
    value: "booking.created",
    label: "Agendamento criado",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "booking.confirmed",
    label: "Agendamento confirmado",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "booking.cancelled",
    label: "Agendamento cancelado",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "booking.completed",
    label: "Agendamento concluído",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "review.created",
    label: "Nova avaliação",
    vars: "clientName, providerName, serviceName, rating, comment",
  },
  {
    value: "quote.received",
    label: "Orçamento recebido",
    vars: "clientName, providerName, serviceName, itemsCount",
  },
  {
    value: "quote.responded",
    label: "Orçamento respondido",
    vars: "providerName, clientName, serviceName, amount",
  },
  {
    value: "payment.confirmed",
    label: "Pagamento confirmado",
    vars: "clientName, providerName, amount",
  },
  { value: "message.sent", label: "Nova mensagem", vars: "fromName, toName, content" },
  {
    value: "provider.registered",
    label: "Prestador cadastrado",
    vars: "providerName, city, state",
  },
]

const ROLE_OPTIONS = [
  { value: "ALL", label: "Todas as roles" },
  { value: "CLIENT", label: "Clientes" },
  { value: "PROVIDER", label: "Prestadores" },
  { value: "ADMIN", label: "Administradores" },
]

const NOTIFICATION_TYPES = [
  { value: "ADMIN_MANUAL", label: "Mensagem administrativa" },
  { value: "PROMOTION", label: "Promocao" },
  { value: "REMINDER", label: "Lembrete" },
  { value: "UPDATE", label: "Atualizacao" },
]

const TARGET_ROLE_OPTIONS = [
  { value: "CLIENT", label: "Clientes" },
  { value: "PROVIDER", label: "Prestadores" },
  { value: "ADMIN", label: "Administradores" },
]

const EVENT_VARIABLES: Record<string, string[]> = {
  "booking.created": ["clientName", "serviceName", "providerName", "date"],
  "booking.confirmed": ["clientName", "serviceName", "providerName", "date"],
  "booking.cancelled": ["clientName", "serviceName", "providerName", "date"],
  "booking.completed": ["clientName", "serviceName", "providerName", "date"],
  "review.created": ["clientName", "serviceName", "providerName", "rating", "comment"],
  "quote.received": ["clientName", "serviceName", "providerName", "itemsCount"],
  "quote.responded": ["clientName", "serviceName", "providerName", "amount"],
  "payment.confirmed": ["clientName", "serviceName", "providerName", "amount"],
  "message.sent": ["fromName", "toName", "content"],
  "provider.registered": ["providerName", "city", "state"],
}

const WEBHOOK_TEMPLATES: Record<
  string,
  {
    title: string
    body: string
    pushUrl: string
    targetRoles: string[]
  }
> = {
  "booking.created": {
    title: "📅 Novo agendamento: {{serviceName}}",
    body: "{{clientName}} agendou {{serviceName}} com {{providerName}} para {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "booking.confirmed": {
    title: "✅ Agendamento confirmado: {{serviceName}}",
    body: "{{clientName}} confirmou {{serviceName}} com {{providerName}} para {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "booking.cancelled": {
    title: "❌ Agendamento cancelado: {{serviceName}}",
    body: "{{clientName}} cancelou {{serviceName}} com {{providerName}} em {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "booking.completed": {
    title: "🎉 Serviço concluído: {{serviceName}}",
    body: "{{serviceName}} de {{clientName}} com {{providerName}} foi concluído em {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["CLIENT", "PROVIDER"],
  },
  "review.created": {
    title: "⭐ {{rating}} estrelas — Nova avaliação",
    body: '{{clientName}} avaliou {{serviceName}}: "{{comment}}"',
    pushUrl: "/admin/reviews",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "quote.received": {
    title: "📋 Orçamento recebido: {{serviceName}}",
    body: "{{clientName}} solicitou orçamento de {{serviceName}} — {{itemsCount}} itens",
    pushUrl: "/admin/quotes",
    targetRoles: ["PROVIDER"],
  },
  "quote.responded": {
    title: "💰 Orçamento respondido: {{serviceName}}",
    body: "{{providerName}} respondeu ao orçamento de {{serviceName}} — R$ {{amount}}",
    pushUrl: "/admin/quotes",
    targetRoles: ["CLIENT", "ADMIN"],
  },
  "payment.confirmed": {
    title: "💳 Pagamento confirmado — R$ {{amount}}",
    body: "{{clientName}} pagou {{providerName}} — {{serviceName}} — R$ {{amount}}",
    pushUrl: "/admin/finances",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "message.sent": {
    title: "💬 Nova mensagem de {{fromName}}",
    body: '{{fromName}} enviou: "{{content}}"',
    pushUrl: "/messages",
    targetRoles: ["CLIENT", "PROVIDER"],
  },
  "provider.registered": {
    title: "👷 Novo prestador cadastrado",
    body: "{{providerName}} se cadastrou na plataforma — {{city}}/{{state}}",
    pushUrl: "/admin/providers",
    targetRoles: ["ADMIN"],
  },
}

// ── Component ───────────────────────────────────────────────────────────────

export function AdminPushNotifications() {
  const _queryClient = useQueryClient()
  const [activeTab, setActiveTab] = React.useState<"send" | "scheduled" | "webhooks" | "analytics">(
    "send",
  )

  // ── Send tab state ────────────────────────────────────────────
  const [search, setSearch] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState("ALL")
  const [page, setPage] = React.useState(1)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [pushUrl, setPushUrl] = React.useState("/")
  const [notifType, setNotifType] = React.useState("ADMIN_MANUAL")
  const [showPreview, setShowPreview] = React.useState(false)

  // ── Confirmation dialogs state ────────────────────────────────
  const [confirmSendOpen, setConfirmSendOpen] = React.useState(false)
  const [confirmCancelId, setConfirmCancelId] = React.useState<string | null>(null)
  const [confirmDeleteWhId, setConfirmDeleteWhId] = React.useState<string | null>(null)

  // ── Schedule tab state ─────────────────────────────────────────
  const [scheduleMode, setScheduleMode] = React.useState<"now" | "schedule">("now")
  const [scheduledDate, setScheduledDate] = React.useState("")
  const [scheduledTime, setScheduledTime] = React.useState("")
  const [schedulePage, setSchedulePage] = React.useState(1)
  const [scheduleStatusFilter, setScheduleStatusFilter] = React.useState("ALL")

  // ── Webhook tab state ──────────────────────────────────────────
  const [whEvent, setWhEvent] = React.useState("booking.created")
  const [whTitle, setWhTitle] = React.useState("")
  const [whBody, setWhBody] = React.useState("")
  const [whUrl, setWhUrl] = React.useState("/")
  const [whRoles, setWhRoles] = React.useState<string[]>(["PROVIDER"])
  const [whEditing, setWhEditing] = React.useState<string | null>(null)

  // Session history
  const [history, setHistory] = React.useState<
    Array<{
      id: string
      title: string
      usersCount: number
      timestamp: Date
      success: number
      errors: number
    }>
  >([])

  // ── Queries ────────────────────────────────────────────────────

  const {
    data: usersData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "push", "users", search, roleFilter, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set("q", search)
      if (roleFilter !== "ALL") params.set("role", roleFilter)
      params.set("page", String(page))
      params.set("limit", "20")
      return apiGet<UsersResponse>(`/api/admin/push/users?${params.toString()}`)
    },
    staleTime: 30_000,
  })

  // Scheduled query
  const {
    data: scheduleData,
    isLoading: scheduleLoading,
    refetch: scheduleRefetch,
  } = useQuery({
    queryKey: ["admin", "push", "schedule", schedulePage, scheduleStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (scheduleStatusFilter !== "ALL") params.set("status", scheduleStatusFilter)
      params.set("page", String(schedulePage))
      params.set("limit", "15")
      return apiGet<ScheduleResponse>(`/api/admin/push/schedule?${params.toString()}`)
    },
    staleTime: 30_000,
  })

  // Webhooks query
  const {
    data: webhooksData,
    isLoading: whLoading,
    refetch: whRefetch,
  } = useQuery({
    queryKey: ["admin", "push", "webhooks"],
    queryFn: () =>
      apiGet<{ ok: boolean; webhooks: EventWebhookItem[] }>("/api/admin/push/webhooks"),
    staleTime: 30_000,
  })

  // Analytics query
  const [analyticsDays, setAnalyticsDays] = React.useState(30)
  const {
    data: analyticsData,
    isLoading: analyticsLoading,
    refetch: analyticsRefetch,
  } = useQuery({
    queryKey: ["admin", "push", "analytics", analyticsDays],
    queryFn: () => apiGet<PushAnalyticsResponse>(`/api/admin/push/analytics?days=${analyticsDays}`),
    staleTime: 60_000,
  })

  // ── Mutations ──────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: async (userIds: string[]) =>
      apiPost<{ sentCount: number; errorCount: number; total: number; message: string }>(
        "/api/admin/push/send",
        { userIds, title, body, pushUrl, type: notifType },
      ),
    onSuccess: (data: {
      sentCount: number
      errorCount: number
      total: number
      message: string
    }) => {
      toast.success(data.message)
      setHistory((prev) => [
        {
          id: crypto.randomUUID?.() ?? String(Date.now()),
          title,
          usersCount: data.total,
          timestamp: new Date(),
          success: data.sentCount,
          errors: data.errorCount,
        },
        ...prev.slice(0, 9),
      ])
      setSelectedIds(new Set())
      setSelectAll(false)
      setTitle("")
      setBody("")
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao enviar."),
  })

  const scheduleCreateMutation = useMutation({
    mutationFn: () => {
      const scheduledAt = `${scheduledDate}T${scheduledTime}:00.000Z`
      const ids =
        selectAll && usersData?.items ? usersData.items.map((u) => u.id) : Array.from(selectedIds)
      return apiPost("/api/admin/push/schedule", {
        userIds: ids,
        title,
        body,
        pushUrl,
        type: notifType,
        scheduledAt,
      })
    },
    onSuccess: () => {
      toast.success("Notificacao agendada!")
      void scheduleRefetch()
      setSelectedIds(new Set())
      setSelectAll(false)
      setTitle("")
      setBody("")
      setScheduleMode("now")
      setScheduledDate("")
      setScheduledTime("")
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao agendar."),
  })

  const cancelScheduleMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/admin/push/schedule/${id}`, { action: "cancel" }),
    onSuccess: () => {
      toast.success("Agendamento cancelado.")
      void scheduleRefetch()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao cancelar."),
  })

  // Webhook mutations
  const createWebhookMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/admin/push/webhooks", {
        event: whEvent,
        title: whTitle,
        body: whBody,
        pushUrl: whUrl,
        targetRoles: whRoles,
      }),
    onSuccess: () => {
      toast.success("Webhook de evento criado!")
      void whRefetch()
      resetWebhookForm()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao criar webhook."),
  })

  const updateWebhookMutation = useMutation({
    mutationFn: () => {
      if (!whEditing) throw new Error("Nenhum webhook selecionado para edicao.")
      return apiPatch(`/api/admin/push/webhooks/${whEditing}`, {
        title: whTitle,
        body: whBody,
        pushUrl: whUrl,
        targetRoles: whRoles,
      })
    },
    onSuccess: () => {
      toast.success("Webhook atualizado!")
      void whRefetch()
      resetWebhookForm()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao atualizar webhook."),
  })

  const toggleWebhookMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPatch(`/api/admin/push/webhooks/${id}`, { active }),
    onSuccess: () => {
      void whRefetch()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao alternar webhook."),
  })

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/push/webhooks/${id}`),
    onSuccess: () => {
      toast.success("Webhook excluido.")
      void whRefetch()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao excluir webhook."),
  })

  // ── Handlers ───────────────────────────────────────────────────

  const resetWebhookForm = () => {
    setWhEditing(null)
    setWhEvent("booking.created")
    setWhTitle("")
    setWhBody("")
    setWhUrl("/")
    setWhRoles(["PROVIDER"])
    hasAutoApplied.current = false
  }

  const _handleSend = () => {
    const ids =
      selectAll && usersData?.items ? usersData.items.map((u) => u.id) : Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error("Selecione pelo menos um usuario.")
      return
    }
    if (!title.trim()) {
      toast.error("O titulo e obrigatorio.")
      return
    }
    sendMutation.mutate(ids)
  }

  const handleSendOrSchedule = () => {
    if (scheduleMode === "schedule") {
      if (!scheduledDate || !scheduledTime) {
        toast.error("Selecione data e hora.")
        return
      }
      const dt = new Date(`${scheduledDate}T${scheduledTime}:00`)
      if (dt <= new Date()) {
        toast.error("A data deve ser futura.")
        return
      }
      scheduleCreateMutation.mutate()
      return
    }
    // Validate before showing confirmation
    const ids =
      selectAll && usersData?.items ? usersData.items.map((u) => u.id) : Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error("Selecione pelo menos um usuario.")
      return
    }
    if (!title.trim()) {
      toast.error("O titulo e obrigatorio.")
      return
    }
    setConfirmSendOpen(true)
  }

  const confirmSend = () => {
    setConfirmSendOpen(false)
    const ids =
      selectAll && usersData?.items ? usersData.items.map((u) => u.id) : Array.from(selectedIds)
    sendMutation.mutate(ids)
  }

  const toggleUser = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelectAll(false)
      return next
    })
  }

  const startEditWebhook = (w: EventWebhookItem) => {
    setWhEditing(w.id)
    setWhEvent(w.event)
    setWhTitle(w.title)
    setWhBody(w.body ?? "")
    setWhUrl(w.pushUrl)
    setWhRoles(w.targetRoles)
  }

  const toggleWhRole = (role: string) => {
    setWhRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const applyWebhookTemplate = React.useCallback((eventKey: string) => {
    const tmpl = WEBHOOK_TEMPLATES[eventKey]
    if (!tmpl) return
    setWhTitle(tmpl.title)
    setWhBody(tmpl.body)
    setWhUrl(tmpl.pushUrl)
    setWhRoles(tmpl.targetRoles)
  }, [])

  const handleWhEventChange = React.useCallback(
    (value: string) => {
      setWhEvent(value)
      // Auto-apply template when event changes (only in create mode, not edit)
      if (!whEditing) {
        applyWebhookTemplate(value)
      }
    },
    [whEditing, applyWebhookTemplate],
  )

  // Auto-apply template on mount so the form opens pre-filled (create mode only)
  const hasAutoApplied = React.useRef(false)
  React.useEffect(() => {
    if (!whEditing && !hasAutoApplied.current) {
      hasAutoApplied.current = true
      applyWebhookTemplate(whEvent)
    }
  }, [whEditing, whEvent, applyWebhookTemplate])

  const currentIds = usersData?.items?.map((u) => u.id) ?? []

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* ── Tab navigation ──────────────────────────────────────── */}
      <div
        className="flex gap-1 rounded-lg border p-1"
        role="tablist"
        aria-label="Modo do dashboard"
      >
        {[
          { id: "send" as const, label: "Enviar manual", icon: Send },
          { id: "scheduled" as const, label: "Agendadas", icon: CalendarClock },
          { id: "webhooks" as const, label: "Webhooks de Eventos", icon: Webhook },
          { id: "analytics" as const, label: "Analytics", icon: BarChart3 },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════ */}
      {/*  TAB 1: SEND MANUAL                                        */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === "send" && (
        <>
          {/* Stats cards */}
          <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Inscricoes push ativas</CardTitle>
                <Smartphone className="text-muted-foreground size-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {usersData?.totalSubscriptions ?? (
                    <Skeleton className="inline-block h-7 w-16 align-middle" />
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Usuarios com push</CardTitle>
                <Users className="text-muted-foreground size-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {usersData?.total ?? <Skeleton className="inline-block h-7 w-16 align-middle" />}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Enviados (sessao)</CardTitle>
                <Send className="text-muted-foreground size-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {history.reduce((a, h) => a + h.usersCount, 0)}
                </div>
              </CardContent>
            </Card>
          </section>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* User list */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>Usuarios com push ativo</CardTitle>
                      <CardDescription>
                        Selecione os usuarios que receberao a notificacao
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => void refetch()}
                      disabled={isFetching}
                    >
                      <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
                    </Button>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                      <Input
                        placeholder="Buscar por nome ou email..."
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value)
                          setPage(1)
                        }}
                        className="pl-9"
                      />
                    </div>
                    <Select
                      value={roleFilter}
                      onValueChange={(v) => {
                        setRoleFilter(v)
                        setPage(1)
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Filtrar por role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {usersData && usersData.items.length > 0 && (
                    <div className="flex items-center gap-2 border-b px-4 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectAll || selectedIds.size === currentIds.length) {
                            setSelectedIds(new Set())
                            setSelectAll(false)
                          } else {
                            setSelectAll(true)
                            setSelectedIds(new Set(currentIds))
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-medium"
                      >
                        {selectAll || selectedIds.size === currentIds.length ? (
                          <CheckSquare className="text-primary size-4" />
                        ) : (
                          <Square className="size-4" />
                        )}
                        {selectAll || selectedIds.size === currentIds.length
                          ? `${currentIds.length} selecionado(s)`
                          : `${selectedIds.size} selecionado(s)`}
                      </button>
                    </div>
                  )}
                  {isLoading && (
                    <div className="space-y-1 p-4">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-md" />
                      ))}
                    </div>
                  )}
                  {error && !isLoading && (
                    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                      <AlertTriangle className="size-8 text-amber-500" />
                      <p className="text-muted-foreground text-sm">Erro ao carregar usuarios.</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        Tentar novamente
                      </Button>
                    </div>
                  )}
                  {!isLoading && !error && usersData?.items.length === 0 && (
                    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                      <BellOff className="text-muted-foreground size-8" />
                      <p className="text-muted-foreground text-sm">
                        Nenhum usuario com push subscription ativa.
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Os usuarios precisam ativar as notificacoes no navegador (clicar no sino)
                        para aparecerem aqui.
                      </p>
                    </div>
                  )}
                  {!isLoading && !error && usersData && usersData.items.length > 0 && (
                    <div className="max-h-[400px] overflow-y-auto">
                      {usersData.items.map((user) => {
                        const isSelected = selectAll || selectedIds.has(user.id)
                        return (
                          <div
                            key={user.id}
                            className={cn(
                              "hover:bg-muted/30 flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors last:border-0",
                              isSelected && "bg-primary/5",
                            )}
                            onClick={() => toggleUser(user.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                toggleUser(user.id)
                              }
                            }}
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Selecionar ${user.name}`}
                            tabIndex={0}
                          >
                            <span className="shrink-0" aria-hidden="true">
                              {isSelected ? (
                                <CheckSquare className="text-primary size-5" />
                              ) : (
                                <Square className="text-muted-foreground size-5" />
                              )}
                            </span>
                            <Avatar className="size-8 shrink-0">
                              {user.avatarUrl ? (
                                <AvatarImage src={user.avatarUrl} alt={user.name} />
                              ) : null}
                              <AvatarFallback className="bg-primary/8 text-primary text-xs font-semibold">
                                {user.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{user.name}</p>
                              <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {user.role === "PROVIDER"
                                  ? "Prestador"
                                  : user.role === "ADMIN"
                                    ? "Admin"
                                    : "Cliente"}
                              </Badge>
                              {user.subscriptionsCount > 1 && (
                                <span className="text-muted-foreground text-xs">
                                  {user.subscriptionsCount} disp.
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {usersData && usersData.total > usersData.limit && (
                    <div className="flex items-center justify-between border-t px-4 py-3">
                      <p className="text-muted-foreground text-xs">
                        {usersData.total} usuario(s) no total
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Anterior
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page * usersData.limit >= usersData.total}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Proximo
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Send form */}
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="size-4" /> Enviar notificacao
                  </CardTitle>
                  <CardDescription>
                    {selectedIds.size > 0 || selectAll
                      ? `${selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuario(s) selecionado(s)`
                      : "Selecione usuarios ao lado"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Schedule mode toggle */}
                  <div className="flex gap-1 rounded-lg border p-1">
                    <button
                      type="button"
                      onClick={() => setScheduleMode("now")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        scheduleMode === "now"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Zap className="size-3.5" /> Enviar agora
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleMode("schedule")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        scheduleMode === "schedule"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <CalendarClock className="size-3.5" /> Agendar
                    </button>
                  </div>
                  {scheduleMode === "schedule" && (
                    <div className="space-y-2 rounded-lg border border-dashed p-3">
                      <label className="text-foreground text-xs font-medium">
                        Data e hora do envio <span className="text-destructive">*</span>
                      </label>
                      <div className="flex gap-2">
                        <Input
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          min={new Date().toISOString().split("T")[0]}
                          className="flex-1"
                        />
                        <Input
                          type="time"
                          value={scheduledTime}
                          onChange={(e) => setScheduledTime(e.target.value)}
                          className="w-[130px]"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-foreground text-xs font-medium">Tipo</label>
                    <Select value={notifType} onValueChange={setNotifType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NOTIFICATION_TYPES.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-foreground text-xs font-medium">
                      Titulo <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="Ex: Promocao imperdivel!"
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                      maxLength={120}
                    />
                    <p className="text-muted-foreground text-right text-[10px]">
                      {title.length}/120
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-foreground text-xs font-medium">Corpo da mensagem</label>
                    <Textarea
                      placeholder="Digite o texto da notificacao..."
                      value={body}
                      onChange={(e) => setBody(e.target.value.slice(0, 500))}
                      maxLength={500}
                      rows={3}
                    />
                    <p className="text-muted-foreground text-right text-[10px]">
                      {body.length}/500
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-foreground text-xs font-medium">
                      URL de destino (ao clicar)
                    </label>
                    <Input
                      placeholder="/"
                      value={pushUrl}
                      onChange={(e) => setPushUrl(e.target.value)}
                    />
                    <p className="text-muted-foreground text-[10px]">
                      Deixe &quot;/&quot; para ir para a pagina inicial
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPreview((p) => !p)}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
                  >
                    {showPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {showPreview ? "Ocultar preview" : "Ver preview do payload"}
                  </button>
                  {showPreview && (
                    <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-[10px] leading-relaxed">
                      {JSON.stringify(
                        {
                          title,
                          body,
                          pushUrl,
                          type: notifType,
                          userIds: selectAll
                            ? `[${usersData?.total ?? "..."} usuarios]`
                            : Array.from(selectedIds),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  )}
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <AlertDialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
                    <Button
                      className="w-full gap-2"
                      onClick={handleSendOrSchedule}
                      disabled={
                        sendMutation.isPending ||
                        scheduleCreateMutation.isPending ||
                        (selectedIds.size === 0 && !selectAll) ||
                        !title.trim()
                      }
                    >
                      {sendMutation.isPending || scheduleCreateMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : scheduleMode === "schedule" ? (
                        <CalendarClock className="size-4" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      {sendMutation.isPending
                        ? "Enviando..."
                        : scheduleCreateMutation.isPending
                          ? "Agendando..."
                          : scheduleMode === "schedule"
                            ? `Agendar para ${selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuario(s)`
                            : `Enviar para ${selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuario(s)`}
                    </Button>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <Send className="size-5" />
                          Confirmar envio de notificação
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Você está prestes a enviar uma notificação push para{" "}
                          <strong>
                            {selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuário(s)
                          </strong>
                          .
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="bg-muted/50 space-y-2 rounded-lg p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Título</span>
                          <span className="max-w-[200px] truncate text-right font-medium">
                            {title}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Tipo</span>
                          <span className="font-medium">
                            {NOTIFICATION_TYPES.find((t) => t.value === notifType)?.label ??
                              notifType}
                          </span>
                        </div>
                        {body && (
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-muted-foreground shrink-0">Corpo</span>
                            <span className="max-w-[200px] truncate text-right text-xs">
                              {body}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Destinatários</span>
                          <span className="font-medium">
                            {selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuário(s)
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">URL</span>
                          <span className="max-w-[200px] truncate text-xs font-medium">
                            {pushUrl}
                          </span>
                        </div>
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmSend} className="gap-2">
                          <Send className="size-4" />
                          Confirmar e enviar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {(sendMutation.isPending || scheduleCreateMutation.isPending) && (
                    <p className="text-muted-foreground text-xs">
                      {sendMutation.isPending
                        ? "Enviando notificacoes... Isso pode levar alguns segundos."
                        : "Agendando notificacao..."}
                    </p>
                  )}
                </CardFooter>
              </Card>
              {history.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Bell className="size-4" /> Historico da sessao
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 p-0">
                    {history.map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between border-b px-4 py-2.5 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{h.title}</p>
                          <p className="text-muted-foreground text-[10px]">
                            {h.usersCount} usuario(s) · {h.timestamp.toLocaleTimeString("pt-BR")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {h.errors > 0 ? (
                            <>
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              <span className="text-xs text-emerald-500 tabular-nums">
                                {h.success}
                              </span>
                              <XCircle className="text-destructive size-3.5" />
                              <span className="text-destructive text-xs tabular-nums">
                                {h.errors}
                              </span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              <span className="text-xs text-emerald-500 tabular-nums">
                                {h.success}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/*  TAB 2: SCHEDULED                                           */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === "scheduled" && (
        <section aria-label="Notificacoes agendadas">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                <CalendarClock className="mr-2 inline-block size-5 align-text-top" /> Notificacoes
                agendadas
              </h3>
              <p className="text-muted-foreground text-sm">
                Notificacoes programadas para envio futuro. O cron job verifica a cada 5 minutos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={scheduleStatusFilter}
                onValueChange={(v) => {
                  setScheduleStatusFilter(v)
                  setSchedulePage(1)
                }}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Filtrar status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos os status</SelectItem>
                  <SelectItem value="PENDING">Pendentes</SelectItem>
                  <SelectItem value="SENT">Enviados</SelectItem>
                  <SelectItem value="CANCELLED">Cancelados</SelectItem>
                  <SelectItem value="FAILED">Falhos</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => void scheduleRefetch()}
                disabled={scheduleLoading}
              >
                <RotateCw className={cn("size-4", scheduleLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <Card>
            {scheduleLoading && (
              <CardContent className="p-6">
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-md" />
                  ))}
                </div>
              </CardContent>
            )}
            {!scheduleLoading && !scheduleData && (
              <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <AlertTriangle className="size-8 text-amber-500" />
                <p className="text-muted-foreground text-sm">Erro ao carregar agendamentos.</p>
                <Button variant="outline" size="sm" onClick={() => void scheduleRefetch()}>
                  Tentar novamente
                </Button>
              </CardContent>
            )}
            {!scheduleLoading && scheduleData && scheduleData.items.length === 0 && (
              <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <CalendarOff className="text-muted-foreground size-8" />
                <p className="text-muted-foreground text-sm">Nenhuma notificacao agendada.</p>
                <p className="text-muted-foreground text-xs">
                  Use a aba &quot;Enviar manual&quot; com modo &quot;Agendar&quot; para programar
                  uma.
                </p>
              </CardContent>
            )}
            {!scheduleLoading && scheduleData && scheduleData.items.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Titulo</TableHead>
                      <TableHead>Agendado para</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Usuarios</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead className="w-[80px]">Acao</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduleData.items.map((item) => {
                      const sd = new Date(item.scheduledAt)
                      const isPast = sd <= new Date()
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-[200px]">
                            <p className="truncate font-medium">{item.title}</p>
                            {item.body && (
                              <p className="text-muted-foreground truncate text-xs">{item.body}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm">
                              <Clock className="text-muted-foreground size-3.5" />
                              <span>
                                {sd.toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                })}{" "}
                                {sd.toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                            {isPast && item.status === "PENDING" && (
                              <p className="mt-0.5 text-[10px] text-amber-500">
                                Atrasado — aguardando cron
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={item.status} />
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {item.userIdsCount}
                          </TableCell>
                          <TableCell>
                            {item.status === "SENT" || item.status === "FAILED" ? (
                              <span className="flex items-center gap-1.5 text-xs tabular-nums">
                                <CheckCircle2 className="size-3.5 text-emerald-500" />
                                {item.sentCount}
                                {item.errorCount > 0 && (
                                  <>
                                    <XCircle className="text-destructive ml-1 size-3.5" />
                                    {item.errorCount}
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {item.status === "PENDING" ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-destructive size-8"
                                  onClick={() => setConfirmCancelId(item.id)}
                                  disabled={cancelScheduleMutation.isPending}
                                  title="Cancelar agendamento"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                                <AlertDialog
                                  open={confirmCancelId === item.id}
                                  onOpenChange={(open) => {
                                    if (!open) setConfirmCancelId(null)
                                  }}
                                >
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle className="flex items-center gap-2">
                                        <CalendarOff className="size-5 text-amber-500" />
                                        Cancelar agendamento?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Esta ação não pode ser desfeita. A notificação agendada{" "}
                                        <strong>"{item.title}"</strong> para{" "}
                                        {new Date(item.scheduledAt).toLocaleDateString("pt-BR", {
                                          day: "2-digit",
                                          month: "2-digit",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}{" "}
                                        será cancelada e {item.userIdsCount} usuário(s) não
                                        receberão a notificação.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel onClick={() => setConfirmCancelId(null)}>
                                        Voltar
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => {
                                          cancelScheduleMutation.mutate(item.id)
                                          setConfirmCancelId(null)
                                        }}
                                        className="bg-destructive hover:bg-destructive/90 gap-2"
                                      >
                                        <CalendarOff className="size-4" />
                                        Cancelar agendamento
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {scheduleData.totalPages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <p className="text-muted-foreground text-xs">
                      {scheduleData.total} agendamento(s)
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={schedulePage <= 1}
                        onClick={() => setSchedulePage((p) => Math.max(1, p - 1))}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={schedulePage >= scheduleData.totalPages}
                        onClick={() => setSchedulePage((p) => p + 1)}
                      >
                        Proximo
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/*  TAB 4: ANALYTICS                                           */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === "analytics" && (
        <section aria-label="Analytics de push">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                <BarChart3 className="mr-2 inline-block size-5 align-text-top" /> Analytics de Push
              </h3>
              <p className="text-muted-foreground text-sm">
                Metricas de entrega, taxa de clique e desempenho das notificacoes push.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={String(analyticsDays)}
                onValueChange={(v) => setAnalyticsDays(Number(v))}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Ultimos 7 dias</SelectItem>
                  <SelectItem value="30">Ultimos 30 dias</SelectItem>
                  <SelectItem value="90">Ultimos 90 dias</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => void analyticsRefetch()}
                disabled={analyticsLoading}
              >
                <RotateCw className={cn("size-4", analyticsLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {analyticsLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          )}

          {!analyticsLoading && analyticsData && (
            <div className="flex flex-col gap-6">
              {/* ── Rate cards ──────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <RateCard
                  label="Entrega"
                  value={`${analyticsData.rates?.deliveryRate ?? 0}%`}
                  subtitle={`${analyticsData.summary?.delivered ?? 0} entregues`}
                  trend={(analyticsData.rates?.deliveryRate ?? 0) >= 90 ? "up" : "down"}
                  icon={TrendingUp}
                />
                <RateCard
                  label="Clique (CTR)"
                  value={`${analyticsData.rates?.clickRate ?? 0}%`}
                  subtitle={`${analyticsData.summary?.clicked ?? 0} cliques`}
                  trend={(analyticsData.rates?.clickRate ?? 0) >= 10 ? "up" : "neutral"}
                  icon={MousePointerClick}
                />
                <RateCard
                  label="Rejeicao"
                  value={`${analyticsData.rates?.bounceRate ?? 0}%`}
                  subtitle={`${analyticsData.summary?.bounced ?? 0} subs expiradas`}
                  trend={(analyticsData.rates?.bounceRate ?? 0) > 5 ? "down" : "up"}
                  icon={TrendingDown}
                  inverse
                />
                <RateCard
                  label="Falha"
                  value={`${analyticsData.rates?.failureRate ?? 0}%`}
                  subtitle={`${analyticsData.summary?.failed ?? 0} falhas`}
                  trend={(analyticsData.rates?.failureRate ?? 0) > 2 ? "down" : "up"}
                  icon={XCircle}
                  inverse
                />
              </div>

              {/* ── Totals + subscriptions ───────────────────────────── */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <MetricCard
                  label="Total enviado"
                  value={String(analyticsData.summary?.totalSent ?? 0)}
                />
                <MetricCard
                  label="Entregues"
                  value={String(analyticsData.summary?.delivered ?? 0)}
                />
                <MetricCard label="Cliques" value={String(analyticsData.summary?.clicked ?? 0)} />
                <MetricCard
                  label="Rejeitados"
                  value={String(analyticsData.summary?.bounced ?? 0)}
                />
                <MetricCard
                  label="Subs. ativas"
                  value={String(analyticsData.activeSubscriptions ?? 0)}
                  icon={Smartphone}
                />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* ── By source ──────────────────────────────────────── */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Por origem</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Origem</TableHead>
                          <TableHead className="text-right">Enviados</TableHead>
                          <TableHead className="text-right">%</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(analyticsData.bySource ?? []).map(
                          (s: { source: string; count: number }) => (
                            <TableRow key={s.source}>
                              <TableCell className="font-medium capitalize">{s.source}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                              <TableCell className="text-muted-foreground text-right tabular-nums">
                                {(analyticsData.summary?.totalSent ?? 0) > 0
                                  ? `${Math.round((s.count / (analyticsData.summary?.totalSent ?? 1)) * 100)}%`
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* ── By type ────────────────────────────────────────── */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Por tipo</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tipo</TableHead>
                          <TableHead className="text-right">Enviados</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(analyticsData.byType ?? []).map((t: { type: string; count: number }) => (
                          <TableRow key={t.type}>
                            <TableCell className="text-xs font-medium">{t.type}</TableCell>
                            <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              {/* ── Daily trend ──────────────────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <BarChart3 className="size-4" />
                    Tendencia diaria
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {analyticsData.daily && analyticsData.daily.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b text-left">
                            <th className="pr-4 pb-2 font-normal">Data</th>
                            <th className="px-2 pb-2 text-right font-normal">Enviados</th>
                            <th className="px-2 pb-2 text-right font-normal">Cliques</th>
                            <th className="px-2 pb-2 text-right font-normal">Rejeit.</th>
                            <th className="px-2 pb-2 text-right font-normal">Falhas</th>
                            <th className="pb-2 pl-2 text-right font-normal">CTR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsData.daily.map(
                            (d: {
                              date: string
                              sent: number
                              clicked: number
                              bounced: number
                              failed: number
                            }) => {
                              const ctr = d.sent > 0 ? Math.round((d.clicked / d.sent) * 100) : 0
                              return (
                                <tr
                                  key={d.date}
                                  className="hover:bg-muted/30 border-b last:border-0"
                                >
                                  <td className="py-2 pr-4 font-medium">
                                    {new Date(d.date + "T00:00:00").toLocaleDateString("pt-BR", {
                                      day: "2-digit",
                                      month: "2-digit",
                                    })}
                                  </td>
                                  <td className="px-2 py-2 text-right tabular-nums">{d.sent}</td>
                                  <td className="px-2 py-2 text-right tabular-nums">{d.clicked}</td>
                                  <td className="px-2 py-2 text-right text-amber-500 tabular-nums">
                                    {d.bounced}
                                  </td>
                                  <td className="text-destructive px-2 py-2 text-right tabular-nums">
                                    {d.failed}
                                  </td>
                                  <td className="py-2 pl-2 text-right tabular-nums">{ctr}%</td>
                                </tr>
                              )
                            },
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                      <BarChart3 className="text-muted-foreground size-6" />
                      <p className="text-muted-foreground text-xs">
                        Nenhum dado disponivel para o periodo selecionado.
                      </p>
                      <p className="text-muted-foreground text-[10px]">
                        Os dados comecam a aparecer apos o primeiro envio de notificacao.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Top notifications ──────────────────────────────── */}
              {analyticsData.topNotifications && analyticsData.topNotifications.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Notificacoes mais enviadas</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Titulo</TableHead>
                          <TableHead className="text-right">Enviados</TableHead>
                          <TableHead className="text-right">Dispositivos</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analyticsData.topNotifications.map(
                          (n: { title: string; sent: number; devices: number }, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="max-w-[300px]">
                                <p className="truncate text-sm">{n.title}</p>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{n.sent}</TableCell>
                              <TableCell className="text-muted-foreground text-right tabular-nums">
                                {n.devices}
                              </TableCell>
                            </TableRow>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {!analyticsLoading && !analyticsData && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <AlertTriangle className="size-8 text-amber-500" />
                <p className="text-muted-foreground text-sm">Erro ao carregar analytics.</p>
                <Button variant="outline" size="sm" onClick={() => void analyticsRefetch()}>
                  Tentar novamente
                </Button>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/*  TAB 3: EVENT WEBHOOKS                                      */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === "webhooks" && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* ── Webhooks list ────────────────────────────────────── */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  <Webhook className="mr-2 inline-block size-5 align-text-top" /> Regras de Webhook
                </h3>
                <p className="text-muted-foreground text-sm">
                  Disparam push automaticamente quando eventos do sistema ocorrem.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => void whRefetch()}
                disabled={whLoading}
              >
                <RotateCw className={cn("size-4", whLoading && "animate-spin")} />
              </Button>
            </div>

            <Card>
              {whLoading && (
                <CardContent className="p-6">
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full rounded-md" />
                    ))}
                  </div>
                </CardContent>
              )}
              {!whLoading && !webhooksData && (
                <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <AlertTriangle className="size-8 text-amber-500" />
                  <p className="text-muted-foreground text-sm">Erro ao carregar webhooks.</p>
                  <Button variant="outline" size="sm" onClick={() => void whRefetch()}>
                    Tentar novamente
                  </Button>
                </CardContent>
              )}
              {!whLoading && webhooksData && webhooksData.webhooks.length === 0 && (
                <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <Webhook className="text-muted-foreground size-8" />
                  <p className="text-muted-foreground text-sm">
                    Nenhuma regra de webhook configurada.
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Crie regras ao lado para automatizar notificacoes push por evento.
                  </p>
                </CardContent>
              )}
              {!whLoading && webhooksData && webhooksData.webhooks.length > 0 && (
                <div className="max-h-[500px] overflow-y-auto">
                  {webhooksData.webhooks.map((w) => (
                    <div
                      key={w.id}
                      className={cn(
                        "hover:bg-muted/30 flex items-start gap-3 border-b p-4 transition-colors last:border-0",
                        whEditing === w.id && "bg-primary/5",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{w.title}</p>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {w.event}
                          </Badge>
                        </div>
                        {w.body && (
                          <p className="text-muted-foreground truncate text-xs">{w.body}</p>
                        )}
                        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[10px]">
                          {(w.targetRoles as string[]).map((r) => (
                            <Badge key={r} variant="secondary" className="px-1.5 py-0 text-[9px]">
                              {r}
                            </Badge>
                          ))}
                          <span className="ml-1">· {w.pushUrl}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={w.active}
                          onCheckedChange={(checked) =>
                            toggleWebhookMutation.mutate({ id: w.id, active: checked })
                          }
                          aria-label="Ativar/desativar"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => startEditWebhook(w)}
                          title="Editar"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive size-7"
                          onClick={() => setConfirmDeleteWhId(w.id)}
                          title="Excluir"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                        <AlertDialog
                          open={confirmDeleteWhId === w.id}
                          onOpenChange={(open) => {
                            if (!open) setConfirmDeleteWhId(null)
                          }}
                        >
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <Trash2 className="text-destructive size-5" />
                                Excluir regra de webhook?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                A regra <strong>"{w.title}"</strong> para o evento{" "}
                                <strong>{w.event}</strong> será excluída permanentemente.
                                Notificações automáticas para este evento pararão de ser enviadas.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setConfirmDeleteWhId(null)}>
                                Voltar
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  deleteWebhookMutation.mutate(w.id)
                                  setConfirmDeleteWhId(null)
                                }}
                                className="bg-destructive hover:bg-destructive/90 gap-2"
                              >
                                <Trash2 className="size-4" />
                                Excluir permanentemente
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── Webhook form ─────────────────────────────────────── */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {whEditing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                  {whEditing ? "Editar regra" : "Nova regra de webhook"}
                </CardTitle>
                <CardDescription>
                  {whEditing
                    ? "Atualize os campos abaixo."
                    : "Defina quando e para quem enviar push automaticamente."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Event type */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-foreground text-xs font-medium">
                      Evento <span className="text-destructive">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => applyWebhookTemplate(whEvent)}
                      className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-[10px] font-medium transition-colors"
                    >
                      <Sparkles className="size-3" />
                      Usar template padrão
                    </button>
                  </div>
                  <Select value={whEvent} onValueChange={handleWhEventChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENTS_LIST.map((ev) => (
                        <SelectItem key={ev.value} value={ev.value}>
                          {ev.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Template indicator + available variables */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Template badge — only in create mode */}
                    {!whEditing && (whTitle || whBody) && (
                      <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                        <Sparkles className="size-2.5" />
                        Template aplicado
                      </span>
                    )}
                    {/* Available variables */}
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px]">
                      <Info className="size-3" /> Variaveis:
                      {(EVENT_VARIABLES[whEvent] ?? []).map((v) => (
                        <code
                          key={v}
                          className="bg-muted rounded px-1 py-0.5 font-mono text-[10px]"
                        >{`{{${v}}}`}</code>
                      ))}
                    </span>
                  </div>
                </div>

                {/* Title template */}
                <div className="space-y-2">
                  <label className="text-foreground text-xs font-medium">
                    Template do titulo <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder="Ex: Novo agendamento de {{serviceName}}"
                    value={whTitle}
                    onChange={(e) => setWhTitle(e.target.value.slice(0, 200))}
                    maxLength={200}
                  />
                  <p className="text-muted-foreground text-right text-[10px]">
                    {whTitle.length}/200
                  </p>
                </div>

                {/* Body template */}
                <div className="space-y-2">
                  <label className="text-foreground text-xs font-medium">Template do corpo</label>
                  <Textarea
                    placeholder="Ex: {{clientName}} agendou {{serviceName}} para {{date}}"
                    value={whBody}
                    onChange={(e) => setWhBody(e.target.value.slice(0, 500))}
                    maxLength={500}
                    rows={2}
                  />
                  <p className="text-muted-foreground text-right text-[10px]">
                    {whBody.length}/500
                  </p>
                </div>

                {/* Push URL */}
                <div className="space-y-2">
                  <label className="text-foreground text-xs font-medium">URL de destino</label>
                  <Input placeholder="/" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} />
                </div>

                {/* Target roles */}
                <div className="space-y-2">
                  <label className="text-foreground text-xs font-medium">
                    Quem recebe? <span className="text-destructive">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {TARGET_ROLE_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        type="button"
                        variant={whRoles.includes(opt.value) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleWhRole(opt.value)}
                      >
                        {whRoles.includes(opt.value) ? (
                          <ToggleRight className="mr-1 size-3.5" />
                        ) : (
                          <ToggleLeft className="mr-1 size-3.5" />
                        )}
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-muted/30 rounded-lg border border-dashed p-3">
                  <p className="text-muted-foreground mb-1 flex items-center gap-1 text-xs font-medium">
                    <Eye className="size-3.5" /> Preview
                  </p>
                  <p className="text-sm font-medium">{whTitle || "(titulo aparecera aqui)"}</p>
                  {whBody && <p className="text-muted-foreground text-xs">{whBody}</p>}
                  <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[10px]">
                    <Variable className="size-3" /> Enviado para:{" "}
                    {whRoles.length > 0 ? whRoles.join(", ") : "ninguem"}
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    if (!whTitle.trim()) {
                      toast.error("O titulo e obrigatorio.")
                      return
                    }
                    if (whRoles.length === 0) {
                      toast.error("Selecione pelo menos uma role alvo.")
                      return
                    }
                    if (whEditing) updateWebhookMutation.mutate()
                    else createWebhookMutation.mutate()
                  }}
                  disabled={createWebhookMutation.isPending || updateWebhookMutation.isPending}
                >
                  {createWebhookMutation.isPending || updateWebhookMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : whEditing ? (
                    <Pencil className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {createWebhookMutation.isPending
                    ? "Criando..."
                    : updateWebhookMutation.isPending
                      ? "Salvando..."
                      : whEditing
                        ? "Salvar alteracoes"
                        : "Criar regra"}
                </Button>
                {whEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={resetWebhookForm}
                  >
                    Cancelar edicao
                  </Button>
                )}
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-component: StatusBadge ──────────────────────────────────────────────

// ── Sub-components: Analytics cards ────────────────────────────────────────

function RateCard({
  label,
  value,
  subtitle,
  trend,
  icon: Icon,
  inverse,
}: {
  label: string
  value: string
  subtitle: string
  trend: "up" | "down" | "neutral"
  icon: React.ComponentType<{ className?: string }>
  inverse?: boolean
}) {
  const isGood = inverse ? trend === "down" : trend === "up"
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
        <Icon
          className={cn(
            "size-4",
            isGood
              ? "text-emerald-500"
              : trend === "neutral"
                ? "text-muted-foreground"
                : "text-destructive",
          )}
        />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1.5">
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          {trend !== "neutral" &&
            (isGood ? (
              <ArrowUp className="size-3.5 text-emerald-500" />
            ) : (
              <ArrowDown className="text-destructive size-3.5" />
            ))}
        </div>
        <p className="text-muted-foreground text-[10px]">{subtitle}</p>
      </CardContent>
    </Card>
  )
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
        {Icon && <Icon className="text-muted-foreground size-3.5" />}
      </CardHeader>
      <CardContent>
        <p className="text-xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  > = {
    PENDING: { label: "Pendente", variant: "secondary" },
    SENT: { label: "Enviado", variant: "default" },
    CANCELLED: { label: "Cancelado", variant: "outline" },
    FAILED: { label: "Falhou", variant: "destructive" },
  }
  const c = config[status] ?? { label: status, variant: "outline" as const }
  return <Badge variant={c.variant}>{c.label}</Badge>
}
