"use client"

/**
 * ClientReviews — Clean, minimalist review and reputation management for clients.
 *
 * Capabilities:
 *  - Modern Hero Banner with community trust badge and quick navigation
 *  - 3 Ultra-compact Bento StatCards (~68px) with metrics overview
 *  - View mode switcher (Lista / Grade) with haptic feedback
 *  - Segmented status tabs with live counts:
 *     - "Aguardando avaliação" (COMPLETED bookings without review)
 *     - "Avaliações enviadas" (Submitted reviews with comments, ratings and provider replies)
 *     - "Todos os atendimentos" (Complete history)
 *  - In-list quick search by provider name or service title with instant clear "X"
 *  - List View: Ultra-compact rows (~75px) with round avatars and quick actions
 *  - Grid View: Balanced Bento cards with comments, ratings, and replies
 *  - Direct "Avaliar agora" CTA opening ReviewDialog
 *  - Direct "Contratar novamente" CTA for completed services
 *  - Direct platform messaging (client.messages) with zero WhatsApp leaks
 *  - 100% round avatars (rounded-full) with provider profile modal integration
 *  - Persuasive 3-step community empty state
 */

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  LayoutGrid,
  LayoutList,
  Loader2,
  MapPin,
  MessageSquare,
  MessageSquareQuote,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api"
import { formatBRL, formatDate } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { ReviewDialog } from "@/components/client/review-dialog"
import { StatCard } from "@/components/shared/shell"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReviewItem = {
  id: string
  rating: number
  comment?: string | null
  photos?: string[] | unknown
  providerReply?: string | null
  providerReplyAt?: string | null
  createdAt: string
}

type CompletedBooking = {
  id: string
  status: string
  scheduledAt: string
  amount: number
  service: { id: string; title: string; photos?: string[] | unknown }
  provider: { id: string; name: string; avatarUrl?: string | null }
  reviews?: ReviewItem[]
}

type BookingsResponse = {
  items: CompletedBooking[]
  total: number
  page: number
  limit: number
}

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

export function ClientReviews() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openBooking = useUIStore((s) => s.openBooking)

  const [tab, setTab] = React.useState<"PENDING" | "SUBMITTED" | "ALL">("PENDING")
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [filterText, setFilterText] = React.useState("")
  const [reviewingBooking, setReviewingBooking] = React.useState<CompletedBooking | null>(null)

  // Query completed bookings for the authenticated client
  const query = useQuery<BookingsResponse>({
    queryKey: ["bookings", "CLIENT", "reviews-history"],
    queryFn: () =>
      apiGet<BookingsResponse>("/api/bookings", {
        role: "CLIENT",
        status: "COMPLETED",
        page: 1,
        limit: 50,
      }),
    staleTime: 30_000,
  })

  const allBookings = React.useMemo(() => query.data?.items ?? [], [query.data?.items])

  // Derived lists
  const { pendingBookings, submittedBookings, avgRating } = React.useMemo(() => {
    const pending: CompletedBooking[] = []
    const submitted: Array<{
      booking: CompletedBooking
      review: ReviewItem
    }> = []

    let totalRatingSum = 0
    let reviewCount = 0

    for (const b of allBookings) {
      const revs = b.reviews ?? []
      if (revs.length === 0) {
        pending.push(b)
      } else {
        for (const r of revs) {
          submitted.push({ booking: b, review: r })
          totalRatingSum += r.rating
          reviewCount++
        }
      }
    }

    const avg = reviewCount > 0 ? totalRatingSum / reviewCount : 0
    return { pendingBookings: pending, submittedBookings: submitted, avgRating: avg }
  }, [allBookings])

  // Filtered lists
  const filteredPending = React.useMemo(() => {
    if (!filterText.trim()) return pendingBookings
    const q = filterText.toLowerCase().trim()
    return pendingBookings.filter(
      (b) => b.provider.name.toLowerCase().includes(q) || b.service.title.toLowerCase().includes(q),
    )
  }, [pendingBookings, filterText])

  const filteredSubmitted = React.useMemo(() => {
    if (!filterText.trim()) return submittedBookings
    const q = filterText.toLowerCase().trim()
    return submittedBookings.filter(
      (item) =>
        item.booking.provider.name.toLowerCase().includes(q) ||
        item.booking.service.title.toLowerCase().includes(q) ||
        (item.review.comment && item.review.comment.toLowerCase().includes(q)),
    )
  }, [submittedBookings, filterText])

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Modern Hero Banner */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-amber-500/5 p-4 shadow-2xs sm:p-5">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <Sparkles className="size-3" />
              <span>Ciclo de Confiança & Reputação</span>
            </div>
            <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              Avaliações
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Reconheça profissionais qualificados e ajude outros moradores a contratarem com
              segurança em Governador Valadares.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.bookings")
              }}
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <CalendarDays className="text-primary size-3.5" />
              Ver agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <MapPin className="text-primary size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* 3 Ultra-Compact Bento StatCards (~68px) */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatCard
          compact={true}
          icon={Clock}
          label="Aguardando Avaliação"
          value={String(pendingBookings.length)}
          tone={pendingBookings.length > 0 ? "amber" : "zinc"}
          hint={pendingBookings.length > 0 ? "Sua opinião faz a diferença" : "Tudo em dia por aqui"}
        />
        <StatCard
          compact={true}
          icon={MessageSquareQuote}
          label="Avaliações Enviadas"
          value={String(submittedBookings.length)}
          tone="primary"
          hint="Reconhecimento na comunidade"
        />
        <StatCard
          compact={true}
          icon={Star}
          label="Nota Média Concedida"
          value={submittedBookings.length === 0 ? "—" : `${avgRating.toFixed(1)} ★`}
          tone="amber"
          hint={
            submittedBookings.length > 0
              ? `Baseado em ${submittedBookings.length} ${submittedBookings.length === 1 ? "avaliação" : "avaliações"}`
              : "Sem histórico de notas"
          }
        />
      </div>

      {/* Modern Filter, Tabs & View Mode Toolbar */}
      <div className="bg-card border-border/60 flex flex-col gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
        {/* Status Segmented Rail */}
        <div className="-mx-1 flex scrollbar-none gap-1.5 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setTab("PENDING")
            }}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
              tab === "PENDING"
                ? "bg-amber-600 font-semibold text-white shadow-2xs"
                : "border-border/60 bg-muted/30 hover:bg-muted/70 text-muted-foreground hover:text-foreground border",
            )}
          >
            <Clock className="size-3" />
            <span>Aguardando avaliação</span>
            <span
              className={cn(
                "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums",
                tab === "PENDING" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
              )}
            >
              {pendingBookings.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setTab("SUBMITTED")
            }}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
              tab === "SUBMITTED"
                ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                : "border-border/60 bg-muted/30 hover:bg-muted/70 text-muted-foreground hover:text-foreground border",
            )}
          >
            <CheckCircle2 className="size-3" />
            <span>Avaliações enviadas</span>
            <span
              className={cn(
                "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums",
                tab === "SUBMITTED"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {submittedBookings.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setTab("ALL")
            }}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
              tab === "ALL"
                ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                : "border-border/60 bg-muted/30 hover:bg-muted/70 text-muted-foreground hover:text-foreground border",
            )}
          >
            <LayoutGrid className="size-3" />
            <span>Todos os atendimentos</span>
            <span
              className={cn(
                "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums",
                tab === "ALL"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {allBookings.length}
            </span>
          </button>
        </div>

        {/* Search Input + View Mode Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t pt-2">
          {/* Quick Filter */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Filtrar por prestador ou serviço..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-8.5 rounded-lg pr-8 pl-8.5 text-xs"
            />
            {filterText ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setFilterText("")
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
                title="Limpar busca"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {/* View mode switcher */}
          <div className="bg-muted/40 flex items-center rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setViewMode("list")
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                viewMode === "list"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Visualização em Lista"
              aria-pressed={viewMode === "list"}
            >
              <LayoutList className="size-3.5" />
              <span className="hidden sm:inline">Lista</span>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setViewMode("grid")
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                viewMode === "grid"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Visualização em Grade"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="size-3.5" />
              <span className="hidden sm:inline">Grade</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reassurance Banner */}
      <div className="text-muted-foreground flex items-center justify-between px-1 text-xs">
        <div>
          {query.isLoading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="text-primary size-3.5 animate-spin" />
              Carregando avaliações...
            </span>
          ) : (
            <span>
              {tab === "PENDING"
                ? `${filteredPending.length} ${filteredPending.length === 1 ? "serviço aguardando" : "serviços aguardando"} sua avaliação`
                : tab === "SUBMITTED"
                  ? `${filteredSubmitted.length} ${filteredSubmitted.length === 1 ? "avaliação enviada" : "avaliações enviadas"}`
                  : `${allBookings.length} ${allBookings.length === 1 ? "atendimento concluído" : "atendimentos concluídos"}`}
            </span>
          )}
        </div>

        <div className="hidden items-center gap-1.5 font-medium text-emerald-700 sm:flex dark:text-emerald-400">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          <span>Avaliações Verificadas · Apenas Clientes Reais de GV</span>
        </div>
      </div>

      {/* Main Content Area */}
      {query.isLoading ? (
        <div className="grid gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-border/60 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="bg-muted size-11 animate-pulse rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="bg-muted h-3.5 w-40 rounded" />
                  <div className="bg-muted h-3 w-28 rounded" />
                </div>
                <div className="bg-muted h-7 w-20 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : tab === "PENDING" ? (
        /* PENDING REVIEWS TAB */
        filteredPending.length === 0 ? (
          <Card className="border-border/70 rounded-2xl border-dashed p-6 text-center sm:p-10">
            <CardContent className="flex flex-col items-center justify-center space-y-3 p-0">
              <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-6" />
              </div>
              <h3 className="text-foreground text-sm font-bold sm:text-base">
                Tudo em dia com suas avaliações!
              </h3>
              <p className="text-muted-foreground mx-auto max-w-md text-xs leading-relaxed">
                Você já avaliou todos os seus atendimentos concluídos. Novas oportunidades de
                feedback aparecerão aqui assim que um serviço for finalizado.
              </p>
              {submittedBookings.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    setTab("SUBMITTED")
                  }}
                  className="border-border/60 mt-1 h-8 rounded-lg text-xs font-semibold"
                >
                  Ver avaliações que você já enviou
                </Button>
              )}
            </CardContent>
          </Card>
        ) : viewMode === "list" ? (
          /* MODO LISTA */
          <div className="space-y-2.5">
            {filteredPending.map((b) => (
              <PendingReviewListCard
                key={b.id}
                booking={b}
                onReview={() => setReviewingBooking(b)}
                onViewProvider={() => openProvider(b.provider.id)}
                onRebook={() =>
                  openBooking({
                    providerId: b.provider.id,
                    serviceId: b.service.id,
                  })
                }
                onMessage={() =>
                  navigate("client.messages", {
                    with: b.provider.id,
                    peerId: b.provider.id,
                    providerId: b.provider.id,
                  })
                }
              />
            ))}
          </div>
        ) : (
          /* MODO GRADE */
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredPending.map((b) => (
              <PendingReviewCard
                key={b.id}
                booking={b}
                onReview={() => setReviewingBooking(b)}
                onViewProvider={() => openProvider(b.provider.id)}
                onRebook={() =>
                  openBooking({
                    providerId: b.provider.id,
                    serviceId: b.service.id,
                  })
                }
                onMessage={() =>
                  navigate("client.messages", {
                    with: b.provider.id,
                    peerId: b.provider.id,
                    providerId: b.provider.id,
                  })
                }
              />
            ))}
          </div>
        )
      ) : tab === "SUBMITTED" ? (
        /* SUBMITTED REVIEWS TAB */
        filteredSubmitted.length === 0 ? (
          <Card className="border-border/70 rounded-2xl border-dashed p-6 text-center sm:p-10">
            <CardContent className="flex flex-col items-center justify-center space-y-3 p-0">
              <div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Star className="size-6" />
              </div>
              <h3 className="text-foreground text-sm font-bold sm:text-base">
                Nenhuma avaliação enviada ainda
              </h3>
              <p className="text-muted-foreground mx-auto max-w-md text-xs leading-relaxed">
                Quando você avaliar prestadores após a conclusão dos serviços, suas notas e
                depoimentos ficarão organizados nesta seção.
              </p>
              {pendingBookings.length > 0 ? (
                <Button
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    setTab("PENDING")
                  }}
                  className="mt-1 h-8 rounded-lg bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Você tem {pendingBookings.length} serviço{pendingBookings.length !== 1 ? "s" : ""}{" "}
                  para avaliar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    navigate("client.bookings")
                  }}
                  className="border-border/60 mt-1 h-8 rounded-lg text-xs font-semibold"
                >
                  Ver seus agendamentos
                </Button>
              )}
            </CardContent>
          </Card>
        ) : viewMode === "list" ? (
          /* MODO LISTA */
          <div className="space-y-2.5">
            {filteredSubmitted.map((item) => (
              <SubmittedReviewListCard
                key={item.review.id}
                booking={item.booking}
                review={item.review}
                onViewProvider={() => openProvider(item.booking.provider.id)}
                onRebook={() =>
                  openBooking({
                    providerId: item.booking.provider.id,
                    serviceId: item.booking.service.id,
                  })
                }
                onMessage={() =>
                  navigate("client.messages", {
                    with: item.booking.provider.id,
                    peerId: item.booking.provider.id,
                    providerId: item.booking.provider.id,
                  })
                }
              />
            ))}
          </div>
        ) : (
          /* MODO GRADE */
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredSubmitted.map((item) => (
              <SubmittedReviewCard
                key={item.review.id}
                booking={item.booking}
                review={item.review}
                onViewProvider={() => openProvider(item.booking.provider.id)}
                onRebook={() =>
                  openBooking({
                    providerId: item.booking.provider.id,
                    serviceId: item.booking.service.id,
                  })
                }
                onMessage={() =>
                  navigate("client.messages", {
                    with: item.booking.provider.id,
                    peerId: item.booking.provider.id,
                    providerId: item.booking.provider.id,
                  })
                }
              />
            ))}
          </div>
        )
      ) : /* ALL SERVICES TAB */
      allBookings.length === 0 ? (
        <Card className="border-border/70 rounded-2xl border-dashed p-6 text-center sm:p-10">
          <CardContent className="flex flex-col items-center justify-center space-y-3.5 p-0">
            <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl shadow-2xs">
              <Star className="size-6" />
            </div>
            <div className="space-y-1 text-center">
              <h3 className="text-foreground text-sm font-bold sm:text-base">
                Você ainda não possui atendimentos concluídos
              </h3>
              <p className="text-muted-foreground mx-auto max-w-md text-xs leading-relaxed">
                Assim que você contratar e concluir serviços com os profissionais do Severinno, eles
                aparecerão aqui para avaliação e recontratação.
              </p>
            </div>

            {/* 3 Step Service Guide */}
            <div className="border-border/50 bg-muted/30 my-2 grid w-full max-w-2xl gap-2.5 rounded-xl border p-3 text-left sm:grid-cols-3">
              <div className="space-y-1">
                <div className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                  <span className="bg-primary/15 text-primary flex size-4.5 items-center justify-center rounded-full text-[10px]">
                    1
                  </span>
                  <span>Contrate com Escrow</span>
                </div>
                <p className="text-muted-foreground text-[10.5px] leading-relaxed">
                  Pagamento retido com segurança até o término do serviço.
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                  <span className="bg-primary/15 text-primary flex size-4.5 items-center justify-center rounded-full text-[10px]">
                    2
                  </span>
                  <span>Receba com Qualidade</span>
                </div>
                <p className="text-muted-foreground text-[10.5px] leading-relaxed">
                  Atendimento pontual por prestadores verificados de GV.
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                  <span className="bg-primary/15 text-primary flex size-4.5 items-center justify-center rounded-full text-[10px]">
                    3
                  </span>
                  <span>Avalie em 30s</span>
                </div>
                <p className="text-muted-foreground text-[10.5px] leading-relaxed">
                  Reconheça bons profissionais e fortaleça a comunidade.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.providers")
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 rounded-lg text-xs font-semibold shadow-2xs"
              >
                <MapPin className="size-3.5" />
                Buscar prestadores agora
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {allBookings.map((b) => {
            const hasReview = b.reviews && b.reviews.length > 0
            if (hasReview && b.reviews) {
              return viewMode === "list" ? (
                <SubmittedReviewListCard
                  key={b.reviews[0].id}
                  booking={b}
                  review={b.reviews[0]}
                  onViewProvider={() => openProvider(b.provider.id)}
                  onRebook={() =>
                    openBooking({
                      providerId: b.provider.id,
                      serviceId: b.service.id,
                    })
                  }
                  onMessage={() =>
                    navigate("client.messages", {
                      with: b.provider.id,
                      peerId: b.provider.id,
                      providerId: b.provider.id,
                    })
                  }
                />
              ) : (
                <SubmittedReviewCard
                  key={b.reviews[0].id}
                  booking={b}
                  review={b.reviews[0]}
                  onViewProvider={() => openProvider(b.provider.id)}
                  onRebook={() =>
                    openBooking({
                      providerId: b.provider.id,
                      serviceId: b.service.id,
                    })
                  }
                  onMessage={() =>
                    navigate("client.messages", {
                      with: b.provider.id,
                      peerId: b.provider.id,
                      providerId: b.provider.id,
                    })
                  }
                />
              )
            }
            return viewMode === "list" ? (
              <PendingReviewListCard
                key={b.id}
                booking={b}
                onReview={() => setReviewingBooking(b)}
                onViewProvider={() => openProvider(b.provider.id)}
                onRebook={() =>
                  openBooking({
                    providerId: b.provider.id,
                    serviceId: b.service.id,
                  })
                }
                onMessage={() =>
                  navigate("client.messages", {
                    with: b.provider.id,
                    peerId: b.provider.id,
                    providerId: b.provider.id,
                  })
                }
              />
            ) : (
              <PendingReviewCard
                key={b.id}
                booking={b}
                onReview={() => setReviewingBooking(b)}
                onViewProvider={() => openProvider(b.provider.id)}
                onRebook={() =>
                  openBooking({
                    providerId: b.provider.id,
                    serviceId: b.service.id,
                  })
                }
                onMessage={() =>
                  navigate("client.messages", {
                    with: b.provider.id,
                    peerId: b.provider.id,
                    providerId: b.provider.id,
                  })
                }
              />
            )
          })}
        </div>
      )}

      {/* Review Submission Dialog Modal */}
      {reviewingBooking && (
        <ReviewDialog
          open={Boolean(reviewingBooking)}
          onOpenChange={(open) => !open && setReviewingBooking(null)}
          booking={reviewingBooking}
          onSubmitted={() => {
            qc.invalidateQueries({ queryKey: ["bookings", "CLIENT", "reviews-history"] })
            qc.invalidateQueries({ queryKey: ["bookings"] })
            setReviewingBooking(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card: Pending Review — List Row (~75px)
// ---------------------------------------------------------------------------

function PendingReviewListCard({
  booking,
  onReview,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  onReview: () => void
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="bg-card rounded-xl border border-amber-200/70 shadow-2xs transition-all duration-200 hover:border-amber-400/80 hover:shadow-xs dark:border-amber-900/40">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Left info cluster with round avatar */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-10.5 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors"
                >
                  {provider.name}
                </button>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <Clock className="size-2.5" />
                  Aguardando sua avaliação
                </span>
              </div>

              <p className="text-foreground/90 mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px]">
                <span className="tabular-nums">Concluído em {formatDate(booking.scheduledAt)}</span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatBRL(booking.amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 border-t pt-2 sm:border-0 sm:pt-0">
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onReview()
              }}
              className="h-7.5 gap-1 rounded-lg bg-amber-600 px-2.5 text-xs font-semibold text-white shadow-2xs hover:bg-amber-700"
            >
              <Star className="size-3 fill-white" />
              Avaliar agora
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onRebook()
              }}
              className="border-border/60 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2 text-xs font-semibold"
            >
              <RotateCcw className="text-primary size-3" />
              <span className="hidden sm:inline">Contratar novamente</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="border-border/60 hover:bg-muted/60 size-7.5 rounded-lg p-0"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card: Pending Review — Grid Bento (~160px)
// ---------------------------------------------------------------------------

function PendingReviewCard({
  booking,
  onReview,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  onReview: () => void
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="bg-card relative overflow-hidden rounded-xl border border-amber-200/70 shadow-2xs transition-all duration-200 hover:border-amber-400/80 hover:shadow-xs dark:border-amber-900/40">
      <CardContent className="space-y-3 p-3.5 sm:p-4">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-11 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors sm:text-sm"
                >
                  {provider.name}
                </button>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <Clock className="size-2.5" />
                  Aguardando sua avaliação
                </span>
              </div>

              <p className="text-foreground/90 mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                <span className="tabular-nums">Concluído em {formatDate(booking.scheduledAt)}</span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatBRL(booking.amount)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Persuasive Callout Banner */}
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/60 bg-amber-50/50 p-2 text-[11px] text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-200">
          <Star className="size-3.5 shrink-0 fill-amber-500 text-amber-500" />
          <span className="leading-relaxed">
            Seu feedback de 30 segundos valoriza o profissional e fortalece a comunidade.
          </span>
        </div>

        {/* Actions Bar */}
        <div className="border-border/40 flex flex-wrap items-center gap-1.5 border-t pt-2">
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onReview()
            }}
            className="h-8 gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-amber-700"
          >
            <Star className="size-3.5 fill-white" />
            Avaliar agora
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onRebook()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
          >
            <RotateCcw className="text-primary size-3" />
            Contratar novamente
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg px-2.5 text-xs font-medium"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
            Mensagem
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card: Submitted Review — List Row (~75px)
// ---------------------------------------------------------------------------

function SubmittedReviewListCard({
  booking,
  review,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  review: ReviewItem
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 rounded-xl border shadow-2xs transition-all duration-200 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Left info cluster with round avatar */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-10.5 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors"
                >
                  {provider.name}
                </button>
                <div className="flex items-center gap-1">
                  <StarRatingDisplay value={review.rating} size={13} showCount={false} />
                  <span className="py-0.2 rounded bg-amber-500/10 px-1 text-[10px] font-bold text-amber-700 tabular-nums dark:text-amber-400">
                    {review.rating.toFixed(1)} ★
                  </span>
                </div>
              </div>

              <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-xs">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              <span className="text-muted-foreground text-[10.5px] tabular-nums">
                Avaliado em {formatDate(review.createdAt)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 border-t pt-2 sm:border-0 sm:pt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onRebook()
              }}
              className="border-border/60 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2 text-xs font-semibold"
            >
              <RotateCcw className="text-primary size-3" />
              <span className="hidden sm:inline">Contratar novamente</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="border-border/60 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2 text-xs font-medium"
            >
              <MapPin className="text-primary size-3" />
              <span className="hidden sm:inline">Ver perfil</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="border-border/60 hover:bg-muted/60 size-7.5 rounded-lg p-0"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Comment on mobile if present */}
        {review.comment && (
          <div className="border-border/40 bg-muted/20 text-foreground/90 mt-2 block rounded-lg border p-2 text-xs italic sm:hidden">
            &ldquo;{review.comment}&rdquo;
          </div>
        )}

        {/* Provider Reply */}
        {review.providerReply && (
          <div className="border-primary/20 bg-primary/5 text-foreground mt-2 rounded-lg border p-2 text-xs">
            <p className="text-primary text-[11px] font-semibold">Resposta de {provider.name}:</p>
            <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
              {review.providerReply}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card: Submitted Review — Grid Bento (~160px)
// ---------------------------------------------------------------------------

function SubmittedReviewCard({
  booking,
  review,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  review: ReviewItem
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-xl border shadow-2xs transition-all duration-200 hover:shadow-xs">
      <CardContent className="space-y-3 p-3.5 sm:p-4">
        {/* Header */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-11 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors sm:text-sm"
                >
                  {provider.name}
                </button>
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  Avaliado em {formatDate(review.createdAt)}
                </span>
              </div>

              <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              {/* Star Rating Display */}
              <div className="mt-1.5 flex items-center gap-1.5">
                <StarRatingDisplay value={review.rating} size={14} showCount={false} />
                <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10.5px] font-bold text-amber-700 tabular-nums dark:text-amber-400">
                  {review.rating.toFixed(1)} ★
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Comment Bubble */}
        {review.comment ? (
          <div className="border-border/40 bg-muted/30 text-foreground rounded-lg border p-2.5 text-xs leading-relaxed">
            <p className="text-foreground/90 whitespace-pre-line italic">
              &ldquo;{review.comment}&rdquo;
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs italic">
            Avaliação registrada sem comentário escrito.
          </p>
        )}

        {/* Provider Reply */}
        {review.providerReply && (
          <div className="border-primary/20 bg-primary/5 text-foreground rounded-lg border p-2.5 text-xs">
            <p className="text-primary font-semibold">Resposta de {provider.name}:</p>
            <p className="text-muted-foreground mt-0.5 leading-relaxed">{review.providerReply}</p>
          </div>
        )}

        {/* Actions Bar */}
        <div className="border-border/40 flex flex-wrap items-center gap-1.5 border-t pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onRebook()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg text-xs font-semibold"
          >
            <RotateCcw className="text-primary size-3" />
            Contratar novamente
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onViewProvider()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg text-xs font-medium"
          >
            <MapPin className="text-primary size-3" />
            Ver perfil
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg text-xs font-medium"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
            Mensagem
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
