"use client"

/**
 * ProviderSpotlightGeo — Seção de destaque para prestadores próximos ao usuário.
 *
 * Exibe até 3 prestadores mais próximos (< 100km) em cards destacados com
 * gradiente e badge "Perto de você" quando o usuário tem GPS ativo.
 *
 * Integra-se com o fluxo da vitrine: fica entre o hero/topbar e os resultados
 * principais, servindo como call-to-action geográfico.
 *
 * Data source: GET /api/providers?sort=distance&radius=100&limit=3
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { MapPin, Navigation, Star, Loader2, ChevronRight, Wrench } from "lucide-react"

import { fetchProviders, type ProviderCard } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"

type Props = {
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
  className?: string
}

export default function ProviderSpotlightGeo({ onQuote, onBook, onView, className }: Props) {
  const { lat, lng, status } = useGeoStore()
  const hasLocation = status === "ready" && lat != null && lng != null

  const nearbyQuery = useQuery({
    queryKey: [
      "geo-spotlight",
      hasLocation ? lat!.toFixed(3) : null,
      hasLocation ? lng!.toFixed(3) : null,
    ],
    queryFn: () =>
      fetchProviders({
        lat: hasLocation ? lat! : undefined,
        lng: hasLocation ? lng! : undefined,
        sort: "distance",
        radius: 100,
        limit: 3,
      }),
    enabled: hasLocation,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Don't render anything if no location or no results
  if (!hasLocation) return null

  const providers = nearbyQuery.data?.items ?? []
  if (providers.length === 0 && !nearbyQuery.isLoading) return null

  // Derive the cheapest service for price display
  const cheapestPrice = (p: ProviderCard) => {
    if (!p.services?.length) return null
    return p.services.reduce((min, s) => (s.basePrice < min.basePrice ? s : min), p.services[0])
      .basePrice
  }

  return (
    <section
      className={cn(
        "dark:via-background relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/80 via-white to-emerald-100/30 dark:from-emerald-950/30 dark:to-emerald-900/10",
        className,
      )}
      aria-label="Prestadores próximos a você"
    >
      {/* Subtle decorative elements */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-emerald-400/5 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-8 -left-8 size-32 rounded-full bg-emerald-500/5 blur-2xl"
      />

      <div className="relative px-5 py-4 sm:px-6 sm:py-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <Navigation className="size-4" />
            </span>
            <div>
              <h2 className="text-foreground text-sm font-semibold">Prestadores próximos</h2>
              <p className="text-muted-foreground text-xs">
                {nearbyQuery.isLoading
                  ? "Buscando na sua região…"
                  : `${providers.length} prestador${providers.length !== 1 ? "es" : ""} perto de você`}
              </p>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {nearbyQuery.isLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="dark:bg-card min-w-[240px] flex-1 rounded-xl border bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="mt-3 h-3 w-32" />
                <div className="mt-3 flex gap-2">
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="h-8 flex-1 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Provider cards — carousel on mobile, grid on desktop */
          <div className="hidden sm:grid sm:grid-cols-3 sm:gap-3">
            {providers.map((provider) => (
              <SpotlightCard
                key={provider.id}
                provider={provider}
                cheapestPrice={cheapestPrice(provider)}
                onQuote={onQuote}
                onBook={onBook}
                onView={onView}
              />
            ))}
          </div>
        )}

        {/* Mobile carousel */}
        {!nearbyQuery.isLoading && providers.length > 0 && (
          <div className="sm:hidden">
            <Carousel
              opts={{
                align: "start",
                loop: false,
              }}
              className="w-full"
            >
              <CarouselContent className="-ml-2">
                {providers.map((provider) => (
                  <CarouselItem key={provider.id} className="basis-[85%] pl-2">
                    <SpotlightCard
                      provider={provider}
                      cheapestPrice={cheapestPrice(provider)}
                      onQuote={onQuote}
                      onBook={onBook}
                      onView={onView}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
              <div className="mt-2 flex justify-center gap-1.5">
                <CarouselPrevious className="static size-7 translate-y-0" />
                <CarouselNext className="static size-7 translate-y-0" />
              </div>
            </Carousel>
          </div>
        )}

        {/* Distance hint at the bottom */}
        {providers.length > 0 && !nearbyQuery.isLoading ? (
          <p className="text-muted-foreground mt-3 text-center text-[11px]">
            <MapPin className="mr-0.5 inline size-3 align-text-top text-emerald-600" />
            Mostrando prestadores num raio de até 100 km da sua localização
          </p>
        ) : null}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SpotlightCard — individual provider card in the spotlight section
// ---------------------------------------------------------------------------

function SpotlightCard({
  provider,
  cheapestPrice,
  onQuote,
  onBook,
  onView,
}: {
  provider: ProviderCard
  cheapestPrice: number | null
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
}) {
  const initials = provider.name
    ? provider.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "P"

  const isNearby =
    typeof provider.distanceKm === "number" &&
    provider.distanceKm >= 0 &&
    (provider.radiusKm != null ? provider.distanceKm <= provider.radiusKm : provider.distanceKm < 2)

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-white p-3.5 shadow-sm transition-all duration-200",
        "hover:border-emerald-200 hover:shadow-md",
        isNearby && "ring-1 ring-emerald-400/30",
      )}
    >
      {/* Nearby badge */}
      {isNearby ? (
        <Badge
          variant="outline"
          className="absolute -top-2 -right-2 border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 shadow-sm"
        >
          <Navigation className="mr-0.5 size-3" />
          Perto de você
        </Badge>
      ) : null}

      {/* Header: avatar + name + rating */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onView?.(provider.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-label={`Ver perfil de ${provider.name}`}
        >
          <Avatar className="size-10 shrink-0 rounded-md">
            {provider.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="rounded-md bg-emerald-100 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium transition-colors group-hover:text-emerald-700">
              {provider.name}
            </p>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              {typeof provider.distanceKm === "number" ? (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="size-3 text-emerald-600" />
                  {formatDistance(provider.distanceKm)}
                </span>
              ) : null}
              {provider.city ? <span className="truncate">· {provider.city}</span> : null}
            </div>
          </div>
        </button>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
          title="Avaliação"
        >
          <Star className="size-3.5 fill-amber-400 text-amber-400" />
          {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
        </span>
      </div>

      {/* Price hint */}
      {cheapestPrice !== null ? (
        <p className="text-muted-foreground mt-2 text-xs">
          a partir de{" "}
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            {formatBRL(cheapestPrice)}
          </span>
        </p>
      ) : null}

      {/* Actions */}
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onQuote?.(provider.id)}
          className="h-8 flex-1 gap-1 text-xs"
        >
          <Wrench className="size-3" />
          Orçamento
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onBook?.(provider.id)}
          className="h-8 flex-1 gap-1 text-xs"
        >
          Agendar
          <ChevronRight className="size-3" />
        </Button>
      </div>
    </div>
  )
}
