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
import { EmptyState } from "@/components/shared/dashboard-shell"
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

function providerInitials(name?: string | null): string {
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

// ---------------------------------------------------------------------------
// BookingCardProps
// ---------------------------------------------------------------------------

type BookingCardProps = {
  booking: Booking
  onViewDetails: () => void
  onCancel: () => void
  onComplete: () => void
  onReview: () => void
  onMessage: () => void
  onViewProvider: () => void
  onRebook?: () => void
  onTrack?: () => void
  onPay?: () => void
  onViewReceipt?: () => void
  onOpenReport?: () => void
  onCarePlan?: () => void
  onMediate?: () => void
  onDispute?: () => void
  isCompleting: boolean
}

// ---------------------------------------------------------------------------
// BookingCard (List View — Ultra-compact, clean & minimalist)
// ---------------------------------------------------------------------------

function BookingCard({
  booking,
  onViewDetails,
  onCancel,
  onComplete,
  onReview,
  onMessage,
  onViewProvider,
  onRebook,
  onTrack,
  onPay,
  onViewReceipt,
  onOpenReport,
  onCarePlan,
  onMediate,
  onDispute,
  isCompleting,
}: BookingCardProps) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  const status = booking.status as BookingStatus
  const canCancel = status === "PENDING" || status === "CONFIRMED" || status === "IN_PROGRESS"
  const canComplete =
    status === "CONFIRMED" || status === "IN_PROGRESS" || booking.paymentStatus === "HELD"
  const canTrack = status === "IN_PROGRESS"
  // Never allow paying for cancelled or completed bookings
  const canPay = (status === "PENDING" || status === "CONFIRMED") && !!onPay
  const hasReview = (booking.reviews?.length ?? 0) > 0
  const canReview = status === "COMPLETED" && !hasReview

  // Avoid empty parentheses bug: only resolve if unit is defined and recognized
  const unitLabel =
    booking.service.unit && SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      ? SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      : null

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        {/* Main Card Header: Avatar, Provider, Status, Price */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* Round Avatar with click to provider modal */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-1 transition-transform outline-none hover:scale-105 focus-visible:ring-2"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/40 size-10 rounded-full border shadow-2xs sm:size-11">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials || "PR"}
                </AvatarFallback>
              </Avatar>
            </button>

            {/* Provider Info & Service Details */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-sm font-bold tracking-tight transition-colors hover:underline"
                >
                  {provider.name}
                </button>

                <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                  {BOOKING_STATUS_LABELS[status]}
                </StatusBadge>

                {hasReview && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    Avaliado
                  </span>
                )}
              </div>

              {/* Service Title — cleanly rendered without empty () */}
              <div className="text-foreground/90 mt-0.5 flex items-center gap-1.5 text-xs">
                <span className="truncate font-medium">{booking.service.title}</span>
                {unitLabel && (
                  <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase sm:text-[10px]">
                    {unitLabel}
                  </span>
                )}
              </div>

              {/* Date & Address */}
              <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                <span className="text-foreground/85 inline-flex items-center gap-1 font-medium tabular-nums">
                  <CalendarDays className="text-primary size-3" />
                  {formatDateTime(booking.scheduledAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="text-primary/70 size-3" />
                  <span className="max-w-[14rem] truncate sm:max-w-[18rem]">{booking.address}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: Financial & Payment Info + Menu */}
          <div className="border-border/40 flex items-center justify-between border-t pt-2 sm:flex-col sm:items-end sm:justify-center sm:border-0 sm:pt-0">
            <div className="flex items-baseline gap-1.5 sm:flex-col sm:items-end sm:gap-0.5">
              <span className="text-foreground text-sm font-bold tracking-tight tabular-nums sm:text-base">
                {formatBRL(booking.amount)}
              </span>
              {booking.quantity > 1 && (
                <span className="text-muted-foreground text-xs tabular-nums sm:text-[10px]">
                  {booking.quantity} × {unitLabel ?? booking.unit}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <StatusBadge
                tone={paymentTone(booking.paymentStatus as PaymentStatus)}
                icon={paymentIcon(booking.paymentStatus as PaymentStatus)}
                className="text-xs font-medium sm:text-[10px]"
              >
                {PAYMENT_METHOD_LABELS[booking.paymentMethod as PaymentMethod]} ·{" "}
                {PAYMENT_STATUS_LABELS[booking.paymentStatus as PaymentStatus]}
              </StatusBadge>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground size-7 shrink-0 rounded-lg sm:hidden"
                    aria-label="Mais opções"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={onViewDetails}>
                    <Eye className="mr-2 size-3.5" />
                    Ver detalhes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onViewProvider}>
                    <MapPin className="mr-2 size-3.5" />
                    Perfil do prestador
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onMessage}>
                    <MessageSquare className="mr-2 size-3.5" />
                    Mensagem
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Contextual Escrow / Service Design Reassurance Banner (Ultra-compact) */}
        {status === "COMPLETED" ? (
          <div className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-emerald-200/50 bg-emerald-50/40 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Serviço finalizado e inspecionado · Garantia 90D ativa</span>
            </div>
            <span className="hidden text-[10px] font-semibold text-emerald-700 sm:inline dark:text-emerald-300">
              Pagamento Liberado
            </span>
          </div>
        ) : status === "IN_PROGRESS" ? (
          <div className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-sky-200/50 bg-sky-50/40 px-2.5 py-1 text-[11px] font-medium text-sky-900 dark:border-sky-900/30 dark:bg-sky-950/20 dark:text-sky-200">
            <div className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-sky-500"></span>
              </span>
              <span>Prestador a caminho ou executando o serviço · Pagamento protegido</span>
            </div>
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              🛡️ Escrow Seguro
            </span>
          </div>
        ) : status === "CONFIRMED" ? (
          <div className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-emerald-200/40 bg-emerald-50/30 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/20 dark:bg-emerald-950/15 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Horário confirmado · {formatBRL(booking.amount)} protegido em custódia</span>
            </div>
            {booking.paymentStatus === "HELD" && (
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                Custódia Ativa
              </span>
            )}
          </div>
        ) : status === "CANCELLED" ? (
          <div className="border-border/40 bg-muted/20 text-muted-foreground mt-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium">
            <XCircle className="size-3.5 shrink-0 text-rose-500" />
            <span>Agendamento cancelado · Nenhuma cobrança pendente</span>
          </div>
        ) : null}

        {/* Quick Action Buttons Strip */}
        <div className="border-border/40 mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
          {/* Primary Action Button based on status */}
          {status === "COMPLETED" && canReview && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onReview()
              }}
              className="h-10 gap-1.5 rounded-xl bg-amber-500 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-amber-600 active:scale-95 sm:h-8"
            >
              <Star className="size-3.5 fill-white text-white" />
              Avaliar
            </Button>
          )}

          {canComplete && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onComplete()
              }}
              disabled={isCompleting}
              className="h-10 gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
            >
              {isCompleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              {booking.paymentStatus === "HELD" ? "Liberar Custódia" : "Liberar Pagamento"}
            </Button>
          )}

          {canTrack && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                onTrack?.()
              }}
              className="h-10 gap-1.5 rounded-xl border-sky-300 px-3 text-xs font-semibold text-sky-700 transition-all hover:bg-sky-50 active:scale-95 sm:h-8 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/30"
            >
              <Navigation className="size-3.5" />
              Rastrear
            </Button>
          )}

          {canPay && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onPay?.()
              }}
              className="h-10 gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
            >
              <CreditCard className="size-3.5" />
              Pagar PIX
            </Button>
          )}

          {/* Standard Tools */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onViewDetails()
            }}
            className="border-border/60 hover:bg-muted/60 h-10 gap-1.5 rounded-xl px-3 text-xs font-medium transition-all active:scale-95 sm:h-8"
          >
            <Eye className="size-3.5" />
            Detalhes
          </Button>

          {/* Rebook option on Cancelled */}
          {status === "CANCELLED" && onRebook && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onRebook()
              }}
              className="border-primary/50 text-primary hover:bg-primary/10 h-10 gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all active:scale-95 sm:h-8"
            >
              <Sparkles className="size-3.5" />
              Contratar Novamente
            </Button>
          )}

          {/* Report on In-Progress / Completed / Confirmed */}
          {onOpenReport &&
            (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "COMPLETED") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onOpenReport()
                }}
                className="border-border/60 hover:bg-muted/60 h-8.5 gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all active:scale-95 sm:h-8"
              >
                <ClipboardCheck className="size-3" />
                Laudo / Fotos
              </Button>
            )}

          {/* Receipt on Completed or Paid */}
          {(status === "COMPLETED" || booking.paymentStatus === "PAID") && onViewReceipt && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onViewReceipt()
              }}
              className="border-border/60 hover:bg-muted/60 h-8.5 gap-1.5 rounded-xl px-2.5 text-xs font-medium text-blue-700 transition-all active:scale-95 sm:h-8 dark:text-blue-400"
            >
              <FileText className="size-3" />
              Recibo
            </Button>
          )}

          {/* Care Plan recommendation on Completed */}
          {status === "COMPLETED" && onCarePlan && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onCarePlan()
              }}
              className="h-8.5 gap-1.5 rounded-xl border-emerald-300 px-2.5 text-xs font-medium text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 sm:h-8 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              <Sparkles className="size-3" />
              Plano Recorrente
            </Button>
          )}

          {/* In-app Message button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/60 size-8.5 shrink-0 rounded-xl p-0 transition-colors sm:size-8"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
          </Button>

          {/* Imprevisto / Mediação rápida */}
          {onMediate &&
            (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "PENDING") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onMediate()
                }}
                className="h-8.5 gap-1 rounded-xl border-amber-500/30 px-2 text-xs font-medium text-amber-700 transition-all hover:bg-amber-50 active:scale-95 sm:h-8 dark:border-amber-700/40 dark:text-amber-400 dark:hover:bg-amber-950/20"
                title="Ajuste de horário ou reagendamento amigável"
              >
                <HelpCircle className="size-3 text-amber-500" />
                Imprevisto
              </Button>
            )}

          {/* Contestar / Disputar Escrow */}
          {onDispute && booking.paymentStatus === "HELD" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onDispute()
              }}
              className="h-8.5 gap-1 rounded-xl border-red-500/30 px-2 text-xs font-medium text-red-700 transition-all hover:bg-red-50 active:scale-95 sm:h-8 dark:border-red-700/40 dark:text-red-400 dark:hover:bg-red-950/20"
              title="Contestar serviço e congelar custódia com evidências"
            >
              <ShieldAlert className="size-3 text-red-500" />
              Contestar
            </Button>
          )}

          {/* Cancel button if applicable */}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onCancel()
              }}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto h-8.5 gap-1.5 rounded-xl px-2 text-xs font-medium transition-all active:scale-95 sm:h-8"
            >
              <XCircle className="size-3" />
              Cancelar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// BookingGridCard (Grid View — Modern Bento micro-card)
// ---------------------------------------------------------------------------

function BookingGridCard({
  booking,
  onViewDetails,
  onCancel,
  onComplete,
  onReview,
  onMessage,
  onViewProvider,
  onRebook,
  onTrack,
  onPay,
  onViewReceipt,
  onOpenReport,
  onCarePlan,
  onMediate,
  onDispute,
  isCompleting,
}: BookingCardProps) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)
  const status = booking.status as BookingStatus
  const canCancel = status === "PENDING" || status === "CONFIRMED" || status === "IN_PROGRESS"
  const canComplete =
    status === "CONFIRMED" || status === "IN_PROGRESS" || booking.paymentStatus === "HELD"
  const canTrack = status === "IN_PROGRESS"
  const canPay = (status === "PENDING" || status === "CONFIRMED") && !!onPay
  const hasReview = (booking.reviews?.length ?? 0) > 0
  const canReview = status === "COMPLETED" && !hasReview

  const unitLabel =
    booking.service.unit && SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      ? SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      : null

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 flex flex-col justify-between rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="flex h-full flex-col justify-between p-3.5">
        <div className="space-y-2.5">
          {/* Top header: Avatar + Provider info + Price */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  onViewProvider()
                }}
                className="shrink-0 rounded-full transition-transform outline-none hover:scale-105"
                aria-label={`Ver perfil de ${provider.name}`}
              >
                <Avatar className="border-border/40 size-10 rounded-full border shadow-2xs">
                  {provider.avatarUrl ? (
                    <AvatarImage
                      src={provider.avatarUrl}
                      alt={provider.name}
                      className="rounded-full object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                    {initials || "PR"}
                  </AvatarFallback>
                </Avatar>
              </button>

              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary block truncate text-left text-sm font-bold tracking-tight"
                >
                  {provider.name}
                </button>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                    {BOOKING_STATUS_LABELS[status]}
                  </StatusBadge>
                  {hasReview && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300">
                      <Star className="size-3 fill-amber-400 text-amber-400" />
                      Avaliado
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-foreground text-sm font-bold tabular-nums sm:text-base">
                {formatBRL(booking.amount)}
              </p>
              <StatusBadge
                tone={paymentTone(booking.paymentStatus as PaymentStatus)}
                icon={paymentIcon(booking.paymentStatus as PaymentStatus)}
                className="text-xs font-medium sm:text-[9px]"
              >
                {PAYMENT_STATUS_LABELS[booking.paymentStatus as PaymentStatus]}
              </StatusBadge>
            </div>
          </div>

          {/* Service Title */}
          <div className="border-border/40 border-t pt-2">
            <div className="text-foreground/90 flex items-center gap-1.5 text-xs font-medium">
              <span className="truncate">{booking.service.title}</span>
              {unitLabel && (
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase sm:text-[10px]">
                  {unitLabel}
                </span>
              )}
            </div>

            {/* Date and Address */}
            <div className="text-muted-foreground mt-1.5 space-y-1 text-xs">
              <div className="text-foreground/80 inline-flex items-center gap-1.5 font-medium tabular-nums">
                <CalendarDays className="text-primary size-3 shrink-0" />
                <span>{formatDateTime(booking.scheduledAt)}</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1.5">
                <MapPin className="text-primary/70 size-3 shrink-0" />
                <span className="truncate">{booking.address}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-border/40 mt-3 flex items-center justify-between gap-1.5 border-t pt-2.5">
          <div className="flex flex-1 items-center gap-1.5">
            {status === "COMPLETED" && canReview ? (
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onReview()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl bg-amber-500 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-amber-600 active:scale-95 sm:h-8"
              >
                <Star className="size-3.5 fill-white text-white" />
                Avaliar
              </Button>
            ) : canComplete ? (
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onComplete()
                }}
                disabled={isCompleting}
                className="h-10 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
              >
                {isCompleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="size-3.5" />
                )}
                {booking.paymentStatus === "HELD" ? "Liberar Custódia" : "Liberar"}
              </Button>
            ) : canTrack ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("selection")
                  onTrack?.()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl border-sky-300 text-xs font-semibold text-sky-700 transition-all hover:bg-sky-50 active:scale-95 sm:h-8 dark:border-sky-800 dark:text-sky-300"
              >
                <Navigation className="size-3.5" />
                Rastrear
              </Button>
            ) : canPay ? (
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onPay?.()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
              >
                <CreditCard className="size-3.5" />
                Pagar PIX
              </Button>
            ) : status === "CANCELLED" && onRebook ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onRebook()
                }}
                className="border-primary/50 text-primary hover:bg-primary/10 h-10 flex-1 gap-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95 sm:h-8"
              >
                <Sparkles className="size-3.5" />
                Contratar Novamente
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onViewDetails()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-8"
              >
                <Eye className="size-3.5" />
                Detalhes
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="text-muted-foreground hover:text-foreground size-10 shrink-0 rounded-xl transition-all active:scale-95 sm:size-8"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-8.5 shrink-0 rounded-xl transition-all active:scale-95 sm:size-8"
                aria-label="Mais opções"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onViewDetails}>
                <Eye className="mr-2 size-3.5" />
                Ver detalhes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onViewProvider}>
                <MapPin className="mr-2 size-3.5" />
                Perfil do prestador
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onMessage}>
                <MessageSquare className="mr-2 size-3.5" />
                Mensagem
              </DropdownMenuItem>
              {onMediate &&
                (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "PENDING") && (
                  <DropdownMenuItem onSelect={onMediate}>
                    <HelpCircle className="mr-2 size-3.5 text-amber-500" />
                    Imprevisto / Atraso
                  </DropdownMenuItem>
                )}
              {onDispute && booking.paymentStatus === "HELD" && (
                <DropdownMenuItem onSelect={onDispute}>
                  <ShieldAlert className="mr-2 size-3.5 text-red-500" />
                  Contestar Escrow (Fotos)
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {canTrack && (
                <DropdownMenuItem onSelect={onTrack}>
                  <Navigation className="mr-2 size-3.5 text-sky-600" />
                  Rastrear ao vivo
                </DropdownMenuItem>
              )}
              {canPay && (
                <DropdownMenuItem onSelect={onPay}>
                  <QrCode className="mr-2 size-3.5 text-emerald-600" />
                  Pagar PIX
                </DropdownMenuItem>
              )}
              {canComplete && (
                <DropdownMenuItem onSelect={onComplete} disabled={isCompleting}>
                  <ShieldCheck className="mr-2 size-3.5 text-emerald-600" />
                  Liberar custódia
                </DropdownMenuItem>
              )}
              {canReview && (
                <DropdownMenuItem onSelect={onReview}>
                  <Star className="mr-2 size-3.5 text-amber-500" />
                  Avaliar serviço
                </DropdownMenuItem>
              )}
              {onOpenReport && (
                <DropdownMenuItem onSelect={onOpenReport}>
                  <ClipboardCheck className="mr-2 size-3.5 text-emerald-600" />
                  Laudo & Checklist
                </DropdownMenuItem>
              )}
              {onCarePlan && (
                <DropdownMenuItem onSelect={onCarePlan}>
                  <Sparkles className="mr-2 size-3.5 text-emerald-600" />
                  Plano Recorrente (-15%)
                </DropdownMenuItem>
              )}
              {(status === "COMPLETED" || booking.paymentStatus === "PAID") && onViewReceipt && (
                <DropdownMenuItem onSelect={onViewReceipt}>
                  <FileText className="mr-2 size-3.5 text-blue-600" />
                  Ver recibo
                </DropdownMenuItem>
              )}
              {status === "CANCELLED" && onRebook && (
                <DropdownMenuItem onSelect={onRebook}>
                  <Sparkles className="text-primary mr-2 size-3.5" />
                  Contratar novamente
                </DropdownMenuItem>
              )}
              {canCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onCancel}>
                    <XCircle className="mr-2 size-3.5" />
                    Cancelar agendamento
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            {b.quantity > 1 ? (
              <Row
                label="Quantidade"
                value={`${b.quantity} × ${SERVICE_UNIT_SHORT[b.unit] ?? b.unit}`}
              />
            ) : null}
            {b.notes ? <Row label="Observações" value={b.notes} /> : null}

            {/* Flow transparency — "what happens now" timeline */}
            <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
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
