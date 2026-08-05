"use client"

/**
 * ClientBookings — list of all bookings for the logged-in client.
 *
 * Polish (Nielsen + trust/transparency):
 *  - Page header with quick action (Buscar prestadores).
 *  - Status filter tabs with counts (Pendentes, Confirmados, Em andamento,
 *    Concluídos, Cancelados, Todos).
 *  - Card list (mobile-first) with: provider avatar+name, service title,
 *    prominent scheduled date/time, amount, status badge, payment badge.
 *  - Row actions (dropdown menu): Ver detalhes (opens dialog with
 *    BookingTimeline preserved), Cancelar, Marcar como concluído, Avaliar
 *    (opens ReviewDialog), Enviar mensagem, Ver prestador.
 *  - Inline quick actions (Detalhes / Concluir / Avaliar / Cancelar) for
 *    discoverability on mobile.
 *  - Pagination (client-side, 8/page).
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Navigation,
  Star,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiGet, apiPatch } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/shared/dashboard-shell"
import { ReviewDialog } from "@/components/client/review-dialog"
import { BookingTimeline } from "@/components/shared/flow-timeline"
import {
  PageHeader,
  StatusBadge,
  bookingIcon,
  bookingTone,
  paymentIcon,
  paymentTone,
} from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string
  status: BookingStatus
  scheduledAt: string
  amount: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  address: string
  cep: string
  notes?: string | null
  service: {
    id: string
    title: string
    basePrice: number
    unit: ServiceUnit
    category?: { id: string; name: string } | null
  }
  provider: {
    id: string
    name: string
    avatarUrl?: string | null
    whatsapp?: string | null
  }
  reviews?: Array<{
    id: string
    rating: number
    comment?: string | null
    createdAt: string
  }>
}

type BookingsResponse = {
  items: Booking[]
  total: number
  page: number
  limit: number
}

// ---------------------------------------------------------------------------
// Filter tabs (order: pending first, then progressing, then terminal, then all)
// ---------------------------------------------------------------------------

const TABS: Array<{ key: string; label: string }> = [
  { key: "PENDING", label: "Pendentes" },
  { key: "CONFIRMED", label: "Confirmados" },
  { key: "IN_PROGRESS", label: "Em andamento" },
  { key: "COMPLETED", label: "Concluídos" },
  { key: "CANCELLED", label: "Cancelados" },
  { key: "ALL", label: "Todos" },
]

const PAGE_SIZE = 8

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerInitials(name?: string | null): string {
  if (!name) return "P"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientBookings() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)

  const [tab, setTab] = React.useState("ALL")
  const [page, setPage] = React.useState(1)
  const [detailsId, setDetailsId] = React.useState<string | null>(null)
  const [reviewBooking, setReviewBooking] = React.useState<Booking | null>(null)
  const [cancelBooking, setCancelBooking] = React.useState<Booking | null>(null)

  // Reset page when tab changes
  React.useEffect(() => {
    setPage(1)
  }, [tab])

  // Fetch up to 4 pages of 50 (= 200 max) so we can compute accurate counts
  // per status and paginate client-side. Mirrors client-finance pattern.
  const queries = useQueries({
    queries: [1, 2, 3, 4].map((p) => ({
      queryKey: ["bookings", "CLIENT", "all", p],
      queryFn: () =>
        apiGet<BookingsResponse>("/api/bookings", {
          role: "CLIENT",
          page: p,
          limit: 50,
        }),
      staleTime: 30_000,
    })),
  })

  const allBookings = React.useMemo(() => {
    const merged: Booking[] = []
    for (const q of queries) {
      if (q.data?.items?.length) merged.push(...q.data.items)
    }
    return merged
  }, [queries])

  const isLoading = queries.some((q) => q.isLoading)

  // Counts per tab (based on all fetched data)
  const counts = React.useMemo(() => {
    const map: Record<string, number> = {
      ALL: allBookings.length,
      PENDING: 0,
      CONFIRMED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    }
    for (const b of allBookings) {
      if (map[b.status] != null) map[b.status]!++
    }
    return map
  }, [allBookings])

  // Filtered + paginated list
  const visible = React.useMemo(() => {
    const filtered = tab === "ALL" ? allBookings : allBookings.filter((b) => b.status === tab)
    // Sort: upcoming first (asc by date) for active statuses, recent first
    // (desc) for terminal statuses.
    const isActive = (s: BookingStatus) =>
      s === "PENDING" || s === "CONFIRMED" || s === "IN_PROGRESS"
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.scheduledAt).getTime()
      const tb = new Date(b.scheduledAt).getTime()
      const aActive = isActive(a.status)
      const bActive = isActive(b.status)
      if (aActive && bActive) return ta - tb
      if (!aActive && !bActive) return tb - ta
      return aActive ? -1 : 1
    })
  }, [allBookings, tab])

  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/bookings/${id}`, { status: "CANCELLED" }),
    onSuccess: () => {
      toast.success("Agendamento cancelado.")
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      setCancelBooking(null)
    },
    onError: (e: { message?: string }) => {
      toast.error(e?.message || "Não foi possível cancelar.")
    },
  })

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/bookings/${id}`, { status: "COMPLETED" }),
    onSuccess: () => {
      toast.success("Serviço marcado como concluído. Já pode avaliar!")
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
    },
    onError: (e: { message?: string }) => {
      toast.error(e?.message || "Não foi possível concluir o agendamento.")
    },
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agendamentos"
        subtitle="Acompanhe e gerencie seus serviços agendados."
        action={
          <Button variant="outline" onClick={() => navigate("vitrine")} className="h-10 gap-2">
            <MapPin className="size-4" />
            Buscar prestadores
          </Button>
        }
      />

      {/* Status tabs with counts */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-auto">
          {TABS.map((t) => {
            const count = counts[t.key] ?? 0
            const active = tab === t.key
            return (
              <TabsTrigger key={t.key} value={t.key} className="h-8 flex-shrink-0 gap-1.5">
                {t.label}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {/* Result count */}
      <p className="text-muted-foreground text-xs">
        {isLoading
          ? "Carregando…"
          : total === 0
            ? "Nenhum agendamento nesta categoria."
            : `Mostrando ${pageItems.length} de ${total} agendamento${total !== 1 ? "s" : ""}.`}
      </p>

      {/* Content */}
      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
          <Loader2 className="size-5 animate-spin" />
          Carregando agendamentos…
        </div>
      ) : pageItems.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={tab === "ALL" ? "Nenhum agendamento ainda" : "Nenhum agendamento com este status"}
          description={
            tab === "ALL"
              ? "Você ainda não agendou nenhum serviço. Explore prestadores verificados e agende seu primeiro serviço."
              : "Não há agendamentos com este status no momento. Tente outra categoria."
          }
          action={
            <Button onClick={() => navigate("vitrine")} className="mt-2 gap-2">
              <MapPin className="size-4" />
              Buscar prestadores
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {pageItems.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              onViewDetails={() => setDetailsId(b.id)}
              onCancel={() => setCancelBooking(b)}
              onComplete={() => completeMutation.mutate(b.id)}
              onReview={() => setReviewBooking(b)}
              onMessage={() => navigate("client.messages", { with: b.provider.id })}
              onViewProvider={() => openProvider(b.provider.id)}
              onTrack={() => window.open(`/tracking/${b.id}`, "_blank")}
              isCompleting={completeMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE ? (
        <div className="flex flex-col items-center justify-between gap-2 border-t pt-3 sm:flex-row">
          <p className="text-muted-foreground text-xs tabular-nums">
            Página {page} de {totalPages} · {total} agendamentos
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-9 gap-1"
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <span className="text-muted-foreground px-2 text-xs tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-9 gap-1"
            >
              Próxima
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Review dialog */}
      <ReviewDialog
        open={!!reviewBooking}
        onOpenChange={(o) => !o && setReviewBooking(null)}
        booking={reviewBooking}
      />

      {/* Cancel confirm */}
      <Dialog open={!!cancelBooking} onOpenChange={(o) => !o && setCancelBooking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar agendamento?</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita.{" "}
              {cancelBooking?.paymentStatus === "PAID"
                ? "Como o pagamento já foi confirmado, o valor será estornado."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelBooking(null)}
              disabled={cancelMutation.isPending}
            >
              Manter agendamento
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelBooking && cancelMutation.mutate(cancelBooking.id)}
              disabled={cancelMutation.isPending}
              className="gap-2"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              Sim, cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      <BookingDetailsDialog bookingId={detailsId} onOpenChange={(o) => !o && setDetailsId(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// BookingCard
// ---------------------------------------------------------------------------

function BookingCard({
  booking,
  onViewDetails,
  onCancel,
  onComplete,
  onReview,
  onMessage,
  onViewProvider,
  onTrack,
  isCompleting,
}: {
  booking: Booking
  onViewDetails: () => void
  onCancel: () => void
  onComplete: () => void
  onReview: () => void
  onMessage: () => void
  onViewProvider: () => void
  onTrack?: () => void
  isCompleting: boolean
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  const status = booking.status as BookingStatus
  const canCancel = status === "PENDING" || status === "CONFIRMED" || status === "IN_PROGRESS"
  const canComplete = status === "CONFIRMED" || status === "IN_PROGRESS"
  const canTrack = status === "IN_PROGRESS"
  const hasReview = (booking.reviews?.length ?? 0) > 0
  const canReview = status === "COMPLETED" && !hasReview

  return (
    <Card className="overflow-hidden rounded-xl shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="grid gap-3 py-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onViewProvider}
            className="focus-visible:ring-ring shrink-0 rounded-full outline-none focus-visible:ring-2"
            aria-label={`Ver perfil de ${provider.name}`}
          >
            <Avatar className="size-11 border">
              {provider.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name} />
              ) : null}
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {initials || "P"}
              </AvatarFallback>
            </Avatar>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onViewProvider}
                className="hover:text-primary truncate text-sm font-semibold focus-visible:underline"
              >
                {provider.name}
              </button>
              <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                {BOOKING_STATUS_LABELS[status]}
              </StatusBadge>
              {hasReview ? (
                <StatusBadge tone="amber" icon={Star}>
                  Avaliado
                </StatusBadge>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-sm">
              {booking.service.title}
              <span className="ml-1 text-xs">({SERVICE_UNIT_SHORT[booking.service.unit]})</span>
            </p>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-foreground/80 inline-flex items-center gap-1 font-medium tabular-nums">
                <CalendarDays className="text-primary size-3.5" />
                {formatDateTime(booking.scheduledAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                <span className="max-w-[14rem] truncate">{booking.address}</span>
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm font-semibold tabular-nums">{formatBRL(booking.amount)}</span>
            <StatusBadge
              tone={paymentTone(booking.paymentStatus as PaymentStatus)}
              icon={paymentIcon(booking.paymentStatus as PaymentStatus)}
              className="text-[10px]"
            >
              {PAYMENT_METHOD_LABELS[booking.paymentMethod as PaymentMethod]} ·{" "}
              {PAYMENT_STATUS_LABELS[booking.paymentStatus as PaymentStatus]}
            </StatusBadge>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Ações">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={onViewDetails}>
                <Eye className="size-4" />
                Ver detalhes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onViewProvider}>
                <MapPin className="size-4" />
                Ver prestador
              </DropdownMenuItem>
              {canTrack ? (
                <DropdownMenuItem onSelect={onTrack}>
                  <Navigation className="size-4 text-emerald-600" />
                  Rastrear ao vivo
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={onMessage}>
                <MessageSquare className="size-4" />
                Enviar mensagem
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {canComplete ? (
                <DropdownMenuItem onSelect={onComplete} disabled={isCompleting}>
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Marcar como concluído
                </DropdownMenuItem>
              ) : null}
              {canReview ? (
                <DropdownMenuItem onSelect={onReview}>
                  <Star className="size-4 text-amber-500" />
                  Avaliar serviço
                </DropdownMenuItem>
              ) : null}
              {canCancel ? (
                <DropdownMenuItem variant="destructive" onSelect={onCancel}>
                  <XCircle className="size-4" />
                  Cancelar agendamento
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>{" "}
        {/* Quick action buttons (visible on mobile too) */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onViewDetails} className="h-9 gap-1.5">
            <Eye className="size-4" />
            Detalhes
          </Button>
          {canTrack ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onTrack}
              className="h-9 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              <Navigation className="size-4" />
              Rastrear
            </Button>
          ) : null}
          {canComplete ? (
            <Button size="sm" onClick={onComplete} disabled={isCompleting} className="h-9 gap-1.5">
              {isCompleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Concluir
            </Button>
          ) : null}
          {canReview ? (
            <Button size="sm" onClick={onReview} className="h-9 gap-1.5">
              <Star className="size-4" />
              Avaliar
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive h-9 gap-1.5"
            >
              <XCircle className="size-4" />
              Cancelar
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// BookingDetailsDialog — fetches a single booking and shows full info
// ---------------------------------------------------------------------------

function BookingDetailsDialog({
  bookingId,
  onOpenChange,
}: {
  bookingId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const query = useQuery<{
    booking: Booking & { notes?: string | null }
  }>({
    queryKey: ["booking", bookingId],
    queryFn: () => apiGet(`/api/bookings/${bookingId}`),
    enabled: !!bookingId,
  })

  const b = query.data?.booking

  return (
    <Dialog open={!!bookingId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalhes do agendamento</DialogTitle>
          <DialogDescription>Informações completas sobre este serviço.</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        ) : !b ? (
          <p className="text-muted-foreground text-sm">Agendamento não encontrado.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <Row label="Prestador" value={b.provider.name} />
            <Row label="Serviço" value={b.service.title} />
            <Row
              label="Agendado para"
              value={<span className="tabular-nums">{formatDateTime(b.scheduledAt)}</span>}
            />
            <Row label="Endereço" value={b.address} />
            <Row label="CEP" value={<span className="tabular-nums">{b.cep}</span>} />
            <Row
              label="Status"
              value={
                <StatusBadge
                  tone={bookingTone(b.status as BookingStatus)}
                  icon={bookingIcon(b.status as BookingStatus)}
                >
                  {BOOKING_STATUS_LABELS[b.status as BookingStatus]}
                </StatusBadge>
              }
            />
            <Row
              label="Pagamento"
              value={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span>{PAYMENT_METHOD_LABELS[b.paymentMethod as PaymentMethod]}</span>
                  <span className="text-muted-foreground">·</span>
                  <StatusBadge
                    tone={paymentTone(b.paymentStatus as PaymentStatus)}
                    icon={paymentIcon(b.paymentStatus as PaymentStatus)}
                    className="text-[10px]"
                  >
                    {PAYMENT_STATUS_LABELS[b.paymentStatus as PaymentStatus]}
                  </StatusBadge>
                </span>
              }
            />
            <Row
              label="Valor"
              value={<span className="font-semibold tabular-nums">{formatBRL(b.amount)}</span>}
            />
            {b.notes ? <Row label="Observações" value={b.notes} /> : null}

            {/* Flow transparency — "what happens now" timeline */}
            <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
              <BookingTimeline status={b.status} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="col-span-2 text-sm break-words">{value}</span>
    </div>
  )
}
