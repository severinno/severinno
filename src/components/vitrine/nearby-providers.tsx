"use client"

/**
 * NearbyProviders — "Perto de você" section in the vitrine.
 *
 * Shown only when the user has shared their location (lat/lng).
 * Fetches up to 12 providers within 10 km sorted by distance.
 *
 * **Collapsed** (default): shows first 4 in a horizontal-scrollable row,
 * with a "Mostrar mais" card at the end that expands to the full grid.
 *
 * **Expanded**: shows all fetched providers in a responsive grid (3 cols)
 * with a "Mostrar menos" link to collapse back.
 *
 * Each card shows: avatar, name, rating, distance, and cheapest service price.
 * Click navigates to the provider profile modal.
 */

import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Navigation, Star, MapPin, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import Image from "next/image"

import { fetchProviders, type ProviderCard, type PagedResult } from "@/lib/api"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const NEARBY_RADIUS_KM = 10
const PAGE_SIZE = 12
const COLLAPSED_COUNT = 4

export default function NearbyProviders() {
  const { lat, lng, status } = useGeoStore()
  const openProvider = useUIStore((s) => s.openProvider)
  const [expanded, setExpanded] = React.useState(false)
  // Sentinel element for infinite scroll intersection
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)

  const hasLocation =
    status === "ready" &&
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)

  const nearbyQuery = useInfiniteQuery({
    queryKey: ["providers", "nearby", lat?.toFixed(3), lng?.toFixed(3)],
    queryFn: async ({ pageParam }) => {
      const result = await fetchProviders({
        lat: lat!,
        lng: lng!,
        radius: NEARBY_RADIUS_KM,
        sort: "distance",
        limit: PAGE_SIZE,
        cursor: pageParam as string | null | undefined,
      })
      return result
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: PagedResult<ProviderCard>) =>
      lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    enabled: hasLocation,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  // Accumulate all providers from all pages
  const providers = React.useMemo(
    () => nearbyQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [nearbyQuery.data],
  )

  const isLoading = nearbyQuery.isLoading
  const isFetchingNext = nearbyQuery.isFetchingNextPage
  const hasNext = !!nearbyQuery.hasNextPage
  const hasMore = providers.length > COLLAPSED_COUNT

  // When expanded, show all; when collapsed, show first COLLAPSED_COUNT
  const visibleProviders = expanded ? providers : providers.slice(0, COLLAPSED_COUNT)

  // ── Infinite scroll: IntersectionObserver on sentinel ───────────────
  // fetchNextPage é estável no objeto do query — destructure para a dep ser
  // a função estável, não o objeto nearbyQuery (que muda de identidade a cada
  // refetch e recriaria o observer desnecessariamente).
  const fetchNextPage = nearbyQuery.fetchNextPage
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el || !expanded || !hasNext || isFetchingNext) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasNext && !isFetchingNext) {
          fetchNextPage()
        }
      },
      { rootMargin: "200px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [expanded, hasNext, isFetchingNext, fetchNextPage])

  if (!hasLocation || (providers.length === 0 && !isLoading)) {
    return null
  }

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <Card className="to-background overflow-hidden border-emerald-100 bg-gradient-to-br from-emerald-50/70 dark:border-emerald-900/30 dark:from-emerald-950/20">
        <div className="p-5 sm:p-6">
          {/* Header */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/50 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800/30">
              <Navigation className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Prestadores perto de você</h2>
              <p className="text-muted-foreground text-xs">
                {expanded
                  ? `${providers.length} prestador${providers.length !== 1 ? "es" : ""} encontrado${providers.length !== 1 ? "s" : ""} num raio de ${NEARBY_RADIUS_KM} km`
                  : `Encontrados num raio de ${NEARBY_RADIUS_KM} km da sua localização`}
              </p>
            </div>
          </div>

          {/* Loading */}
          {isLoading ? (
            <div
              className={cn(
                "gap-3",
                expanded
                  ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                  : "flex overflow-x-auto pb-2",
              )}
            >
              {Array.from({ length: expanded ? 6 : COLLAPSED_COUNT }).map((_, i) => (
                <NearbyCardSkeleton key={i} />
              ))}
            </div>
          ) : expanded ? (
            /* === EXPANDED: responsive grid with infinite scroll === */
            <div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {providers.map((provider) => (
                  <NearbyCard key={provider.id} provider={provider} onSelect={openProvider} />
                ))}
              </div>

              {/* Sentinel for infinite scroll + loading indicator */}
              <div ref={sentinelRef} className="mt-4 flex items-center justify-center">
                {isFetchingNext ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Loader2 className="size-4 animate-spin text-emerald-600" />
                    Carregando mais prestadores…
                  </div>
                ) : !hasNext && providers.length > PAGE_SIZE ? (
                  <span className="text-muted-foreground text-[10px]">
                    Todos os {providers.length} prestadores carregados
                  </span>
                ) : null}
              </div>

              {/* Collapse button */}
              <div className="mt-4 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(false)}
                  className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
                >
                  <ChevronUp className="size-3.5" />
                  Mostrar menos
                </Button>
              </div>
            </div>
          ) : (
            /* === COLLAPSED: horizontal scroll === */
            <div>
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
                {visibleProviders.map((provider) => (
                  <NearbyCard key={provider.id} provider={provider} onSelect={openProvider} />
                ))}

                {/* "Mostrar mais" card — only if there are more providers */}
                {hasMore ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    aria-label={`Mostrar mais ${providers.length - COLLAPSED_COUNT} prestadores`}
                    className="group flex min-w-[160px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-emerald-200/50 bg-emerald-50/30 p-4 text-center transition-all hover:border-emerald-300 hover:bg-emerald-100/40 hover:shadow-sm dark:border-emerald-800/30 dark:bg-emerald-950/20 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors group-hover:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:group-hover:bg-emerald-800/50">
                      <ChevronDown className="size-5" />
                    </span>
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Mostrar mais
                    </span>
                    <span className="text-muted-foreground text-xs">
                      +{providers.length - COLLAPSED_COUNT} prestador
                      {providers.length - COLLAPSED_COUNT !== 1 ? "es" : ""}
                    </span>
                  </button>
                ) : null}
              </div>

              {/* Total count hint */}
              {providers.length <= COLLAPSED_COUNT && providers.length > 1 ? (
                <p className="text-muted-foreground mt-2 text-center text-xs">
                  {providers.length} prestador{providers.length !== 1 ? "es" : ""} encontrado
                  {providers.length !== 1 ? "s" : ""} nesta região
                </p>
              ) : null}
            </div>
          )}
        </div>
      </Card>
    </section>
  )
}

// ---------------------------------------------------------------------------
// NearbyCard — individual provider card (used in both collapsed & expanded)
// ---------------------------------------------------------------------------

function NearbyCard({
  provider,
  onSelect,
}: {
  provider: ProviderCard
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(provider.id)}
      aria-label={`Ver perfil de ${provider.name}`}
      className="group bg-card flex min-w-[200px] shrink-0 flex-col rounded-xl border border-emerald-200/60 p-3 text-left transition-all hover:border-emerald-300 hover:shadow-md dark:border-emerald-800/30 dark:hover:border-emerald-700"
    >
      {/* Avatar + name row */}
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          {provider.avatarUrl ? (
            <Image
              src={provider.avatarUrl}
              alt={provider.name}
              width={36}
              height={36}
              className="size-9 rounded-full object-cover ring-2 ring-emerald-500/20"
            />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              {provider.name.charAt(0).toUpperCase()}
            </div>
          )}
          {provider.verified && (
            <span className="ring-background absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-[7px] text-white ring-1">
              ✓
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold transition-colors group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
            {provider.name}
          </p>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            <span className="text-foreground font-medium">
              {provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}
            </span>
            <span>·</span>
            <span>{provider.reviewCount} aval.</span>
          </div>
        </div>
      </div>

      {/* Distance + 'Perto de você' badge */}
      <div className="mt-2 flex items-center gap-1 text-xs">
        <MapPin className="size-3 text-emerald-600" />
        {typeof provider.distanceKm === "number" ? (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            {provider.distanceKm < 1
              ? `${Math.round(provider.distanceKm * 1000)} m`
              : `${provider.distanceKm.toFixed(1)} km`}
          </span>
        ) : (
          <span className="text-muted-foreground">Distância desconhecida</span>
        )}
        {provider.radiusKm != null &&
        typeof provider.distanceKm === "number" &&
        provider.distanceKm >= 0 &&
        provider.distanceKm <= provider.radiusKm ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <Navigation className="size-2.5" />
            Perto
          </span>
        ) : null}
      </div>

      {/* First service price */}
      {provider.services?.[0] && (
        <div className="mt-2 flex items-center justify-between border-t border-emerald-100/60 pt-2 dark:border-emerald-900/20">
          <span className="text-muted-foreground truncate text-[11px]">
            {provider.services[0].title}
          </span>
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
            {formatBRL(provider.services[0].basePrice)}
          </span>
        </div>
      )}

      {/* Hover hint */}
      <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-emerald-400">
        <Navigation className="size-3" />
        Ver perfil
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NearbyCardSkeleton() {
  return (
    <div className="flex min-w-[200px] shrink-0 flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
      </div>
      <Skeleton className="h-3 w-14 rounded" />
      <div className="border-t pt-2">
        <Skeleton className="h-3 w-28 rounded" />
      </div>
    </div>
  )
}
