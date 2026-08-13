"use client"

import * as React from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
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
  Zap,
} from "lucide-react"

import { apiGet, apiPost } from "@/lib/api"
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
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
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

import { type UsersResponse, ROLE_OPTIONS, NOTIFICATION_TYPES } from "./types"

export function PushSendTab({ onScheduleSuccess }: { onScheduleSuccess?: () => void }) {
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
  const [confirmSendOpen, setConfirmSendOpen] = React.useState(false)

  const [scheduleMode, setScheduleMode] = React.useState<"now" | "schedule">("now")
  const [scheduledDate, setScheduledDate] = React.useState("")
  const [scheduledTime, setScheduledTime] = React.useState("")

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
      toast.success("Notificação agendada com sucesso!")
      onScheduleSuccess?.()
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

    const ids =
      selectAll && usersData?.items ? usersData.items.map((u) => u.id) : Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error("Selecione pelo menos um usuário.")
      return
    }
    if (!title.trim()) {
      toast.error("O título é obrigatório.")
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

  const currentIds = usersData?.items?.map((u) => u.id) ?? []

  return (
    <>
      {/* Stats cards */}
      <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Inscrições push ativas</CardTitle>
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
            <CardTitle className="text-sm font-medium">Usuários com push</CardTitle>
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
            <CardTitle className="text-sm font-medium">Enviados (sessão)</CardTitle>
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
                  <CardTitle>Usuários com push ativo</CardTitle>
                  <CardDescription>
                    Selecione os usuários que receberão a notificação
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
                  <p className="text-muted-foreground text-sm">Erro ao carregar usuários.</p>
                  <Button variant="outline" size="sm" onClick={() => void refetch()}>
                    Tentar novamente
                  </Button>
                </div>
              )}
              {!isLoading && !error && usersData?.items.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <BellOff className="text-muted-foreground size-8" />
                  <p className="text-muted-foreground text-sm">
                    Nenhum usuário com push subscription ativa.
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Os usuários precisam ativar as notificações no navegador (clicar no sino) para
                    aparecerem aqui.
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
                    {usersData.total} usuário(s) no total
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
                      Próximo
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
                <Send className="size-4" /> Enviar notificação
              </CardTitle>
              <CardDescription>
                {selectedIds.size > 0 || selectAll
                  ? `${selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuário(s) selecionado(s)`
                  : "Selecione usuários ao lado"}
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
                  Título <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder="Ex: Promoção imperdível!"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                  maxLength={120}
                />
                <p className="text-muted-foreground text-right text-[10px]">{title.length}/120</p>
              </div>

              <div className="space-y-2">
                <label className="text-foreground text-xs font-medium">Corpo da mensagem</label>
                <Textarea
                  placeholder="Digite o texto da notificação..."
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={3}
                />
                <p className="text-muted-foreground text-right text-[10px]">{body.length}/500</p>
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
                  Deixe &quot;/&quot; para ir para a página inicial
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
                        ? `[${usersData?.total ?? "..."} usuários]`
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
                        ? `Agendar para ${selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuário(s)`
                        : `Enviar para ${selectAll ? (usersData?.total ?? "...") : selectedIds.size} usuário(s)`}
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
                      <span className="max-w-[200px] truncate text-right font-medium">{title}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Tipo</span>
                      <span className="font-medium">
                        {NOTIFICATION_TYPES.find((t) => t.value === notifType)?.label ?? notifType}
                      </span>
                    </div>
                    {body && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground shrink-0">Corpo</span>
                        <span className="max-w-[200px] truncate text-right text-xs">{body}</span>
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
                      <span className="max-w-[200px] truncate text-xs font-medium">{pushUrl}</span>
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
                    ? "Enviando notificações... Isso pode levar alguns segundos."
                    : "Agendando notificação..."}
                </p>
              )}
            </CardFooter>
          </Card>

          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Bell className="size-4" /> Histórico da sessão
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
                        {h.usersCount} usuário(s) · {h.timestamp.toLocaleTimeString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {h.errors > 0 ? (
                        <>
                          <CheckCircle2 className="size-3.5 text-emerald-500" />
                          <span className="text-xs text-emerald-500 tabular-nums">{h.success}</span>
                          <XCircle className="text-destructive size-3.5" />
                          <span className="text-destructive text-xs tabular-nums">{h.errors}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3.5 text-emerald-500" />
                          <span className="text-xs text-emerald-500 tabular-nums">{h.success}</span>
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
  )
}
