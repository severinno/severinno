"use client"

/**
 * ClientServices — "Serviços contratados" — historical view of finished or
 * cancelled bookings.
 *
 * Each card shows: provider (avatar+name), service, completion/cancel date,
 * amount, rating given (stars) — and a "Contratar novamente" button that
 * re-opens the booking modal pre-filled with the same provider+service.
 *
 * Polish (Nielsen):
 *  - Page header (text-2xl font-bold).
 *  - Status tabs (Todos / Concluídos / Cancelados) with counts.
 *  - Cards with StatusBadge (emerald COMPLETED, rose CANCELLED).
 *  - Re-book CTA for completed services.
 */

import * as React from "react"
import { useQueries } from "@tanstack/react-query"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  RotateCcw,
  Star,
  Wrench,
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
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { EmptyState } from "@/components/shared/dashboard-shell"
import {
  PageHeader,
  StatusBadge,
  bookingIcon,
  bookingTone,
} from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types (subset of Booking)
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

export function ClientServices() {
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openBooking = useUIStore((s) => s.openBooking)

  const [tab, setTab] = React.useState("COMPLETED")
  const [page, setPage] = React.useState(1)

  React.useEffect(() => setPage(1), [tab])

  // Fetch completed + cancelled in parallel so we can show counts + the
  // "Todos" tab without server-side filter juggling.
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

  const counts = React.useMemo(
    () => ({
      COMPLETED: completed.length,
      CANCELLED: cancelled.length,
      ALL: completed.length + cancelled.length,
    }),
    [completed, cancelled],
  )

  const visible = React.useMemo(() => {
    let list: Booking[] = []
    if (tab === "COMPLETED") list = completed
    else if (tab === "CANCELLED") list = cancelled
    else list = [...completed, ...cancelled]
    return [...list].sort(
      (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
    )
  }, [tab, completed, cancelled])

  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Serviços contratados"
        subtitle="Histórico dos serviços que você contratou."
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
            const count = counts[t.key as keyof typeof counts] ?? 0
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
            ? "Nenhum serviço nesta categoria."
            : `Mostrando ${pageItems.length} de ${total} serviço${total !== 1 ? "s" : ""}.`}
      </p>

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
            <Button onClick={() => navigate("vitrine")} className="mt-2 gap-2">
              <MapPin className="size-4" />
              Buscar prestadores
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
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
            />
          ))}
        </div>
      )}

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
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServiceHistoryCard
// ---------------------------------------------------------------------------

function ServiceHistoryCard({
  booking,
  onViewProvider,
  onRebook,
}: {
  booking: Booking
  onViewProvider: () => void
  onRebook: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)
  const review = booking.reviews?.[0]
  const status = booking.status as BookingStatus
  const isCompleted = status === "COMPLETED"

  return (
    <Card className="flex flex-col rounded-xl shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex-1 py-4">
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
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-sm">
              {booking.service.title}
              <span className="ml-1 text-xs">({SERVICE_UNIT_SHORT[booking.service.unit]})</span>
            </p>
            <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs tabular-nums">
              <CalendarDays className="size-3.5" />
              {isCompleted ? "Concluído" : "Cancelado"} em {formatDate(booking.scheduledAt)} ·{" "}
              {PAYMENT_METHOD_LABELS[booking.paymentMethod as PaymentMethod]}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-muted-foreground text-xs">{isCompleted ? "Pago" : "Valor"}</p>
            <p className="text-sm font-semibold tabular-nums">{formatBRL(booking.amount)}</p>
          </div>
        </div>

        {review ? (
          <div className="bg-muted/30 mt-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <StarRatingDisplay value={review.rating} size={14} showCount={false} />
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatDate(review.createdAt)}
              </span>
            </div>
            {review.comment ? (
              <p className="text-muted-foreground mt-1.5 line-clamp-3 text-xs">{review.comment}</p>
            ) : null}
          </div>
        ) : isCompleted ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Star className="size-4 shrink-0" />
            <span>
              Serviço concluído sem avaliação. Avaliações ajudam outros clientes e o prestador.
            </span>
          </div>
        ) : null}
      </CardContent>

      {isCompleted ? (
        <div className="bg-muted/30 flex items-center gap-2 border-t px-4 py-2.5">
          <Button variant="outline" size="sm" onClick={onViewProvider} className="h-9 gap-1.5">
            <MapPin className="size-4" />
            Ver prestador
          </Button>
          <Button size="sm" onClick={onRebook} className="ml-auto h-9 gap-1.5">
            <RotateCcw className="size-4" />
            Contratar novamente
          </Button>
        </div>
      ) : (
        <div className="bg-muted/30 flex items-center gap-2 border-t px-4 py-2.5">
          <Button variant="outline" size="sm" onClick={onViewProvider} className="h-9 gap-1.5">
            <MapPin className="size-4" />
            Ver prestador
          </Button>
          <Button size="sm" onClick={onRebook} className="ml-auto h-9 gap-1.5">
            <RotateCcw className="size-4" />
            Contratar novamente
          </Button>
        </div>
      )}
    </Card>
  )
}
