"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  Hourglass,
  Info,
  MapPin,
  Radio,
  Search,
  Sparkles,
} from "lucide-react"

import { ServiceDeliveryReportModal } from "@/components/shared/service-delivery-report-modal"
import { ServiceCompletionCelebrationDialog } from "@/components/shared/service-completion-celebration-dialog"
import { QuickMediationModal } from "@/components/shared/quick-mediation-modal"
import { PullToRefresh } from "@/components/shared/pull-to-refresh"
import { ProviderTransitHud } from "@/components/provider/provider-transit-hud"
import { apiGet, apiPatch } from "@/lib/api"
import { cacheOfflineBookings, getCachedOfflineBookings } from "@/lib/offline-bookings-cache"
import { OfflineSimulationToggle } from "@/components/provider/offline-simulation-toggle"
import {
  BookingDetailsDialog,
  PAY_BADGE_STYLES,
  initials,
} from "@/components/provider/provider-booking-details-dialog"
import { BookingActions, BookingCard } from "@/components/provider/provider-booking-card"
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDate, formatTime } from "@/lib/format"
import { BookingStatusBadge } from "@/components/admin/admin-shared"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Booking = {
  id: string
  clientId: string
  providerId: string
  serviceId: string
  scheduledAt: string
  status: BookingStatus
  address: string
  cep: string
  lat: number
  lng: number
  amount: number
  quantity: number
  unit: string
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  notes?: string | null
  beforePhotos?: string[] | null
  afterPhotos?: string[] | null
  completionNote?: string | null
  createdAt: string
  updatedAt: string
  service: {
    id: string
    title: string
    basePrice: number
    unit: string
  }
  client: {
    id: string
    name: string
    avatarUrl?: string | null
  }
  payment?: {
    id: string
    amount: number
    method: string
    status: string
  } | null
}

type Tab = BookingStatus | "all"

const STATUS_TABS: Array<{ value: Tab; label: string }> = [
  { value: "PENDING", label: "Pendentes" },
  { value: "CONFIRMED", label: "Confirmados" },
  { value: "IN_PROGRESS", label: "Em andamento" },
  { value: "COMPLETED", label: "Concluídos" },
  { value: "CANCELLED", label: "Cancelados" },
  { value: "all", label: "Todos" },
]

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderBookings() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const [tab, setTab] = React.useState<string>("PENDING")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [detail, setDetail] = React.useState<Booking | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [reportBooking, setReportBooking] = React.useState<Booking | null>(null)
  const [reportOpen, setReportOpen] = React.useState(false)
  const [transitBooking, setTransitBooking] = React.useState<Booking | null>(null)
  const [celebrationBooking, setCelebrationBooking] = React.useState<Booking | null>(null)
  const [mediationBooking, setMediationBooking] = React.useState<Booking | null>(null)
  const [actioningId, setActioningId] = React.useState<string | null>(null)
  // Cancelamento é irreversível — exige confirmação explícita antes do PATCH
  const [cancelTarget, setCancelTarget] = React.useState<Booking | null>(null)

  const openReport = (b: Booking) => {
    setReportBooking(b)
    setReportOpen(true)
  }

  const openTransitHud = (b: Booking) => {
    setTransitBooking(b)
  }

  const openMediation = (b: Booking) => {
    setMediationBooking(b)
  }

  const [isOfflineFallback, setIsOfflineFallback] = React.useState(false)

  // Fetch all bookings once for tab counts + table data com fallback em IndexedDB
  const allQuery = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "bookings", "all"],
    queryFn: async () => {
      try {
        const res = await apiGet<{ items: Booking[]; total: number }>("/api/bookings", {
          role: "PROVIDER",
          page: 1,
          limit: 200,
        })
        if (res?.items) {
          cacheOfflineBookings(res.items).catch(() => {})
          setIsOfflineFallback(false)
        }
        return res
      } catch (err) {
        const cached = await getCachedOfflineBookings()
        if (cached.items.length > 0) {
          setIsOfflineFallback(true)
          return {
            items: cached.items as unknown as Booking[],
            total: cached.items.length,
          }
        }
        throw err
      }
    },
  })

  const allBookings = React.useMemo(() => allQuery.data?.items ?? [], [allQuery.data?.items])

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {
      PENDING: 0,
      CONFIRMED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      all: allBookings.length,
    }
    for (const b of allBookings) {
      c[b.status] = (c[b.status] ?? 0) + 1
    }
    return c
  }, [allBookings])

  // Filtragem combinada de tab e busca textual (Nielsen #7: Busca acelerada)
  const filtered = React.useMemo(() => {
    let list = tab === "all" ? allBookings : allBookings.filter((b) => b.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (b) =>
          b.client.name.toLowerCase().includes(q) ||
          b.service.title.toLowerCase().includes(q) ||
          b.address.toLowerCase().includes(q),
      )
    }
    return [...list].sort(
      (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
    )
  }, [allBookings, tab, search])

  const pageSize = 10
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Reset to page 1 on tab or search change
  const [prevTab, setPrevTab] = React.useState(tab)
  if (prevTab !== tab) {
    setPrevTab(tab)
    setPage(1)
  }

  const updateStatus = async (booking: Booking, next: BookingStatus, label: string) => {
    setActioningId(booking.id)
    try {
      await apiPatch(`/api/bookings/${booking.id}`, { status: next })
      triggerHaptic(next === "CANCELLED" ? "warning" : "success")
      toast.success(`Agendamento ${label.toLowerCase()}.`)
      qc.invalidateQueries({ queryKey: ["provider", "bookings"] })
      qc.invalidateQueries({ queryKey: ["provider", "dashboard"] })
    } catch (e) {
      const err = e as { message?: string }
      triggerHaptic("error")
      toast.error(err?.message ?? "Erro ao atualizar agendamento.")
    } finally {
      setActioningId(null)
    }
  }

  const requestCancel = (b: Booking) => {
    triggerHaptic("warning")
    setCancelTarget(b)
  }

  const openDetail = (b: Booking) => {
    setDetail(b)
    setDetailOpen(true)
  }

  const messageClient = (clientId: string) => {
    setDetailOpen(false)
    navigate("provider.messages", { peerId: clientId })
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Gestão de Agendamentos
          </h2>
          <p className="text-muted-foreground text-xs">
            Acompanhe a esteira de atendimento em Governador Valadares com navegação GPS e check-in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OfflineSimulationToggle />
          <Badge variant="outline" className="px-2.5 py-1 text-xs font-semibold">
            {counts.all} {counts.all === 1 ? "agendamento" : "agendamentos"} no total
          </Badge>
        </div>
      </div>

      {isOfflineFallback && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <Info className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>Modo Offline Ativo:</strong> Exibindo agendamentos salvos no dispositivo. Novas
            atualizações serão sincronizadas automaticamente assim que a conexão 4G/Wi-Fi for
            restabelecida.
          </span>
        </div>
      )}

      {/* Pipeline Strip / Cartões de Status (Nielsen #1: Visibilidade do estado do sistema) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection")
            setTab("PENDING")
          }}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]",
            tab === "PENDING"
              ? "border-amber-500/60 bg-amber-500/5 shadow-xs ring-1 ring-amber-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Pendentes</span>
            <Hourglass className="size-4 text-amber-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {counts.PENDING}
          </span>
          <span className="text-muted-foreground text-[10px]">Aguardando seu aceite</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection")
            setTab("CONFIRMED")
          }}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]",
            tab === "CONFIRMED"
              ? "border-emerald-500/60 bg-emerald-500/5 shadow-xs ring-1 ring-emerald-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Confirmados</span>
            <CalendarCheck className="size-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {counts.CONFIRMED}
          </span>
          <span className="text-muted-foreground text-[10px]">Prontos para execução</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection")
            setTab("IN_PROGRESS")
          }}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]",
            tab === "IN_PROGRESS"
              ? "border-sky-500/60 bg-sky-500/5 shadow-xs ring-1 ring-sky-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Em Andamento</span>
            <Radio className="size-4 animate-pulse text-sky-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
            {counts.IN_PROGRESS}
          </span>
          <span className="text-muted-foreground text-[10px]">Em trânsito ou no local</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection")
            setTab("COMPLETED")
          }}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]",
            tab === "COMPLETED"
              ? "border-teal-500/60 bg-teal-500/5 shadow-xs ring-1 ring-teal-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Concluídos</span>
            <CheckCircle2 className="size-4 text-teal-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-teal-600 dark:text-teal-400">
            {counts.COMPLETED}
          </span>
          <span className="text-muted-foreground text-[10px]">Serviços finalizados</span>
        </button>
      </div>

      {/* Toolbar: Tabs + Search Bar */}
      <div className="flex flex-col items-stretch justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={setTab} className="w-full sm:w-auto">
          <TabsList className="bg-muted/60 w-full justify-start overflow-x-auto p-1 sm:w-auto">
            {STATUS_TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="flex-1 gap-1.5 text-xs sm:flex-none"
              >
                {t.label}
                {counts[t.value] > 0 && (
                  <span className="bg-primary/15 text-primary ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
                    {counts[t.value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Campo de Busca Rápida */}
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground/70 absolute top-2.5 left-2.5 size-4" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, serviço..."
            className="h-9 rounded-xl pl-9 text-xs"
          />
        </div>
      </div>

      <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["provider", "bookings"] })}>
        {allQuery.isLoading ? (
          <div className="grid gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-muted/20 h-16 animate-pulse rounded-2xl border" />
            ))}
          </div>
        ) : pageItems.length === 0 ? (
          counts.all > 0 ? (
            <div className="bg-muted/10 mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
              <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl shadow-xs">
                <CalendarCheck className="size-6 opacity-75" />
              </div>
              <div>
                <p className="text-foreground text-sm font-semibold">
                  Nenhum agendamento encontrado
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {search.trim()
                    ? `Nenhum resultado corresponde à busca "${search}".`
                    : `Nenhum agendamento com status "${STATUS_TABS.find((t) => t.value === tab)?.label}".`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {search.trim() && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSearch("")}
                    className="h-8 text-xs"
                  >
                    Limpar busca
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    setTab("all")
                  }}
                  className="text-muted-foreground h-8 text-xs"
                >
                  Ver todos ({counts.all})
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-muted/10 mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-dashed p-10 text-center">
              <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
                <Sparkles className="size-7" />
              </div>
              <div className="space-y-1.5">
                <p className="text-foreground text-base font-semibold">
                  Seus agendamentos aparecerão aqui
                </p>
                <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
                  Quando clientes em Governador Valadares contratarem seus serviços pela vitrine,
                  você receberá notificações em tempo real para confirmar e atender.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("provider.expediente")}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Clock className="size-3.5" />
                  Configurar expediente
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("provider.services")}
                  className="h-8 gap-1.5 text-xs"
                >
                  Gerenciar catálogo de serviços
                </Button>
              </div>
            </div>
          )
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="bg-card hidden overflow-hidden rounded-2xl border shadow-xs md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 h-11 border-b">
                    <TableHead className="text-muted-foreground pl-4 text-[11px] font-semibold tracking-wider uppercase">
                      Cliente & Local
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Serviço Solicitado
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Data Agendada
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Status
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Pagamento
                    </TableHead>
                    <TableHead className="text-muted-foreground pr-4 text-right text-[11px] font-semibold tracking-wider uppercase">
                      Valor Líquido
                    </TableHead>
                    <TableHead className="w-12 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((b) => (
                    <TableRow
                      key={b.id}
                      className="hover:bg-muted/30 h-16 border-b transition-colors last:border-b-0"
                    >
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9 shrink-0 border shadow-xs">
                            {b.client.avatarUrl ? (
                              <AvatarImage src={b.client.avatarUrl} alt={b.client.name} />
                            ) : null}
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                              {initials(b.client.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openDetail(b)}
                              className="text-foreground block truncate text-left text-sm font-semibold hover:underline"
                            >
                              {b.client.name}
                            </button>
                            <span className="text-muted-foreground flex max-w-[220px] items-center gap-1 truncate text-[11px]">
                              <MapPin className="text-muted-foreground/70 size-3 shrink-0" />
                              <span className="truncate">{b.address}</span>
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="max-w-[200px]">
                        <p className="text-foreground truncate text-sm font-medium">
                          {b.service.title}
                        </p>
                        {b.quantity > 1 && (
                          <p className="text-muted-foreground text-[11px]">{b.quantity} un.</p>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-foreground text-xs font-semibold tabular-nums">
                            {formatDate(b.scheduledAt)}
                          </span>
                          <span className="text-muted-foreground text-[11px] tabular-nums">
                            às {formatTime(b.scheduledAt)}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              PAY_BADGE_STYLES[b.paymentStatus],
                            )}
                          >
                            {PAYMENT_STATUS_LABELS[b.paymentStatus]}
                          </Badge>
                          <span className="text-muted-foreground pl-0.5 text-[10px]">
                            {PAYMENT_METHOD_LABELS[b.paymentMethod]}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="text-foreground pr-4 text-right text-sm font-bold tabular-nums">
                        {formatBRL(b.amount)}
                      </TableCell>

                      <TableCell className="pr-4">
                        <BookingActions
                          booking={b}
                          actioning={actioningId === b.id}
                          onDetail={() => openDetail(b)}
                          onMessage={() => messageClient(b.clientId)}
                          onConfirm={() => updateStatus(b, "CONFIRMED", "Confirmado")}
                          onStart={() => updateStatus(b, "IN_PROGRESS", "Iniciado")}
                          onCancel={() => requestCancel(b)}
                          onReport={() => openReport(b)}
                          onTransitHud={() => openTransitHud(b)}
                          onMediate={() => openMediation(b)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards View */}
            <div className="grid gap-3 md:hidden">
              {pageItems.map((b) => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  actioning={actioningId === b.id}
                  onDetail={() => openDetail(b)}
                  onMessage={() => messageClient(b.clientId)}
                  onConfirm={() => updateStatus(b, "CONFIRMED", "Confirmado")}
                  onStart={() => updateStatus(b, "IN_PROGRESS", "Iniciado")}
                  onCancel={() => requestCancel(b)}
                  onReport={() => openReport(b)}
                  onTransitHud={() => openTransitHud(b)}
                  onMediate={() => openMediation(b)}
                />
              ))}
            </div>
          </>
        )}
      </PullToRefresh>

      {/* Paginação */}
      {pageCount > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-disabled={page === 1}
                className={cn(page === 1 && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            <PaginationItem className="text-muted-foreground px-3 text-xs font-semibold tabular-nums">
              Página {page} de {pageCount}
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                aria-disabled={page === pageCount}
                className={cn(page === pageCount && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `${cancelTarget.service.title} com ${cancelTarget.client.name} em ${formatDate(cancelTarget.scheduledAt)} às ${formatTime(cancelTarget.scheduledAt)}. `
                : ""}
              O cliente será notificado e esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter agendamento</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => {
                const target = cancelTarget
                setCancelTarget(null)
                if (target) void updateStatus(target, "CANCELLED", "Cancelado")
              }}
            >
              Sim, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BookingDetailsDialog
        booking={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onMessage={messageClient}
        onReport={() => detail && openReport(detail)}
      />

      {reportBooking && (
        <ServiceDeliveryReportModal
          open={reportOpen}
          onOpenChange={setReportOpen}
          bookingId={reportBooking.id}
          serviceTitle={reportBooking.service.title}
          clientName={reportBooking.client.name}
          userRole="PROVIDER"
          initialBeforePhotos={reportBooking.beforePhotos || []}
          initialAfterPhotos={reportBooking.afterPhotos || []}
          initialNotes={reportBooking.completionNote || ""}
          isCompleted={reportBooking.status === "COMPLETED"}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["provider", "bookings"] })
            qc.invalidateQueries({ queryKey: ["provider", "wallet"] })
            setCelebrationBooking(reportBooking)
          }}
        />
      )}

      {transitBooking && (
        <ProviderTransitHud
          bookingId={transitBooking.id}
          clientName={transitBooking.client.name}
          clientAddress={transitBooking.address}
          destinationLat={transitBooking.lat}
          destinationLng={transitBooking.lng}
          serviceTitle={transitBooking.service.title}
          onClose={() => setTransitBooking(null)}
          onCheckinSuccess={() => {
            qc.invalidateQueries({ queryKey: ["provider", "bookings"] })
          }}
        />
      )}

      <ServiceCompletionCelebrationDialog
        open={Boolean(celebrationBooking)}
        onOpenChange={(open) => {
          if (!open) setCelebrationBooking(null)
        }}
        bookingTitle={celebrationBooking?.service?.title}
        amount={celebrationBooking?.amount}
        pointsAwarded={10}
        geofenceVerified={true}
        role="PROVIDER"
      />

      {mediationBooking && (
        <QuickMediationModal
          open={Boolean(mediationBooking)}
          onOpenChange={(open) => {
            if (!open) setMediationBooking(null)
          }}
          bookingId={mediationBooking.id}
          serviceTitle={mediationBooking.service.title}
          peerName={mediationBooking.client.name}
          userRole="PROVIDER"
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["provider", "bookings"] })
          }}
        />
      )}
    </div>
  )
}

export default ProviderBookings
