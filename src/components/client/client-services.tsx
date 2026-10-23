"use client"

/**
 * ClientServices — "Serviços contratados" — historical and warranty view of services.
 *
 * Polish & Service Design:
 *  - Modern Hero Banner with subtle primary/card gradient & Warranty Badge.
 *  - Quick access actions: "Buscar prestadores" & "Ver agendamentos".
 *  - 90-Day Severinno Consumer Warranty & Protection Banner.
 *  - High-impact StatCards (Concluídos, Total Investido, Cancelados).
 *  - Status segmented pill tabs with real-time counters (Concluídos / Cancelados / Todos).
 *  - Real-time search filter and sorting options.
 *  - Redesigned Service Cards:
 *    - 100% round provider avatars (rounded-full).
 *    - Clickable provider name opening provider profile.
 *    - Safe unit formatting (eliminates empty `()` bugs).
 *    - Clear currency and payment method display.
 *    - Reputation Loop: If completed without review, prominent "Avaliar agora" CTA opening ReviewDialog!
 *    - Review quote card with golden stars if already reviewed.
 *    - Actions: "Contratar novamente", "Recibo" (ReceiptModal), "Mensagem" (client.messages — zero WhatsApp leak!).
 *  - Clean accessible pagination.
 */

import * as React from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutGrid,
  LayoutList,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  RotateCcw,
  Search,
  ShieldCheck,
  Star,
  Wallet,
  Wrench,
  X,
  XCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SERVICE_UNIT_SHORT,
  type BookingStatus,
  type PaymentMethod,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDate } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"
import { ReceiptModal } from "@/components/shared/receipt-modal"
import { ReviewDialog } from "@/components/client/review-dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { EmptyState, StatCard } from "@/components/shared/shell"
import { StatusBadge, bookingIcon, bookingTone } from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string
  status: BookingStatus
  scheduledAt: string
  amount: number
  paymentMethod: PaymentMethod
  address: string
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

const TABS: Array<{ key: string; label: string }> = [
  { key: "COMPLETED", label: "Concluídos" },
  { key: "CANCELLED", label: "Cancelados" },
  { key: "ALL", label: "Todos" },
]

const PAGE_SIZE = 6

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

export function ClientServices() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openBooking = useUIStore((s) => s.openBooking)

  const [tab, setTab] = React.useState("COMPLETED")
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [page, setPage] = React.useState(1)
  const [filterText, setFilterText] = React.useState("")
  const [sortBy, setSortBy] = React.useState<"recent" | "oldest" | "highest">("recent")

  // Modals state
  const [selectedReceiptBookingId, setSelectedReceiptBookingId] = React.useState<string | null>(
    null,
  )
  const [reviewingBooking, setReviewingBooking] = React.useState<Booking | null>(null)

  // Reset to page 1 on tab or filter change
  const [prevTab, setPrevTab] = React.useState(tab)
  if (prevTab !== tab) {
    setPrevTab(tab)
    setPage(1)
  }

  // Fetch completed + cancelled in parallel so we can show counts + all items
  const queries = useQueries({
    queries: [
      {
        queryKey: ["bookings", "CLIENT", "services", "COMPLETED"],
        queryFn: () =>
          apiGet<BookingsResponse>("/api/bookings", {
            role: "CLIENT",
            status: "COMPLETED",
            page: 1,
            limit: 50,
          }),
        staleTime: 30_000,
      },
      {
        queryKey: ["bookings", "CLIENT", "services", "CANCELLED"],
        queryFn: () =>
          apiGet<BookingsResponse>("/api/bookings", {
            role: "CLIENT",
            status: "CANCELLED",
            page: 1,
            limit: 50,
          }),
        staleTime: 30_000,
      },
    ],
  })

  const completedItems = queries[0]?.data?.items
  const cancelledItems = queries[1]?.data?.items
  const completed = React.useMemo(() => completedItems ?? [], [completedItems])
  const cancelled = React.useMemo(() => cancelledItems ?? [], [cancelledItems])
  const isLoading = queries.some((q) => q.isLoading)

  // Metrics summary
  const summary = React.useMemo(() => {
    let totalInvested = 0
    for (const b of completed) {
      totalInvested += b.amount
    }
    return {
      completedCount: completed.length,
      cancelledCount: cancelled.length,
      totalInvested,
    }
  }, [completed, cancelled])

  const counts = React.useMemo(
    () => ({
      COMPLETED: completed.length,
      CANCELLED: cancelled.length,
      ALL: completed.length + cancelled.length,
    }),
    [completed, cancelled],
  )

  // Filtered and sorted items
  const visible = React.useMemo(() => {
    let list: Booking[] = []
    if (tab === "COMPLETED") list = completed
    else if (tab === "CANCELLED") list = cancelled
    else list = [...completed, ...cancelled]

    if (filterText.trim()) {
      const search = filterText.trim().toLowerCase()
      list = list.filter((b) => {
        const matchProvider = b.provider.name.toLowerCase().includes(search)
        const matchService = b.service.title.toLowerCase().includes(search)
        return matchProvider || matchService
      })
    }

    return [...list].sort((a, b) => {
      if (sortBy === "recent") {
        return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
      }
      if (sortBy === "oldest") {
        return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      }
      if (sortBy === "highest") {
        return b.amount - a.amount
      }
      return 0
    })
  }, [tab, completed, cancelled, filterText, sortBy])

  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const hasFilters = filterText !== "" || sortBy !== "recent"

  return (
    <div className="space-y-4">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
              <Wrench className="size-3" />
              <span>Histórico & Garantia de Serviços</span>
            </div>
            <h1 className="text-foreground mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
              Serviços contratados
            </h1>
            <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs sm:text-sm">
              Histórico dos serviços que você contratou com garantia de satisfação e comprovantes
              digitais.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.bookings")
              }}
              className="h-9 gap-1.5 rounded-xl px-3 text-xs font-medium"
            >
              <Calendar className="size-3.5" />
              Ver agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="h-9 gap-1.5 rounded-xl px-3 text-xs font-medium"
            >
              <MapPin className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* 90-Day Legal Warranty & Protection Banner */}
      <div className="border-primary/20 bg-primary/5 rounded-xl border p-3 sm:p-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/15 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h2 className="text-foreground text-xs font-semibold sm:text-sm">
                Garantia Severinno de 90 Dias
              </h2>
              <p className="text-muted-foreground text-[11px] sm:text-xs">
                Todos os serviços concluídos contam com a proteção legal do Código de Defesa do
                Consumidor (Art. 26). Em caso de anormalidade na execução, acione o prestador no
                chat oficial.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start pl-10.5 sm:self-center sm:pl-0">
            <span className="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium">
              <Lock className="size-3" />
              Cobertura Ativa
            </span>
          </div>
        </div>
      </div>

      {/* Impact StatCards (Compact Bento micro-cards) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={CheckCircle2}
          label="Concluídos"
          value={String(summary.completedCount)}
          tone="primary"
          hint="Serviços finalizados"
          compact
        />
        <StatCard
          icon={Wallet}
          label="Total Investido"
          value={formatBRL(summary.totalInvested)}
          tone="amber"
          hint="Em manutenções residenciais"
          compact
        />
        <StatCard
          icon={XCircle}
          label="Cancelados"
          value={String(summary.cancelledCount)}
          tone="zinc"
          hint="Estornados ou descontinuados"
          compact
        />
      </div>

      {/* Status tabs with counts */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-auto">
          {TABS.map((t) => {
            const count = counts[t.key as keyof typeof counts] ?? 0
            const active = tab === t.key
            return (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="h-8.5 flex-shrink-0 gap-1.5 rounded-xl px-3 text-xs"
              >
                {t.label}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-primary/15 text-primary font-bold"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {/* Filter & View Mode Toolbar */}
      <div className="bg-card border-border/60 flex flex-wrap items-center gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value)
              setPage(1)
            }}
            placeholder="Filtrar por prestador ou serviço..."
            className="border-border/50 bg-background/60 focus:bg-background h-9 pr-8 pl-9 text-xs"
          />
          {filterText ? (
            <button
              type="button"
              onClick={() => {
                setFilterText("")
                setPage(1)
              }}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-[9px] font-semibold tracking-wide uppercase">
            Ordenar
          </span>
          <Select
            value={sortBy}
            onValueChange={(val) => setSortBy(val as "recent" | "oldest" | "highest")}
          >
            <SelectTrigger className="h-9 w-34" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Mais recentes</SelectItem>
              <SelectItem value="oldest">Mais antigos</SelectItem>
              <SelectItem value="highest">Maior valor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* View Mode Toggle: Lista / Grade */}
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-[9px] font-semibold tracking-wide uppercase">
            Visualização
          </span>
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

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterText("")
              setSortBy("recent")
              setPage(1)
            }}
            className="text-muted-foreground hover:text-foreground h-9 gap-1.5 self-end rounded-xl"
          >
            <RotateCcw className="size-3.5" />
            Limpar
          </Button>
        ) : null}

        <p className="text-muted-foreground ml-auto self-end text-xs tabular-nums">
          {isLoading
            ? "Carregando…"
            : total === 0
              ? "Sem resultados"
              : `Mostrando ${pageItems.length} de ${total} serviço${total !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
          <Loader2 className="size-5 animate-spin" />
          Carregando serviços…
        </div>
      ) : pageItems.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={
            tab === "COMPLETED"
              ? "Você ainda não concluiu serviços"
              : tab === "CANCELLED"
                ? "Nenhum serviço cancelado"
                : "Nenhum serviço no histórico"
          }
          description={
            tab === "COMPLETED"
              ? "Quando um agendamento for finalizado, ele aparecerá aqui com a opção de contratar novamente."
              : tab === "CANCELLED"
                ? "Não há serviços cancelados no seu histórico."
                : "Explore prestadores verificados e contrate seu primeiro serviço."
          }
          action={
            <Button onClick={() => navigate("client.providers")} className="mt-2 gap-2">
              <MapPin className="size-4" />
              Buscar prestadores
            </Button>
          }
        />
      ) : viewMode === "list" ? (
        <div className="grid gap-2.5">
          {pageItems.map((b) => (
            <ServiceHistoryCard
              key={b.id}
              booking={b}
              onViewProvider={() => openProvider(b.provider.id)}
              onRebook={() =>
                openBooking({
                  providerId: b.provider.id,
                  serviceId: b.service.id,
                })
              }
              onOpenReceipt={() => setSelectedReceiptBookingId(b.id)}
              onOpenReview={() => setReviewingBooking(b)}
              onMessage={() =>
                navigate("client.messages", {
                  providerId: b.provider.id,
                  bookingId: b.id,
                })
              }
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pageItems.map((b) => (
            <ServiceHistoryGridCard
              key={b.id}
              booking={b}
              onViewProvider={() => openProvider(b.provider.id)}
              onRebook={() =>
                openBooking({
                  providerId: b.provider.id,
                  serviceId: b.service.id,
                })
              }
              onOpenReceipt={() => setSelectedReceiptBookingId(b.id)}
              onOpenReview={() => setReviewingBooking(b)}
              onMessage={() =>
                navigate("client.messages", {
                  providerId: b.provider.id,
                  bookingId: b.id,
                })
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE ? (
        <div className="flex flex-col items-center justify-between gap-2 border-t pt-3 sm:flex-row">
          <p className="text-muted-foreground text-xs tabular-nums">
            Página {page} de {totalPages} · {total} serviços
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

      {/* Official Authentic Receipt Modal */}
      <ReceiptModal
        bookingId={selectedReceiptBookingId ?? ""}
        open={Boolean(selectedReceiptBookingId)}
        onOpenChange={(open) => {
          if (!open) setSelectedReceiptBookingId(null)
        }}
      />

      {/* Interactive Review Dialog */}
      <ReviewDialog
        open={Boolean(reviewingBooking)}
        onOpenChange={(open) => {
          if (!open) setReviewingBooking(null)
        }}
        booking={reviewingBooking}
        onSubmitted={() => {
          setReviewingBooking(null)
          qc.invalidateQueries({ queryKey: ["bookings", "CLIENT", "services"] })
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServiceHistoryCardProps
// ---------------------------------------------------------------------------

type ServiceHistoryCardProps = {
  booking: Booking
  onViewProvider: () => void
  onRebook: () => void
  onOpenReceipt: () => void
  onOpenReview: () => void
  onMessage: () => void
}

// ---------------------------------------------------------------------------
// ServiceHistoryCard (List View — Ultra-compact, clean & minimalist)
// ---------------------------------------------------------------------------

function ServiceHistoryCard({
  booking,
  onViewProvider,
  onRebook,
  onOpenReceipt,
  onOpenReview,
  onMessage,
}: ServiceHistoryCardProps) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)
  const review = booking.reviews?.[0]
  const status = booking.status as BookingStatus
  const isCompleted = status === "COMPLETED"

  const unitLabel =
    booking.service.unit && SERVICE_UNIT_SHORT[booking.service.unit]
      ? `(${SERVICE_UNIT_SHORT[booking.service.unit]})`
      : ""

  return (
    <Card className="border-border/50 bg-card hover:border-border/80 group relative overflow-hidden rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              onViewProvider()
            }}
            className="ring-background shrink-0 rounded-full ring-1 transition-transform outline-none hover:scale-105 focus-visible:ring-2"
            aria-label={`Ver perfil de ${provider.name}`}
          >
            <Avatar className="border-border/40 size-9.5 rounded-full border shadow-2xs sm:size-10">
              {provider.avatarUrl ? (
                <AvatarImage
                  src={provider.avatarUrl}
                  alt={provider.name}
                  className="rounded-full object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                {initials || "P"}
              </AvatarFallback>
            </Avatar>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  onViewProvider()
                }}
                className="hover:text-primary text-foreground truncate text-left text-sm font-semibold transition-colors hover:underline"
              >
                {provider.name}
              </button>
              <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                {BOOKING_STATUS_LABELS[status]}
              </StatusBadge>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-xs sm:text-sm">
              {booking.service.title}
              {unitLabel ? <span className="ml-1 text-[11px] font-medium">{unitLabel}</span> : null}
            </p>
            <p className="text-muted-foreground/80 mt-1 inline-flex items-center gap-1 text-[11px] tabular-nums sm:text-xs">
              <CalendarDays className="text-primary size-3 shrink-0" />
              {isCompleted ? "Concluído" : "Cancelado"} em {formatDate(booking.scheduledAt)} ·{" "}
              {PAYMENT_METHOD_LABELS[booking.paymentMethod as PaymentMethod]}
            </p>
          </div>

          <div className="shrink-0 pl-2 text-right">
            <p className="text-muted-foreground/80 text-[10px] font-semibold tracking-wider uppercase">
              {isCompleted ? "Pago" : "Valor"}
            </p>
            <p className="text-foreground text-sm font-bold tabular-nums sm:text-base">
              {formatBRL(booking.amount)}
            </p>
          </div>
        </div>

        {/* Review display or prompt */}
        {review ? (
          <div className="border-border/30 bg-muted/20 mt-2 rounded-lg border px-2.5 py-1.5 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <StarRatingDisplay value={review.rating} size={11} showCount={false} />
                <span className="text-foreground/80 text-[11px] font-medium tabular-nums">
                  {review.rating.toFixed(1)}
                </span>
              </div>
              <span className="text-muted-foreground/80 text-[10px] tabular-nums">
                {formatDate(review.createdAt)}
              </span>
            </div>
            {review.comment ? (
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-relaxed italic">
                “{review.comment}”
              </p>
            ) : null}
          </div>
        ) : isCompleted ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-dashed border-amber-300/60 bg-amber-50/35 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/15 dark:text-amber-200">
            <div className="flex min-w-0 items-center gap-1.5">
              <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" />
              <span className="truncate text-[11px]">
                Avalie para fortalecer a reputação do prestador em GV.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                onOpenReview()
              }}
              className="h-6 shrink-0 border-amber-300/80 bg-white/90 px-2 text-[10px] font-semibold text-amber-900 shadow-2xs hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-100"
            >
              Avaliar agora
            </Button>
          </div>
        ) : null}

        {/* Card Action Footer */}
        <div className="border-border/30 mt-2 flex flex-wrap items-center justify-between gap-1.5 border-t pt-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground h-7 gap-1 rounded-md px-2 text-xs transition-colors"
            >
              <MapPin className="size-3" />
              <span>Perfil</span>
            </Button>

            {isCompleted && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onOpenReceipt()
                }}
                className="h-7 gap-1 rounded-md border-emerald-500/25 bg-emerald-50/40 px-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100/60 hover:text-emerald-800 dark:border-emerald-800/30 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
              >
                <FileText className="size-3" />
                <span>Recibo</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground h-7 w-7 shrink-0 rounded-md p-0 transition-colors"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>

          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onRebook()
            }}
            className="ml-auto h-7 gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-2xs transition-all hover:shadow-xs active:scale-98"
          >
            <RotateCcw className="size-3" />
            Contratar novamente
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ServiceHistoryGridCard (Grid View — Modern Bento micro-card)
// ---------------------------------------------------------------------------

function ServiceHistoryGridCard({
  booking,
  onViewProvider,
  onRebook,
  onOpenReceipt,
  onOpenReview,
  onMessage,
}: ServiceHistoryCardProps) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)
  const review = booking.reviews?.[0]
  const status = booking.status as BookingStatus
  const isCompleted = status === "COMPLETED"

  const unitLabel =
    booking.service.unit && SERVICE_UNIT_SHORT[booking.service.unit]
      ? `(${SERVICE_UNIT_SHORT[booking.service.unit]})`
      : ""

  return (
    <Card className="border-border/50 bg-card hover:border-border/80 group flex flex-col justify-between rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="flex h-full flex-col justify-between p-3 sm:p-3.5">
        <div className="space-y-2">
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
                <Avatar className="border-border/40 size-9.5 rounded-full border shadow-2xs sm:size-10">
                  {provider.avatarUrl ? (
                    <AvatarImage
                      src={provider.avatarUrl}
                      alt={provider.name}
                      className="rounded-full object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                    {initials || "P"}
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
                  className="hover:text-primary text-foreground block truncate text-left text-sm font-semibold transition-colors hover:underline"
                >
                  {provider.name}
                </button>
                <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                  {BOOKING_STATUS_LABELS[status]}
                </StatusBadge>
              </div>
            </div>

            <div className="shrink-0 pl-1 text-right">
              <p className="text-muted-foreground/80 text-[10px] font-semibold tracking-wider uppercase">
                {isCompleted ? "Pago" : "Valor"}
              </p>
              <p className="text-foreground text-sm font-bold tabular-nums sm:text-base">
                {formatBRL(booking.amount)}
              </p>
            </div>
          </div>

          {/* Service Title */}
          <div className="border-border/30 border-t pt-1.5">
            <p className="text-foreground/90 truncate text-xs font-medium">
              {booking.service.title}
              {unitLabel ? <span className="ml-1 text-[11px] font-medium">{unitLabel}</span> : null}
            </p>
            <p className="text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1 text-[11px] tabular-nums">
              <CalendarDays className="text-primary size-3 shrink-0" />
              {isCompleted ? "Concluído" : "Cancelado"} em {formatDate(booking.scheduledAt)} ·{" "}
              {PAYMENT_METHOD_LABELS[booking.paymentMethod as PaymentMethod]}
            </p>
          </div>

          {/* Review or prompt */}
          {review ? (
            <div className="border-border/30 bg-muted/20 rounded-lg border px-2 py-1.5 transition-colors">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <StarRatingDisplay value={review.rating} size={11} showCount={false} />
                  <span className="text-foreground/80 text-[11px] font-medium tabular-nums">
                    {review.rating.toFixed(1)}
                  </span>
                </div>
                <span className="text-muted-foreground/80 text-[10px] tabular-nums">
                  {formatDate(review.createdAt)}
                </span>
              </div>
              {review.comment ? (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-relaxed italic">
                  “{review.comment}”
                </p>
              ) : null}
            </div>
          ) : isCompleted ? (
            <div className="flex items-center justify-between gap-1.5 rounded-lg border border-dashed border-amber-300/60 bg-amber-50/35 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/15 dark:text-amber-200">
              <span className="truncate">Avalie este serviço</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("selection")
                  onOpenReview()
                }}
                className="h-6 shrink-0 border-amber-300/80 bg-white/90 px-2 text-[10px] font-semibold text-amber-900 shadow-2xs hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-100"
              >
                Avaliar agora
              </Button>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="border-border/30 mt-2 flex items-center justify-between gap-1 border-t pt-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground h-7 gap-1 rounded-md px-1.5 text-xs transition-colors"
            >
              <MapPin className="size-3" />
              <span>Perfil</span>
            </Button>

            {isCompleted && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onOpenReceipt()
                }}
                className="h-7 gap-1 rounded-md border-emerald-500/25 bg-emerald-50/40 px-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100/60 hover:text-emerald-800 dark:border-emerald-800/30 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
              >
                <FileText className="size-3" />
                <span>Recibo</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground h-7 w-7 shrink-0 rounded-md p-0 transition-colors"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>

          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onRebook()
            }}
            className="ml-auto h-7 gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-2xs transition-all hover:shadow-xs active:scale-98"
          >
            <RotateCcw className="size-3" />
            Contratar novamente
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
