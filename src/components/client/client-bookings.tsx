"use client"

/**
 * ClientBookings — Clean, minimalist in-panel booking management.
 *
 * Allows clients to view, manage, track, pay and inspect all their service
 * bookings with full Escrow protection, without ever leaving the dashboard.
 *
 * Capabilities:
 *  - Modern Hero Banner with platform guarantee and quick search
 *  - Segmented status tabs with live counts (Todos, Pendentes, Confirmados, Em andamento, Concluídos, Cancelados)
 *  - Quick in-list search by provider or service title
 *  - Service Design optimized cards:
 *    - Strict round avatars (rounded-full)
 *    - Contextual Escrow transparency banners (custody held, released, refunded)
 *    - Fixed empty parentheses bug on service unit
 *    - Fixed bug showing "Pagar PIX" on cancelled bookings
 *    - Smart action buttons: Avaliar, Recibo, Laudo/Fotos, Rastrear, Liberar Custódia, Contratar Novamente
 *    - Zero external WhatsApp leaks: strictly platform-secured messaging
 *  - Full modal integrations: PixCheckout, LiveTracking, ReceiptModal,
 *    ServiceDeliveryReportModal, CarePlanModal, ReviewDialog, BookingDetailsDialog
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Eye,
  FileText,
  LayoutGrid,
  LayoutList,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Navigation,
  QrCode,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  HelpCircle,
  X,
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
import { triggerHaptic } from "@/lib/haptics"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
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
import { EmptyState } from "@/components/shared/shell"
import { ReviewDialog } from "@/components/client/review-dialog"
import { BookingTimeline } from "@/components/shared/flow-timeline"
import { PixCheckout } from "@/components/shared/pix-checkout"
import { LiveTracking } from "@/components/shared/live-tracking"
import { ReceiptModal } from "@/components/shared/receipt-modal"
import { ServiceDeliveryReportModal } from "@/components/shared/service-delivery-report-modal"
import { ServiceCompletionCelebrationDialog } from "@/components/shared/service-completion-celebration-dialog"
import { QuickMediationModal } from "@/components/shared/quick-mediation-modal"
import { EscrowDisputeModal } from "@/components/shared/escrow-dispute-modal"
import { CarePlanModal } from "@/components/shared/care-plan-modal"
import { BookingDetailsDialog } from "@/components/client/booking-details-dialog"
import { BookingGridCard } from "@/components/client/booking-grid-card"
import { BookingCard, type BookingCardProps } from "@/components/client/booking-list-card"
export { BookingCard, type BookingCardProps }
import { PullToRefresh } from "@/components/shared/pull-to-refresh"
import { SafeImage } from "@/components/shared/safe-image"
import {
  StatusBadge,
  bookingIcon,
  bookingTone,
  paymentIcon,
  paymentTone,
} from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Booking = {
  id: string
  status: BookingStatus
  scheduledAt: string
  amount: number
  quantity: number
  unit: ServiceUnit
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  address: string
  cep: string
  lat?: number | null
  lng?: number | null
  notes?: string | null
  beforePhotos?: string[] | null
  afterPhotos?: string[] | null
  completionNote?: string | null
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

const TABS: Array<{ key: string; label: string; icon: React.ElementType }> = [
  { key: "ALL", label: "Todos", icon: LayoutGrid },
  { key: "PENDING", label: "Pendentes", icon: CalendarDays },
  { key: "CONFIRMED", label: "Confirmados", icon: CheckCircle2 },
  { key: "IN_PROGRESS", label: "Em andamento", icon: Navigation },
  { key: "COMPLETED", label: "Concluídos", icon: Sparkles },
  { key: "CANCELLED", label: "Cancelados", icon: XCircle },
]

const PAGE_SIZE = 8

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function providerInitials(name?: string | null): string {
  if (!name) return "PR"
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
  const openBooking = useUIStore((s) => s.openBooking)

  const [tab, setTab] = React.useState("ALL")
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [filterText, setFilterText] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [detailsId, setDetailsId] = React.useState<string | null>(null)
  const [reviewBooking, setReviewBooking] = React.useState<Booking | null>(null)
  const [cancelBooking, setCancelBooking] = React.useState<Booking | null>(null)
  const [pixBooking, setPixBooking] = React.useState<Booking | null>(null)
  const [trackingBooking, setTrackingBooking] = React.useState<Booking | null>(null)
  const [receiptBookingId, setReceiptBookingId] = React.useState<string | null>(null)
  const [reportBooking, setReportBooking] = React.useState<Booking | null>(null)
  const [carePlanBooking, setCarePlanBooking] = React.useState<Booking | null>(null)
  const [escrowReleaseBooking, setEscrowReleaseBooking] = React.useState<Booking | null>(null)
  const [celebrationBooking, setCelebrationBooking] = React.useState<Booking | null>(null)
  const [mediationBooking, setMediationBooking] = React.useState<Booking | null>(null)
  const [disputeBooking, setDisputeBooking] = React.useState<Booking | null>(null)

  // Reset page when tab or search filter changes
  React.useEffect(() => {
    setPage(1)
  }, [tab, filterText])

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

  // Filtered list by status and search text
  const visible = React.useMemo(() => {
    let filtered = tab === "ALL" ? allBookings : allBookings.filter((b) => b.status === tab)

    if (filterText.trim()) {
      const q = filterText.toLowerCase().trim()
      filtered = filtered.filter(
        (b) =>
          b.provider.name.toLowerCase().includes(q) ||
          b.service.title.toLowerCase().includes(q) ||
          b.address.toLowerCase().includes(q),
      )
    }

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
  }, [allBookings, tab, filterText])

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
    onSuccess: (_, id) => {
      toast.success("Pagamento liberado e serviço concluído com sucesso!")
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      qc.invalidateQueries({ queryKey: ["loyalty"] })

      const target = allBookings.find((b) => b.id === id) || escrowReleaseBooking
      setEscrowReleaseBooking(null)
      if (target) {
        setCelebrationBooking(target)
      }
    },
    onError: (e: { message?: string }) => {
      toast.error(e?.message || "Não foi possível concluir o agendamento.")
    },
  })

  return (
    <div className="space-y-4">
      {/* Search & Hero Banner — Compact Bento Header */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-xs sm:p-5">
        <div className="bg-primary/10 pointer-events-none absolute -top-24 -right-24 size-80 rounded-full blur-3xl" />

        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
              <Sparkles className="size-3" />
              <span>Gestão de Serviços & Custódia Escrow</span>
            </div>
            <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              Agendamentos
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Acompanhe e gerencie seus serviços agendados com proteção de pagamento Severinno.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-9 gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <MapPin className="text-primary size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Prominent Search & View Mode Toolbar */}
      <div className="bg-card border-border/60 flex flex-wrap items-center gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
        {/* Prominent Search Input */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Filtrar por prestador ou serviço..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="border-border/50 bg-background/60 focus:bg-background h-9 pr-8 pl-9 text-xs"
          />
          {filterText ? (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
              title="Limpar filtro"
              aria-label="Limpar filtro"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* View Mode Toggle: Lista / Grade */}
        <div className="border-border/60 bg-muted/30 flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setViewMode("list")
            }}
            aria-label="Visualização em lista"
            title="Visualização em lista"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-all active:scale-95",
              viewMode === "list"
                ? "bg-card text-foreground ring-border/40 font-semibold shadow-xs ring-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutList className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setViewMode("grid")
            }}
            aria-label="Visualização em grade"
            title="Visualização em grade"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-all active:scale-95",
              viewMode === "grid"
                ? "bg-card text-foreground ring-border/40 font-semibold shadow-xs ring-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Status Segmented Rail */}
      <div className="-mx-1 flex scrollbar-none gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const count = counts[t.key] ?? 0
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setTab(t.key)
              }}
              className={cn(
                "flex h-8.5 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-all active:scale-95",
                active
                  ? "bg-primary text-primary-foreground ring-primary/20 font-semibold shadow-xs ring-2"
                  : "border-border/60 bg-card hover:bg-muted/70 text-muted-foreground hover:text-foreground border",
              )}
            >
              <Icon
                className={cn(
                  "size-3.5",
                  active ? "text-primary-foreground" : "text-muted-foreground",
                )}
              />
              <span>{t.label}</span>
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Results Counter & Escrow Reassurance */}
      <div className="text-muted-foreground flex flex-col justify-between gap-2 px-1 text-xs sm:flex-row sm:items-center">
        <div>
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="text-primary size-3.5 animate-spin" />
              Carregando agendamentos...
            </span>
          ) : total === 0 ? (
            <span>Nenhum agendamento encontrado nesta categoria.</span>
          ) : (
            <span>
              Mostrando{" "}
              <strong className="text-foreground font-semibold">{pageItems.length}</strong> de{" "}
              <strong className="text-foreground font-semibold">{total}</strong>{" "}
              {total === 1 ? "agendamento" : "agendamentos"}.
            </span>
          )}
        </div>

        <div className="hidden items-center gap-1.5 font-medium text-emerald-700 sm:flex dark:text-emerald-400">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          <span>🛡️ Pagamento Seguro Escrow · Garantia 90D</span>
        </div>
      </div>

      {/* Content */}
      <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["bookings"] })}>
        {isLoading ? (
          <div className="grid gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="border-border/60 rounded-xl p-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="bg-muted size-10 animate-pulse rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="bg-muted h-3.5 w-40 rounded" />
                    <div className="bg-muted h-2.5 w-28 rounded" />
                  </div>
                  <div className="bg-muted h-5 w-16 rounded" />
                </div>
              </Card>
            ))}
          </div>
        ) : pageItems.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={
              tab === "ALL" ? "Nenhum agendamento ainda" : "Nenhum agendamento com este status"
            }
            description={
              tab === "ALL"
                ? "Você ainda não agendou nenhum serviço. Explore prestadores verificados e agende seu primeiro serviço com segurança."
                : "Não há agendamentos com este status no momento. Tente outra categoria ou faça uma nova busca."
            }
            action={
              <Button
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.providers")
                }}
                className="mt-2 gap-2 rounded-xl"
              >
                <MapPin className="size-4" />
                Buscar prestadores
              </Button>
            }
          />
        ) : viewMode === "list" ? (
          <div className="grid gap-2.5">
            {pageItems.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                onViewDetails={() => setDetailsId(b.id)}
                onCancel={() => setCancelBooking(b)}
                onComplete={() => setEscrowReleaseBooking(b)}
                onReview={() => setReviewBooking(b)}
                onMessage={() =>
                  navigate("client.messages", {
                    with: b.provider.id,
                    peerId: b.provider.id,
                    providerId: b.provider.id,
                  })
                }
                onViewProvider={() => openProvider(b.provider.id)}
                onRebook={() => openBooking({ providerId: b.provider.id, serviceId: b.service.id })}
                onTrack={() => setTrackingBooking(b)}
                onViewReceipt={() => setReceiptBookingId(b.id)}
                onOpenReport={() => setReportBooking(b)}
                onCarePlan={() => setCarePlanBooking(b)}
                onMediate={() => setMediationBooking(b)}
                onDispute={() => setDisputeBooking(b)}
                onPay={
                  (b.status === "PENDING" || b.status === "CONFIRMED") &&
                  b.paymentMethod === "PIX" &&
                  b.paymentStatus === "PENDING"
                    ? () => setPixBooking(b)
                    : undefined
                }
                isCompleting={completeMutation.isPending}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((b) => (
              <BookingGridCard
                key={b.id}
                booking={b}
                onViewDetails={() => setDetailsId(b.id)}
                onCancel={() => setCancelBooking(b)}
                onComplete={() => setEscrowReleaseBooking(b)}
                onReview={() => setReviewBooking(b)}
                onMessage={() =>
                  navigate("client.messages", {
                    with: b.provider.id,
                    peerId: b.provider.id,
                    providerId: b.provider.id,
                  })
                }
                onViewProvider={() => openProvider(b.provider.id)}
                onRebook={() => openBooking({ providerId: b.provider.id, serviceId: b.service.id })}
                onTrack={() => setTrackingBooking(b)}
                onViewReceipt={() => setReceiptBookingId(b.id)}
                onOpenReport={() => setReportBooking(b)}
                onCarePlan={() => setCarePlanBooking(b)}
                onMediate={() => setMediationBooking(b)}
                onDispute={() => setDisputeBooking(b)}
                onPay={
                  (b.status === "PENDING" || b.status === "CONFIRMED") &&
                  b.paymentMethod === "PIX" &&
                  b.paymentStatus === "PENDING"
                    ? () => setPixBooking(b)
                    : undefined
                }
                isCompleting={completeMutation.isPending}
              />
            ))}
          </div>
        )}
      </PullToRefresh>

      {/* Pagination */}
      {total > PAGE_SIZE ? (
        <div className="border-border/50 flex flex-col items-center justify-between gap-2 border-t pt-4 sm:flex-row">
          <p className="text-muted-foreground text-xs tabular-nums">
            Página <strong className="text-foreground">{page}</strong> de{" "}
            <strong className="text-foreground">{totalPages}</strong> · {total} agendamentos
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                triggerHaptic("selection")
                setPage((p) => Math.max(1, p - 1))
              }}
              className="h-9 gap-1 rounded-xl"
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <span className="text-muted-foreground px-2 text-xs font-semibold tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                triggerHaptic("selection")
                setPage((p) => p + 1)
              }}
              className="h-9 gap-1 rounded-xl"
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
                ? "Como o pagamento já foi confirmado, o valor será estornado integralmente para sua conta."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
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

      {/* PIX Checkout dialog */}
      <Dialog open={!!pixBooking} onOpenChange={(o) => !o && setPixBooking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-5 text-emerald-600" />
              Pagamento PIX Seguro
            </DialogTitle>
            <DialogDescription>
              Escaneie o QR code ou copie a chave Pix. Seu dinheiro fica protegido em custódia até a
              conclusão.
            </DialogDescription>
          </DialogHeader>
          {pixBooking && (
            <PixCheckout
              bookingId={pixBooking.id}
              amount={pixBooking.amount}
              onPaymentConfirmed={() => {
                qc.invalidateQueries({ queryKey: ["bookings"] })
                qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
                setTimeout(() => setPixBooking(null), 3000)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Live Tracking dialog */}
      <Dialog open={!!trackingBooking} onOpenChange={(o) => !o && setTrackingBooking(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Navigation className="size-5 text-blue-600" />
              Rastreamento ao Vivo
            </DialogTitle>
            <DialogDescription>
              Acompanhe a chegada de {trackingBooking?.provider.name} em tempo real.
            </DialogDescription>
          </DialogHeader>
          {trackingBooking && (
            <LiveTracking
              bookingId={trackingBooking.id}
              destinationLat={-19.92}
              destinationLng={-43.94}
              providerName={trackingBooking.provider.name}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Receipt Modal */}
      {receiptBookingId && (
        <ReceiptModal
          bookingId={receiptBookingId}
          open={!!receiptBookingId}
          onOpenChange={(o) => !o && setReceiptBookingId(null)}
        />
      )}

      {/* Service Delivery Report / Inspection Modal */}
      {reportBooking && (
        <ServiceDeliveryReportModal
          open={!!reportBooking}
          onOpenChange={(o) => !o && setReportBooking(null)}
          bookingId={reportBooking.id}
          serviceTitle={reportBooking.service.title}
          serviceCategory={reportBooking.service.category?.name}
          clientName="Você"
          providerName={reportBooking.provider.name}
          userRole="CLIENT"
          initialBeforePhotos={reportBooking.beforePhotos || []}
          initialAfterPhotos={reportBooking.afterPhotos || []}
          initialNotes={reportBooking.completionNote || ""}
          isCompleted={reportBooking.status === "COMPLETED"}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["bookings"] })
            qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
          }}
        />
      )}

      {/* Care Plan (Recurring Residential Subscription) Modal */}
      {carePlanBooking && (
        <CarePlanModal
          isOpen={!!carePlanBooking}
          onClose={() => setCarePlanBooking(null)}
          service={{
            id: carePlanBooking.service.id,
            title: carePlanBooking.service.title,
            basePrice: carePlanBooking.amount,
            providerId: carePlanBooking.provider.id,
            providerName: carePlanBooking.provider.name,
          }}
          defaultAddress={carePlanBooking.address}
          defaultCep={carePlanBooking.cep}
          defaultLat={carePlanBooking.lat ?? undefined}
          defaultLng={carePlanBooking.lng ?? undefined}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["bookings"] })
            qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
          }}
        />
      )}

      {/* Escrow Release Dialog (One-Click Custody Release with Before/After Photos) */}
      <Dialog
        open={!!escrowReleaseBooking}
        onOpenChange={(o) => !o && setEscrowReleaseBooking(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <ShieldCheck className="size-5" />
              </span>
              <DialogTitle className="text-base font-semibold">
                Liberar Pagamento em Custódia
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Garantia Severinno: Confirme que o serviço foi entregue com qualidade para liberar o
              pagamento da custódia.
            </DialogDescription>
          </DialogHeader>

          {escrowReleaseBooking && (
            <div className="space-y-4 pt-1">
              {/* Service & Provider Summary */}
              <div className="border-border/60 bg-muted/20 flex items-center gap-3 rounded-2xl border p-3.5">
                <Avatar className="border-border/40 size-12 rounded-full border shadow-xs">
                  {escrowReleaseBooking.provider.avatarUrl ? (
                    <AvatarImage
                      src={escrowReleaseBooking.provider.avatarUrl}
                      alt={escrowReleaseBooking.provider.name}
                      className="rounded-full object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                    {providerInitials(escrowReleaseBooking.provider.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-bold">
                    {escrowReleaseBooking.provider.name}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {escrowReleaseBooking.service.title}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatBRL(escrowReleaseBooking.amount)}
                  </span>
                  <p className="text-muted-foreground text-[10px]">Em custódia</p>
                </div>
              </div>

              {/* Before/After Photos (if present) */}
              {escrowReleaseBooking.beforePhotos?.length ||
              escrowReleaseBooking.afterPhotos?.length ? (
                <div className="border-border/60 bg-card space-y-2 rounded-2xl border p-3">
                  <p className="text-foreground text-xs font-semibold">
                    Fotos do Serviço Realizado
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {escrowReleaseBooking.beforePhotos?.[0] && (
                      <div className="border-border/40 bg-muted/40 relative aspect-video overflow-hidden rounded-xl border">
                        <SafeImage
                          src={escrowReleaseBooking.beforePhotos[0]}
                          alt="Foto antes"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white">
                          Antes
                        </span>
                      </div>
                    )}
                    {escrowReleaseBooking.afterPhotos?.[0] && (
                      <div className="border-border/40 bg-muted/40 relative aspect-video overflow-hidden rounded-xl border">
                        <SafeImage
                          src={escrowReleaseBooking.afterPhotos[0]}
                          alt="Foto depois"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
                          Depois
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Completion note if provided */}
              {escrowReleaseBooking.completionNote && (
                <div className="border-border/50 bg-muted/20 text-muted-foreground rounded-xl border p-2.5 text-xs">
                  <strong className="text-foreground">Nota do prestador: </strong>
                  {escrowReleaseBooking.completionNote}
                </div>
              )}

              {/* Security reassurance banner */}
              <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Ao confirmar, os <strong>{formatBRL(escrowReleaseBooking.amount)}</strong>{" "}
                  mantidos sob custódia protegida serão liberados na hora para o prestador.
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEscrowReleaseBooking(null)} className="h-9">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (escrowReleaseBooking) {
                  completeMutation.mutate(escrowReleaseBooking.id)
                }
              }}
              disabled={completeMutation.isPending}
              className="h-9 gap-1.5 bg-emerald-600 font-semibold text-white shadow-xs hover:bg-emerald-700"
            >
              {completeMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Confirmar e Liberar Pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServiceCompletionCelebrationDialog
        open={Boolean(celebrationBooking)}
        onOpenChange={(open) => {
          if (!open) {
            const finished = celebrationBooking
            setCelebrationBooking(null)
            if (finished) {
              setReviewBooking(finished)
            }
          }
        }}
        bookingTitle={celebrationBooking?.service?.title}
        amount={celebrationBooking?.amount}
        pointsAwarded={10}
        geofenceVerified={true}
        role="CLIENT"
      />

      {mediationBooking && (
        <QuickMediationModal
          open={Boolean(mediationBooking)}
          onOpenChange={(open) => {
            if (!open) setMediationBooking(null)
          }}
          bookingId={mediationBooking.id}
          serviceTitle={mediationBooking.service.title}
          peerName={mediationBooking.provider.name}
          userRole="CLIENT"
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["bookings"] })
          }}
        />
      )}

      {disputeBooking && (
        <EscrowDisputeModal
          open={Boolean(disputeBooking)}
          onOpenChange={(open) => {
            if (!open) setDisputeBooking(null)
          }}
          bookingId={disputeBooking.id}
          serviceTitle={disputeBooking.service.title}
          providerName={disputeBooking.provider.name}
          amount={Number(disputeBooking.amount)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["bookings"] })
          }}
        />
      )}
    </div>
  )
}
