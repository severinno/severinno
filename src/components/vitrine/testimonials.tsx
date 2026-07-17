"use client"

/**
 * Testimonials — social proof section showing real reviews from the database.
 *
 * Pulls recent completed bookings with reviews and displays them as
 * testimonial cards with ratings, quotes, and provider attribution.
 *
 * Layout: responsive grid with avatar + star rating + quote + attribution.
 * Falls back to a placeholder when no reviews are available.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Star, Quote, MessageSquare, Loader2 } from "lucide-react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/format"
import { apiGet } from "@/lib/api"
import { useScrollReveal } from "@/hooks/use-animation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReviewItem = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  clientName: string
  clientAvatar: string | null
  providerName: string
  providerAvatar: string | null
  serviceTitle: string
}

type ReviewsResponse = {
  items: ReviewItem[]
  total: number
  avgRating: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Testimonials({
  className,
}: {
  className?: string
}) {
  const { data, isLoading } = useQuery<ReviewsResponse>({
    queryKey: ["vitrine-testimonials"],
    queryFn: () => apiGet<ReviewsResponse>("/api/reviews/recent?limit=6"),
    staleTime: 5 * 60 * 1000,
  })

  const reviews = data?.items ?? []
  const avgRating = data?.avgRating ?? 0
  const total = data?.total ?? 0
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  return (
    <section
      aria-label="Avaliações de clientes"
      className={cn(
        "relative overflow-hidden bg-muted/30",
        "mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8",
        className,
      )}
    >
      {/* Decorative quote icon */}
      <div
        aria-hidden
        className="absolute top-6 left-8 text-emerald-100 dark:text-emerald-950/50"
      >
        <Quote className="size-32" />
      </div>

      <div ref={ref} className="relative">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mx-auto mb-10 max-w-2xl text-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800/50">
            <Star className="size-3.5 fill-amber-500 text-amber-500" />
            Avaliações reais
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            O que nossos clientes dizem
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            {total > 0
              ? `${total} avaliações de clientes reais — nota média ${avgRating.toFixed(1)} de 5 estrelas.`
              : "Avaliações de clientes após a conclusão do serviço."}
          </p>
        </motion.header>

        {/* Reviews grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <ReviewSkeleton key={i} />
            ))}
          </div>
        ) : reviews.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((review, idx) => (
              <motion.div
                key={review.id}
                initial={{ opacity: 0, y: 24 }}
                animate={visible ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.45, delay: idx * 0.08 }}
              >
                <ReviewCard review={review} />
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyTestimonials />
        )}

        {/* Summary bar */}
        {reviews.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={cn(
                      "size-5",
                      i < Math.round(avgRating)
                        ? "fill-amber-400 text-amber-400"
                        : "fill-muted text-muted",
                    )}
                  />
                ))}
              </div>
              <span className="text-lg font-bold">{avgRating.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">
                de 5 estrelas
              </span>
            </div>
            <div className="hidden h-6 w-px bg-border sm:block" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MessageSquare className="size-4 text-emerald-500" />
              <span>
                Baseado em <strong className="text-foreground">{total}</strong> avaliações verificadas
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Review card
// ---------------------------------------------------------------------------

function ReviewCard({ review }: { review: ReviewItem }) {
  const stars = Array.from({ length: 5 }).map((_, i) => i < review.rating)

  return (
    <div className="group flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md dark:hover:border-emerald-800/50">
      {/* Star rating */}
      <div className="flex items-center gap-0.5">
        {stars.map((filled, i) => (
          <Star
            key={i}
            className={cn(
              "size-4",
              filled
                ? "fill-amber-400 text-amber-400"
                : "fill-muted text-muted-foreground/30",
            )}
          />
        ))}
      </div>

      {/* Quote */}
      {review.comment ? (
        <p className="line-clamp-3 text-sm leading-relaxed text-foreground/80">
          &ldquo;{review.comment}&rdquo;
        </p>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          Sem comentário escrito.
        </p>
      )}

      {/* Service badge */}
      <Badge
        variant="secondary"
        className="w-fit bg-emerald-50 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        {review.serviceTitle}
      </Badge>

      {/* Attribution */}
      <div className="mt-auto flex items-center gap-2.5 border-t pt-3">
        <Avatar className="size-8 ring-1 ring-border">
          {review.clientAvatar ? (
            <AvatarImage src={review.clientAvatar} alt={review.clientName} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
            {review.clientName
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {review.clientName}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatRelative(new Date(review.createdAt))}
          </p>
        </div>
        {/* Provider mini attribution */}
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>para</span>
          <Avatar className="size-5">
            {review.providerAvatar ? (
              <AvatarImage
                src={review.providerAvatar}
                alt={review.providerName}
              />
            ) : null}
            <AvatarFallback className="size-5 bg-emerald-100 text-[8px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              {review.providerName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[6rem] truncate font-medium">
            {review.providerName}
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyTestimonials() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="size-8 text-muted-foreground" />
      </span>
      <h3 className="mt-4 text-base font-semibold">
        Ainda não há avaliações
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Assim que os primeiros serviços forem concluídos, as avaliações dos
        clientes aparecerão aqui.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="size-4 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="mt-1 h-5 w-24 rounded-full" />
      <div className="flex items-center gap-2.5 border-t pt-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-14" />
        </div>
      </div>
    </div>
  )
}
