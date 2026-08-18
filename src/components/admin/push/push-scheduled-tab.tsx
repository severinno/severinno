"use client"

import * as React from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import {
  CalendarClock,
  Clock,
  Trash2,
  CalendarOff,
  AlertTriangle,
  RotateCw,
  CheckCircle2,
  XCircle,
} from "lucide-react"

import { apiGet, apiPatch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

import { type ScheduleResponse } from "./types"

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

export function PushScheduledTab() {
  const [schedulePage, setSchedulePage] = React.useState(1)
  const [scheduleStatusFilter, setScheduleStatusFilter] = React.useState("ALL")
  const [confirmCancelId, setConfirmCancelId] = React.useState<string | null>(null)

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

  const cancelScheduleMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/admin/push/schedule/${id}`, { action: "cancel" }),
    onSuccess: () => {
      toast.success("Agendamento cancelado.")
      void scheduleRefetch()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao cancelar."),
  })

  return (
    <section aria-label="Notificações agendadas">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            <CalendarClock className="mr-2 inline-block size-5 align-text-top" /> Notificações
            agendadas
          </h3>
          <p className="text-muted-foreground text-sm">
            Notificações programadas para envio futuro. O cron job verifica a cada 5 minutos.
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
            <p className="text-muted-foreground text-sm">Nenhuma notificação agendada.</p>
            <p className="text-muted-foreground text-xs">
              Use a aba &quot;Enviar manual&quot; com modo &quot;Agendar&quot; para programar uma.
            </p>
          </CardContent>
        )}
        {!scheduleLoading && scheduleData && scheduleData.items.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Agendado para</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Usuários</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead className="w-[80px]">Ação</TableHead>
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
                            {sd.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}{" "}
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
                      <TableCell className="text-sm tabular-nums">{item.userIdsCount}</TableCell>
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
                                    <strong>&quot;{item.title}&quot;</strong> para{" "}
                                    {new Date(item.scheduledAt).toLocaleDateString("pt-BR", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}{" "}
                                    será cancelada e {item.userIdsCount} usuário(s) não receberão a
                                    notificação.
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
                <p className="text-muted-foreground text-xs">{scheduleData.total} agendamento(s)</p>
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
                    Próximo
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  )
}
