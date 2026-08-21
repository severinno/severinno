"use client"

/**
 * Testimonials — Real review cards from the API.
 * Clean carousel with minimal styling and autoplay hover guard.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import Autoplay from "embla-carousel-autoplay"
import { Star, Quote } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel"

type ReviewItem = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  clientName: string
  clientAvatar: string | null
  providerName: string
  serviceTitle: string
}

type ReviewsResponse = {
  items: ReviewItem[]
  total: number
  avgRating: number
}

export default function Testimonials({ className }: { className?: string }) {
  const { data, isLoading, isError } = useQuery<ReviewsResponse>({
    queryKey: ["vitrine-testimonials"],
    queryFn: () => apiGet<ReviewsResponse>("/api/reviews/recent?limit=9"),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })

  const [api, setApi] = React.useState<CarouselApi>()
  const [current, setCurrent] = React.useState(0)
  const [count, setCount] = React.useState(0)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoplayPlugin = React.useMemo(() => Autoplay({ delay: 4500, stopOnInteraction: true }), [])

  React.useEffect(() => {
    if (!api) return
    const updateState = () => {
      setCount(api.scrollSnapList().length)
      setCurrent(api.selectedScrollSnap())
    }
    updateState()
    api.on("select", updateState)
    return () => {
      api.off("select", updateState)
    }
  }, [api])

  const handleMouseEnter = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (api && autoplayPlugin) {
      try {
        autoplayPlugin.stop()
      } catch {
        // guard against uninitialized autoplay
      }
    }
  }, [api, autoplayPlugin])

  const handleMouseLeave = React.useCallback(() => {
    if (!api || !autoplayPlugin) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        autoplayPlugin.play()
      } catch {
        // guard against uninitialized autoplay
      }
    }, 300)
  }, [api, autoplayPlugin])

  if (isError) return null
  if (!isLoading && !data?.items?.length) return null

  return (
    <section className={cn("border-border/40 border-t bg-background py-20 sm:py-24", className)}>
      <div
        className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Header */}
        <div className="mx-auto mb-12 max-w-xl text-center">
          <p className="text-primary mb-3 text-xs font-semibold uppercase tracking-widest">
            Depoimentos
          </p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            O que dizem nossos clientes
          </h2>
          {!isLoading && data && (
            <p className="text-muted-foreground mt-3 text-sm">
              <span className="font-semibold text-foreground">{data.avgRating.toFixed(1)}</span> de
              média em {data.total.toLocaleString("pt-BR")} avaliações verificadas
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/50 bg-card p-5">
                <Skeleton className="mb-4 h-4 w-24" />
                <Skeleton className="mb-2 h-3 w-full" />
                <Skeleton className="mb-2 h-3 w-5/6" />
                <Skeleton className="h-3 w-4/6" />
                <div className="mt-5 flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div>
                    <Skeleton className="mb-1 h-3 w-20" />
                    <Skeleton className="h-2.5 w-28" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <Carousel
              opts={{ align: "start", loop: true }}
              plugins={[autoplayPlugin]}
              setApi={setApi}
              className="w-full"
            >
              <CarouselContent className="-ml-4">
                {data!.items.map((review) => (
                  <CarouselItem key={review.id} className="pl-4 sm:basis-1/2 lg:basis-1/3">
                    <ReviewCard review={review} />
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>

            {/* Dot navigation */}
            {count > 1 && (
              <div className="mt-6 flex items-center justify-center gap-1.5">
                {Array.from({ length: count }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => api?.scrollTo(i)}
                    aria-label={`Ir para slide ${i + 1}`}
                    className={cn(
                      "rounded-full transition-all",
                      i === current
                        ? "h-1.5 w-5 bg-primary"
                        : "size-1.5 bg-border hover:bg-muted-foreground",
                    )}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function ReviewCard({ review }: { review: ReviewItem }) {
  const initials = review.clientName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/50 bg-card p-5 transition-shadow hover:shadow-sm">
      {/* Stars */}
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={cn(
              "size-3.5",
              i < review.rating ? "fill-amber-400 text-amber-400" : "text-border",
            )}
          />
        ))}
      </div>

      {/* Quote */}
      <blockquote className="mt-3 flex-1">
        <Quote className="text-primary/20 mb-1 size-5" />
        <p className="text-muted-foreground line-clamp-4 text-sm leading-relaxed">
          {review.comment || "Excelente profissional, recomendo muito!"}
        </p>
      </blockquote>

      {/* Service badge */}
      <div className="mt-3">
        <span className="bg-primary/8 text-primary rounded-md px-2 py-0.5 text-[10px] font-medium">
          {review.serviceTitle}
        </span>
      </div>

      {/* Author */}
      <div className="border-border/40 mt-4 flex items-center gap-2.5 border-t pt-4">
        <Avatar className="size-8">
          <AvatarImage src={review.clientAvatar ?? undefined} alt={review.clientName} />
          <AvatarFallback className="bg-muted text-[11px] font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{review.clientName}</p>
          <p className="text-muted-foreground truncate text-[10px]">
            Serviço de {review.providerName} · {formatRelative(review.createdAt)}
          </p>
        </div>
      </div>
    </div>
  )
}
