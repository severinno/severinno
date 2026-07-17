"use client"

/**
 * Testimonials — social proof section showing real reviews from the database.
 *
 * Redesigned with Jakob Nielsen's 10 Usability Heuristics:
 *   H1 – Visibility: total count, avg rating hero number, loading skeletons, slide counter
 *   H2 – Match real world: conversational header, service type + context, star distribution bars
 *   H3 – User control: carousel with prev/next + dots, auto-play pause on hover, rating filter, slide X of Y
 *   H4 – Consistency: same card radius, star component, avatar style as provider cards
 *   H5 – Error prevention: graceful empty state, API error with retry
 *   H6 – Recognition: large quote icon with gradient bg, verified badge with shield, service badge, stars with glow
 *   H7 – Flexibility: swipeable mobile, keyboard arrows, filter chips, compact mobile layout
 *   H8 – Minimalism: 1 card mobile, 3 desktop, clean cards, focus on quote, gradient accent stripe
 *   H9 – Error recovery: empty state CTA, retry on error
 *   H10 – Help: "Avaliações verificadas" tooltip, verified badge explanation
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import Autoplay from "embla-carousel-autoplay"
import {
  Star,
  Quote,
  MessageSquare,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Info,
  ShieldCheck,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/format"
import { apiGet } from "@/lib/api"
import { useScrollReveal } from "@/hooks/use-animation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"

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

type RatingFilter = "all" | "5" | "4"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Testimonials({
  className,
}: {
  className?: string
}) {
  const { data, isLoading, isError, refetch } = useQuery<ReviewsResponse>({
    queryKey: ["vitrine-testimonials"],
    queryFn: () => apiGet<ReviewsResponse>("/api/reviews/recent?limit=6"),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })

  const reviews = data?.items ?? []
  const avgRating = data?.avgRating ?? 0
  const total = data?.total ?? 0
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  // Compute star distribution from reviews
  const starDistribution = React.useMemo(() => {
    const dist = [0, 0, 0, 0, 0] // index 0 = 1-star, index 4 = 5-star
    for (const r of reviews) {
      if (r.rating >= 1 && r.rating <= 5) {
        dist[r.rating - 1]++
      }
    }
    return dist
  }, [reviews])

  const maxDistCount = Math.max(...starDistribution, 1)

  // Rating filter
  const [ratingFilter, setRatingFilter] = React.useState<RatingFilter>("all")
  const filteredReviews = React.useMemo(() => {
    if (ratingFilter === "all") return reviews
    const n = Number(ratingFilter)
    return reviews.filter((r) => r.rating === n)
  }, [reviews, ratingFilter])

  // Carousel API
  const [api, setApi] = React.useState<CarouselApi>()
  const [current, setCurrent] = React.useState(0)
  const [count, setCount] = React.useState(0)

  // Autoplay plugin ref
  const autoplayRef = React.useRef(
    Autoplay({ delay: 5000, stopOnInteraction: true }),
  )

  // Pause/resume on hover
  const [isPaused, setIsPaused] = React.useState(false)
  const pauseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = React.useCallback(() => {
    setIsPaused(true)
    autoplayRef.current.stop()
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
  }, [])

  const handleMouseLeave = React.useCallback(() => {
    pauseTimerRef.current = setTimeout(() => {
      setIsPaused(false)
      autoplayRef.current.play()
    }, 300)
  }, [])

  // Sync carousel state
  React.useEffect(() => {
    if (!api) return
    setCount(api.scrollSnapList().length)
    setCurrent(api.selectedScrollSnap())
    const onSelect = () => setCurrent(api.selectedScrollSnap())
    api.on("select", onSelect)
    api.on("reInit", onSelect)
    return () => {
      api.off("select", onSelect)
    }
  }, [api])

  // Current slide index within filteredReviews (for "slide X of Y" counter)
  const visibleSlideNumber = current + 1
  const totalSlides = filteredReviews.length

  return (
    <section
      aria-label="Avaliações de clientes"
      className={cn(
        "relative overflow-hidden bg-muted/30",
        "mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8",
        className,
      )}
    >
      {/* Decorative background patterns */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Large quote watermark */}
        <div className="absolute top-6 left-8 text-emerald-100 dark:text-emerald-950/50">
          <Quote className="size-32" />
        </div>
        {/* Subtle dot grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* Gradient orb decoration */}
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-gradient-to-br from-emerald-100/40 to-teal-50/20 blur-3xl dark:from-emerald-950/30 dark:to-teal-950/20" />
        <div className="absolute -bottom-16 -left-16 size-72 rounded-full bg-gradient-to-tr from-amber-100/30 to-emerald-50/20 blur-3xl dark:from-amber-950/20 dark:to-emerald-950/10" />
      </div>

      <div
        ref={ref}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative"
      >
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mx-auto mb-8 max-w-2xl text-center"
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
              ? `${total} avaliações verificadas — nota média ${avgRating.toFixed(1)} de 5 estrelas.`
              : "Avaliações de clientes após a conclusão do serviço."}
          </p>
        </motion.header>

        {/* Summary stats + star distribution */}
        {total > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mb-8 mx-auto max-w-xl"
          >
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
              {/* Average rating hero — large & prominent */}
              <div className="flex flex-col items-center sm:items-end gap-1 shrink-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-5xl font-extrabold tabular-nums tracking-tighter bg-gradient-to-br from-emerald-600 to-teal-600 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-400">
                    {avgRating.toFixed(1)}
                  </span>
                  <span className="text-lg font-medium text-muted-foreground">/5</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "size-5 transition-all",
                        i < Math.round(avgRating)
                          ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.4)]"
                          : "fill-muted text-muted-foreground/30",
                      )}
                    />
                  ))}
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                        <ShieldCheck className="size-3.5 text-emerald-500" />
                        {total} avaliações verificadas
                        <Info className="size-3 opacity-50" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px]">
                      Avaliações verificadas são feitas apenas por clientes que
                      completaram o serviço com o prestador. Não aceitamos
                      avaliações anônimas ou de terceiros.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Star distribution bars (Amazon-style histogram) */}
              <div className="flex-1 w-full space-y-1">
                {[5, 4, 3, 2, 1].map((starVal) => {
                  const count = starDistribution[starVal - 1]
                  const pct = total > 0 ? (count / total) * 100 : 0
                  return (
                    <button
                      key={starVal}
                      onClick={() =>
                        setRatingFilter((prev) =>
                          prev === String(starVal) ? "all" : (String(starVal) as RatingFilter),
                        )
                      }
                      className={cn(
                        "group flex items-center gap-2 w-full rounded px-1 py-0.5 transition-colors text-left",
                        ratingFilter === String(starVal)
                          ? "bg-emerald-50 dark:bg-emerald-950/30"
                          : "hover:bg-muted/60",
                      )}
                      aria-label={`Filtrar por ${starVal} estrelas: ${count} avaliações`}
                    >
                      <span className="text-xs font-medium tabular-nums w-3 text-right shrink-0">
                        {starVal}
                      </span>
                      <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={visible ? { width: `${pct}%` } : { width: 0 }}
                          transition={{ duration: 0.6, delay: 0.2 + (5 - starVal) * 0.06 }}
                          className={cn(
                            "h-full rounded-full",
                            ratingFilter === String(starVal)
                              ? "bg-emerald-500"
                              : "bg-gradient-to-r from-amber-400 to-amber-500",
                          )}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right shrink-0">
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* Rating filter chips */}
        {reviews.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={visible ? { opacity: 1 } : {}}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="mb-6 flex items-center justify-center gap-2"
          >
            {(
              [
                { key: "all", label: "Todas" },
                { key: "5", label: "5 estrelas" },
                { key: "4", label: "4 estrelas" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => setRatingFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-all",
                  ratingFilter === f.key
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}
                aria-pressed={ratingFilter === f.key}
              >
                {f.label}
              </button>
            ))}
          </motion.div>
        )}

        {/* Loading state */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <ReviewSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : filteredReviews.length > 0 ? (
          /* Carousel */
          <div className="relative">
            <Carousel
              setApi={setApi}
              opts={{
                align: "start",
                loop: true,
              }}
              plugins={[autoplayRef.current]}
              className="w-full"
            >
              <CarouselContent className="-ml-4">
                {filteredReviews.map((review, idx) => (
                  <CarouselItem
                    key={review.id}
                    className="pl-4 basis-full sm:basis-1/2 lg:basis-1/3"
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 24 }}
                      animate={visible ? { opacity: 1, y: 0 } : {}}
                      transition={{ duration: 0.45, delay: idx * 0.06 }}
                      className="h-full"
                    >
                      <ReviewCard review={review} />
                    </motion.div>
                  </CarouselItem>
                ))}
              </CarouselContent>

              {/* Prev / Next arrows — circular with gradient */}
              <div className="pointer-events-none absolute inset-y-0 left-0 hidden items-center lg:flex">
                <button
                  className="pointer-events-auto -ml-3 size-11 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:scale-110 hover:shadow-xl hover:shadow-emerald-500/30 active:scale-95"
                  onClick={() => api?.scrollPrev()}
                  aria-label="Avaliação anterior"
                >
                  <ChevronLeft className="size-5" />
                </button>
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 hidden items-center lg:flex">
                <button
                  className="pointer-events-auto -mr-3 size-11 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:scale-110 hover:shadow-xl hover:shadow-emerald-500/30 active:scale-95"
                  onClick={() => api?.scrollNext()}
                  aria-label="Próxima avaliação"
                >
                  <ChevronRight className="size-5" />
                </button>
              </div>
            </Carousel>

            {/* Dot indicators + slide counter */}
            <div className="mt-6 flex flex-col items-center gap-2">
              {count > 1 && (
                <div
                  className="flex items-center justify-center gap-2"
                  role="tablist"
                  aria-label="Navegação do carrossel"
                >
                  {Array.from({ length: count }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => api?.scrollTo(i)}
                      className={cn(
                        "rounded-full transition-all duration-300",
                        i === current
                          ? "bg-emerald-500 h-3 w-6 shadow-sm shadow-emerald-500/30"
                          : "size-2 bg-muted-foreground/25 hover:bg-muted-foreground/50",
                      )}
                      role="tab"
                      aria-selected={i === current}
                      aria-label={`Ir para avaliação ${i + 1}`}
                    />
                  ))}
                </div>
              )}

              {/* Slide X of Y counter for accessibility */}
              {totalSlides > 0 && (
                <p
                  className="text-[11px] font-medium text-muted-foreground tabular-nums"
                  aria-live="polite"
                  aria-atomic
                >
                  {visibleSlideNumber} de {totalSlides}
                </p>
              )}
            </div>

            {/* Pause indicator */}
            <AnimatePresence>
              {isPaused && count > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Pausado — passe o mouse para pausar
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <EmptyTestimonials />
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
    <div className="group relative flex h-full flex-col gap-3 rounded-xl border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-emerald-200 dark:hover:border-emerald-800/50 overflow-hidden">
      {/* Left accent stripe — gradient border */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-400 via-teal-500 to-emerald-600 transition-all duration-300 group-hover:w-1.5 group-hover:from-emerald-300 group-hover:via-teal-400 group-hover:to-emerald-500"
      />

      <div className="flex flex-col gap-3 p-5 pl-6 sm:p-5 sm:pl-7">
        {/* Top row: Stars + Verified badge */}
        <div className="flex items-center justify-between gap-2">
          {/* Star rating with glow */}
          <div className="flex items-center gap-0.5">
            {stars.map((filled, i) => (
              <Star
                key={i}
                className={cn(
                  "size-4 transition-all duration-200",
                  filled
                    ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.35)] group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                    : "fill-muted text-muted-foreground/30",
                )}
              />
            ))}
          </div>

          {/* Verified review badge */}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50">
            <ShieldCheck className="size-3" />
            <span className="hidden sm:inline">Verificada</span>
          </span>
        </div>

        {/* Quote with large opening mark */}
        <div className="relative">
          <div
            aria-hidden
            className="absolute -top-2 -left-2 flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40"
          >
            <Quote className="size-5 text-emerald-500 dark:text-emerald-400" />
          </div>
          {review.comment ? (
            <p className="line-clamp-3 pl-10 text-sm italic leading-relaxed text-foreground/80">
              {review.comment}
            </p>
          ) : (
            <p className="pl-10 text-sm italic text-muted-foreground">
              Sem comentário escrito.
            </p>
          )}
        </div>

        {/* Service type badge */}
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
            <p className="truncate text-xs font-semibold">{review.clientName}</p>
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
// Error state with retry
// ---------------------------------------------------------------------------

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/30">
        <RefreshCw className="size-8 text-red-500" />
      </span>
      <h3 className="mt-4 text-base font-semibold">
        Não foi possível carregar as avaliações
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Ocorreu um erro ao buscar as avaliações. Tente novamente.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-4 gap-2"
      >
        <RefreshCw className="size-3.5" />
        Tentar novamente
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ReviewSkeleton() {
  return (
    <div className="relative flex flex-col gap-3 rounded-xl border bg-card p-5 pl-7 overflow-hidden">
      {/* Accent stripe skeleton */}
      <div className="absolute inset-y-0 left-0 w-1 bg-muted" />
      <div className="flex items-center justify-between">
        <div className="flex gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="size-4 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="flex items-start gap-2">
        <Skeleton className="size-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-5 w-24 rounded-full" />
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
