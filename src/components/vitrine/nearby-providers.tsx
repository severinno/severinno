"use client"

/**
 * NearbyProviders — "Perto de você" section in the vitrine.
 *
 * Shown only when the user has shared their location (lat/lng).
 * Fetches up to 4 providers within 10 km sorted by distance and renders
 * them as a horizontal-scrollable row of compact cards.
 *
 * Each card shows: avatar, name, rating, distance, and cheapest service price.
 * Click navigates to the provider profile modal.
 *
 * Nielsen heuristics:
 *   H6  Recognition > recall → shows relevant providers without asking
 *   H7  Efficiency → 1 click to open a nearby provider's profile
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigation, Star, MapPin } from "lucide-react"
import Image from "next/image"

import { fetchProviders, type ProviderCard } from "@/lib/api"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const NEARBY_RADIUS_KM = 10
const NEARBY_LIMIT = 4

export default function NearbyProviders() {
  const { lat, lng, status } = useGeoStore()
  const openProvider = useUIStore((s) => s.openProvider)

  const hasLocation =
    status === "ready" &&
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)

  const nearbyQuery = useQuery({
    queryKey: ["providers", "nearby", lat?.toFixed(3), lng?.toFixed(3)],
    queryFn: () =>
      fetchProviders({
        lat: lat!,
        lng: lng!,
        radius: NEARBY_RADIUS_KM,
        sort: "distance",
        limit: NEARBY_LIMIT,
      }),
    enabled: hasLocation,
    staleTime: 60 * 1000, // 1 min
  })

  const providers = nearbyQuery.data?.items ?? []

  if (!hasLocation || (providers.length === 0 && !nearbyQuery.isLoading)) {
    return null
  }

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <Card className="overflow-hidden border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-background dark:border-emerald-900/30 dark:from-emerald-950/20">
        <div className="p-5 sm:p-6">
          {/* Header */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/50 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800/30">
              <Navigation className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                Prestadores perto de você
              </h2>
              <p className="text-xs text-muted-foreground">
                Encontrados num raio de {NEARBY_RADIUS_KM} km da sua localização
              </p>
            </div>
          </div>

          {/* Loading */}
          {nearbyQuery.isLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {Array.from({ length: NEARBY_LIMIT }).map((_, i) => (
                <NearbyCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            /* Horizontal scrollable cards */
            <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => openProvider(provider.id)}
                  aria-label={`Ver perfil de ${provider.name}`}
                  className="group flex min-w-[200px] shrink-0 flex-col rounded-xl border border-emerald-200/60 bg-card p-3 text-left transition-all hover:border-emerald-300 hover:shadow-md dark:border-emerald-800/30 dark:hover:border-emerald-700"
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
                        <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-[7px] text-white ring-1 ring-background">
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-tight group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                        {provider.name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                        <span className="font-medium text-foreground">
                          {provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}
                        </span>
                        <span>·</span>
                        <span>{provider.reviewCount} aval.</span>
                      </div>
                    </div>
                  </div>

                  {/* Distance */}
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
                  </div>

                  {/* First service price */}
                  {provider.services?.[0] && (
                    <div className="mt-2 flex items-center justify-between border-t border-emerald-100/60 pt-2 dark:border-emerald-900/20">
                      <span className="truncate text-[11px] text-muted-foreground">
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
              ))}
            </div>
          )}
        </div>
      </Card>
    </section>
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
