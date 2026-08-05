"use client"

/**
 * ClientReviews — list of all reviews the client has given.
 *
 * Polish (Nielsen + trust/transparency):
 *  - Page header (text-2xl font-bold) with summary subtitle.
 *  - Summary card: "Você avaliou X serviços" + average rating given.
 *  - Review cards: provider (avatar+name), service title, StarRatingDisplay,
 *    comment, date — ordered by most recent first.
 *  - Friendly empty state with CTA to browse completed bookings.
 *
 * Reviews are immutable for the MVP.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, MessageSquareQuote, Star } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { EmptyState, StatCard } from "@/components/shared/dashboard-shell"
import { PageHeader, StatusBadge } from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReviewRow = {
  id: string
  rating: number
  comment?: string | null
  createdAt: string
  provider: { id: string; name: string; avatarUrl?: string | null }
  service: { id: string; title: string }
}

type BookingsForReviewsResponse = {
  items: Array<{
    id: string
    status: string
    service: { id: string; title: string }
    provider: { id: string; name: string; avatarUrl?: string | null }
    reviews?: Array<{
      id: string
      rating: number
      comment?: string | null
      createdAt: string
    }>
  }>
  total: number
}

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

export function ClientReviews() {
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)

  // Derive reviews from the COMPLETED bookings list (each booking has a
  // `reviews` array — at most one per booking per MVP).
  const query = useQuery<BookingsForReviewsResponse>({
    queryKey: ["bookings", "CLIENT", "reviews-history"],
    queryFn: () =>
      apiGet<BookingsForReviewsResponse>("/api/bookings", {
        role: "CLIENT",
        status: "COMPLETED",
        page: 1,
        limit: 50,
      }),
  })

  const reviews = React.useMemo<ReviewRow[]>(() => {
    const list: ReviewRow[] = []
    for (const b of query.data?.items ?? []) {
      for (const r of b.reviews ?? []) {
        list.push({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          provider: b.provider,
          service: b.service,
        })
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [query.data])

  const avgRating = React.useMemo(() => {
    if (reviews.length === 0) return 0
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0)
    return sum / reviews.length
  }, [reviews])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Avaliações"
        subtitle="Histórico das avaliações que você enviou aos prestadores."
      />

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          icon={MessageSquareQuote}
          label="Serviços avaliados"
          value={reviews.length}
          tone="primary"
          hint={reviews.length === 0 ? "Avaliações ajudam a comunidade" : "Obrigado por contribuir"}
        />
        <StatCard
          icon={Star}
          label="Nota média dada"
          value={reviews.length === 0 ? "—" : `${avgRating.toFixed(1)} ★`}
          tone="amber"
          hint={
            reviews.length === 0
              ? "Sem avaliações ainda"
              : `De ${reviews.length} serviço${reviews.length !== 1 ? "s" : ""}`
          }
        />
      </div>

      {/* List */}
      {query.isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
          <Loader2 className="size-5 animate-spin" />
          Carregando avaliações…
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={Star}
          title="Você ainda não avaliou nenhum serviço"
          description="Avaliações ajudam outros clientes a encontrarem bons profissionais e reconhecem o trabalho dos prestadores. Quando você concluir um serviço, avalie-o aqui."
          action={
            <Button onClick={() => navigate("client.bookings")} className="mt-2 gap-2">
              Ver agendamentos
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} onViewProvider={() => openProvider(r.provider.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReviewCard
// ---------------------------------------------------------------------------

function ReviewCard({ review, onViewProvider }: { review: ReviewRow; onViewProvider: () => void }) {
  const provider = review.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="rounded-xl shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="py-4">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={onViewProvider}
                className="hover:text-primary truncate text-sm font-semibold focus-visible:underline"
              >
                {provider.name}
              </button>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatDate(review.createdAt)}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-sm">{review.service.title}</p>

            <div className="mt-2">
              <StarRatingDisplay value={review.rating} size={16} showCount={false} />
            </div>

            {review.comment ? (
              <p className="text-foreground/80 mt-2 text-sm whitespace-pre-line">
                {review.comment}
              </p>
            ) : (
              <p className="text-muted-foreground mt-2 text-xs italic">Sem comentário.</p>
            )}

            <StatusBadge tone="zinc" className="mt-3 text-[10px]">
              Avaliação imutável (MVP)
            </StatusBadge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
