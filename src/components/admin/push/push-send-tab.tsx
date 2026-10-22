"use client"

import * as React from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Send, Users, Smartphone } from "lucide-react"

import { apiGet, apiPost } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

import { type UsersResponse } from "./types"
import { PushSendUsersTable } from "./push-send-users-table"
import { PushSendComposer } from "./push-send-composer"
import { PushSendHistory, type PushHistoryItem } from "./push-send-history"

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

  const [history, setHistory] = React.useState<PushHistoryItem[]>([])

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
    if (!body.trim()) {
      toast.error("O corpo da mensagem é obrigatório.")
      return
    }

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

  const toggleSelectAll = () => {
    if (selectAll || selectedIds.size === currentIds.length) {
      setSelectedIds(new Set())
      setSelectAll(false)
    } else {
      setSelectAll(true)
      setSelectedIds(new Set(currentIds))
    }
  }

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
          <PushSendUsersTable
            usersData={usersData}
            isLoading={isLoading}
            isFetching={isFetching}
            error={error}
            search={search}
            onSearchChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            roleFilter={roleFilter}
            onRoleFilterChange={(v) => {
              setRoleFilter(v)
              setPage(1)
            }}
            page={page}
            onPageChange={setPage}
            selectedIds={selectedIds}
            selectAll={selectAll}
            onToggleSelectAll={toggleSelectAll}
            onToggleSelectUser={toggleUser}
            onRefetch={() => void refetch()}
          />
        </div>

        {/* Send form */}
        <div className="flex flex-col gap-6">
          <PushSendComposer
            selectedCount={selectedIds.size}
            selectAll={selectAll}
            totalUsers={usersData?.total}
            scheduleMode={scheduleMode}
            onScheduleModeChange={setScheduleMode}
            scheduledDate={scheduledDate}
            onScheduledDateChange={setScheduledDate}
            scheduledTime={scheduledTime}
            onScheduledTimeChange={setScheduledTime}
            notifType={notifType}
            onNotifTypeChange={setNotifType}
            title={title}
            onTitleChange={setTitle}
            body={body}
            onBodyChange={setBody}
            pushUrl={pushUrl}
            onPushUrlChange={setPushUrl}
            showPreview={showPreview}
            onTogglePreview={() => setShowPreview((p) => !p)}
            isPending={sendMutation.isPending || scheduleCreateMutation.isPending}
            confirmSendOpen={confirmSendOpen}
            onConfirmSendOpenChange={setConfirmSendOpen}
            onSubmit={handleSendOrSchedule}
            onConfirmSend={confirmSend}
            selectedIds={selectedIds}
          />

          <PushSendHistory history={history} />
        </div>
      </div>
    </>
  )
}
