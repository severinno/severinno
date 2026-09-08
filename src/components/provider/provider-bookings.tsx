"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  MessageSquare,
  MoreVertical,
  Play,
  X,
  Info,
  Radio,
} from "lucide-react"

import { useLocationBroadcaster } from "@/hooks/use-location-broadcaster"
import { apiGet, apiPatch } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDate, formatDateTime, formatTime } from "@/lib/format"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
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
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  notes?: string | null
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
// Helpers
// ---------------------------------------------------------------------------

const BADGE_STYLES: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  IN_PROGRESS: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  CANCELLED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
}

const PAY_BADGE_STYLES: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REFUNDED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
}

function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const Icon =
    status === "CONFIRMED" || status === "COMPLETED"
      ? CheckCircle2
      : status === "PENDING"
        ? Clock
        : status === "IN_PROGRESS"
          ? Loader2
          : X
  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        BADGE_STYLES[status],
      )}
    >
      <Icon className="size-3" />
      {BOOKING_STATUS_LABELS[status]}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

function BookingDetailsDialog({
  booking,
  open,
  onOpenChange,
  onMessage,
}: {
  booking: Booking | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onMessage: (clientId: string) => void
}) {
  if (!booking) return null
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${booking.lat}&mlon=${booking.lng}#map=16/${booking.lat}/${booking.lng}`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Detalhes do agendamento</DialogTitle>
          <DialogDescription className="tabular-nums">
            {formatDateTime(booking.scheduledAt)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 border">
              {booking.client.avatarUrl ? (
                <AvatarImage src={booking.client.avatarUrl} alt={booking.client.name} />
              ) : null}
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {initials(booking.client.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-semibold">{booking.client.name}</p>
              <p className="text-muted-foreground text-xs">Cliente</p>
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Serviço</span>
              <span className="font-medium">{booking.service.title}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={booking.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pagamento</span>
              <div className="flex items-center gap-1.5">
                <Badge
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    PAY_BADGE_STYLES[booking.paymentStatus],
                  )}
                >
                  {PAYMENT_STATUS_LABELS[booking.paymentStatus]}
                </Badge>
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <CreditCard className="size-3" />
                  {PAYMENT_METHOD_LABELS[booking.paymentMethod]}
                </span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor</span>
              <span className="text-primary font-semibold tabular-nums">
                {formatBRL(booking.amount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data</span>
              <span className="font-medium tabular-nums">
                {formatDate(booking.scheduledAt)} às {formatTime(booking.scheduledAt)}
              </span>
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="text-primary mt-0.5 size-4 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs">Endereço</p>
                <p className="font-medium">{booking.address}</p>
                <p className="text-muted-foreground text-xs">CEP: {booking.cep}</p>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                >
                  <MapPin className="size-3" /> Abrir no mapa
                </a>
              </div>
            </div>
          </div>

          {booking.notes && (
            <div className="grid gap-1 rounded-lg border p-3 text-sm">
              <p className="text-muted-foreground text-xs">Observações do cliente</p>
              <p className="text-foreground">{booking.notes}</p>
            </div>
          )}

          {booking.status === "CONFIRMED" && (
            <p className="text-muted-foreground text-xs">
              Apenas o cliente pode concluir o agendamento após a execução do serviço.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onMessage(booking.clientId)} className="gap-1.5">
            <MessageSquare className="size-4" /> Enviar mensagem
          </Button>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderBookings() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const [tab, setTab] = React.useState<string>("PENDING")
  const [page, setPage] = React.useState(1)
  const [detail, setDetail] = React.useState<Booking | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [actioningId, setActioningId] = React.useState<string | null>(null)

  // Fetch all bookings once for tab counts + table data
  const allQuery = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "bookings", "all"],
    queryFn: async () => apiGet("/api/bookings", { role: "PROVIDER", page: 1, limit: 200 }),
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

  const filtered = React.useMemo(() => {
    const list = tab === "all" ? allBookings : allBookings.filter((b) => b.status === tab)
    return [...list].sort(
      (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
    )
  }, [allBookings, tab])

  const pageSize = 10
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Reset to page 1 on tab change (adjust state during render)
  const [prevTab, setPrevTab] = React.useState(tab)
  if (prevTab !== tab) {
    setPrevTab(tab)
    setPage(1)
  }

  const updateStatus = async (booking: Booking, next: BookingStatus, label: string) => {
    setActioningId(booking.id)
    try {
      await apiPatch(`/api/bookings/${booking.id}`, { status: next })
      toast.success(`Agendamento ${label.toLowerCase()}.`)
      qc.invalidateQueries({ queryKey: ["provider", "bookings"] })
      qc.invalidateQueries({ queryKey: ["provider", "dashboard"] })
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao atualizar agendamento.")
    } finally {
      setActioningId(null)
    }
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
    <div className="grid gap-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full overflow-x-auto sm:w-auto">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-1 gap-1.5 sm:flex-none">
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

      {allQuery.isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/30 h-14 animate-pulse rounded-xl border" />
          ))}
        </div>
      ) : pageItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
            <CalendarCheck className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">Nenhum agendamento aqui</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Quando um cliente agendar, ele aparecerá nesta lista.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 h-11">
                  <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Cliente
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Serviço
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Agendado para
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Status
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Pagamento
                  </TableHead>
                  <TableHead className="text-muted-foreground text-right text-xs font-semibold tracking-wide uppercase">
                    Valor
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((b) => (
                  <TableRow key={b.id} className="hover:bg-muted/30 h-14 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-8 border">
                          {b.client.avatarUrl ? (
                            <AvatarImage src={b.client.avatarUrl} alt={b.client.name} />
                          ) : null}
                          <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                            {initials(b.client.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm font-medium">{b.client.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {b.service.title}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium tabular-nums">
                          {formatDate(b.scheduledAt)}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          às {formatTime(b.scheduledAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={b.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          className={cn(
                            "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            PAY_BADGE_STYLES[b.paymentStatus],
                          )}
                        >
                          {PAYMENT_STATUS_LABELS[b.paymentStatus]}
                        </Badge>
                        <span className="text-muted-foreground text-[10px]">
                          {PAYMENT_METHOD_LABELS[b.paymentMethod]}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {formatBRL(b.amount)}
                    </TableCell>
                    <TableCell>
                      <BookingActions
                        booking={b}
                        actioning={actioningId === b.id}
                        onDetail={() => openDetail(b)}
                        onMessage={() => messageClient(b.clientId)}
                        onConfirm={() => updateStatus(b, "CONFIRMED", "Confirmado")}
                        onStart={() => updateStatus(b, "IN_PROGRESS", "Iniciado")}
                        onCancel={() => updateStatus(b, "CANCELLED", "Cancelado")}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
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
                onCancel={() => updateStatus(b, "CANCELLED", "Cancelado")}
              />
            ))}
          </div>
        </>
      )}

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
            <PaginationItem className="px-3 text-sm tabular-nums">
              {page} / {pageCount}
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

      <BookingDetailsDialog
        booking={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onMessage={messageClient}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Booking actions dropdown
// ---------------------------------------------------------------------------

function BookingActions({
  booking,
  actioning,
  onDetail,
  onMessage,
  onConfirm,
  onStart,
  onCancel,
}: {
  booking: Booking
  actioning: boolean
  onDetail: () => void
  onMessage: () => void
  onConfirm: () => void
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {actioning && <Loader2 className="size-4 animate-spin" />}
      {booking.status === "PENDING" && (
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={actioning}
          className="h-8 gap-1.5 px-2.5 text-xs"
        >
          <CheckCircle2 className="size-3.5" /> Confirmar
        </Button>
      )}
      {booking.status === "CONFIRMED" && (
        <Button
          size="sm"
          variant="outline"
          onClick={onStart}
          disabled={actioning}
          className="h-8 gap-1.5 px-2.5 text-xs"
        >
          <Play className="size-3.5" /> Iniciar
        </Button>
      )}
      {booking.status === "IN_PROGRESS" && <LocationBroadcastButton bookingId={booking.id} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Mais ações">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onDetail}>
            <Info className="mr-2 size-4" /> Ver detalhes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMessage}>
            <MessageSquare className="mr-2 size-4" /> Enviar mensagem
          </DropdownMenuItem>
          {booking.status === "PENDING" && (
            <DropdownMenuItem onClick={onConfirm}>
              <CheckCircle2 className="mr-2 size-4" /> Confirmar
            </DropdownMenuItem>
          )}
          {booking.status === "CONFIRMED" && (
            <DropdownMenuItem onClick={onStart}>
              <Play className="mr-2 size-4" /> Iniciar atendimento
            </DropdownMenuItem>
          )}
          {(booking.status === "PENDING" ||
            booking.status === "CONFIRMED" ||
            booking.status === "IN_PROGRESS") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onCancel}
                className="text-destructive focus:text-destructive"
              >
                <X className="mr-2 size-4" /> Cancelar agendamento
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Location broadcast button
// ---------------------------------------------------------------------------

function LocationBroadcastButton({ bookingId }: { bookingId: string }) {
  const { isBroadcasting, toggle } = useLocationBroadcaster({ bookingId })
  return (
    <Button
      size="sm"
      variant={isBroadcasting ? "default" : "outline"}
      onClick={toggle}
      className={cn(
        "h-8 gap-1.5 px-2.5 text-xs transition-colors",
        isBroadcasting && "animate-pulse bg-emerald-600 text-white hover:bg-emerald-700",
      )}
    >
      <Radio className="size-3.5" />
      {isBroadcasting ? "GPS Ativo" : "Transmitir GPS"}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Mobile booking card
// ---------------------------------------------------------------------------

function BookingCard({
  booking,
  actioning,
  onDetail,
  onMessage,
  onConfirm,
  onStart,
  onCancel,
}: {
  booking: Booking
  actioning: boolean
  onDetail: () => void
  onMessage: () => void
  onConfirm: () => void
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-10 border">
          {booking.client.avatarUrl ? (
            <AvatarImage src={booking.client.avatarUrl} alt={booking.client.name} />
          ) : null}
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {initials(booking.client.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="leading-tight font-medium">{booking.client.name}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{booking.service.title}</p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="size-3" />
          {formatDate(booking.scheduledAt)} às {formatTime(booking.scheduledAt)}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="size-3" />
          <span className="truncate">{booking.address}</span>
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-semibold tabular-nums">
            {formatBRL(booking.amount)}
          </span>
          <Badge
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              PAY_BADGE_STYLES[booking.paymentStatus],
            )}
          >
            {PAYMENT_STATUS_LABELS[booking.paymentStatus]}
          </Badge>
        </div>
        <BookingActions
          booking={booking}
          actioning={actioning}
          onDetail={onDetail}
          onMessage={onMessage}
          onConfirm={onConfirm}
          onStart={onStart}
          onCancel={onCancel}
        />
      </div>
    </div>
  )
}

export default ProviderBookings
