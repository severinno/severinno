"use client"

/**
 * GeoAwarenessBadge — "X prestadores num raio de Y km" card for the client
 * dashboard.
 *
 * Shows a compact, dismissible card that:
 *   - With GPS: "12 prestadores encontrados num raio de 50 km"
 *   - Without GPS: "Compartilhe sua localização para encontrar prestadores
 *     perto de você"
 *   - Links to the vitrine on click
 *
 * Location data is fetched once (60s stale time) and cached via TanStack Query.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Navigation, MapPin, Loader2, X } from "lucide-react"

import { fetchProviders } from "@/lib/api"
import { useGeoStore } from "@/store/geo"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const AWARENESS_RADIUS_KM = 50

export default function GeoAwarenessBadge() {
  const { lat, lng, status, setFromGPS } = useGeoStore()
  const navigate = useViewStore((s) => s.navigate)
  const [dismissed, setDismissed] = React.useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("severinno:client:geo-badge-dismissed") === "true"
  })

  const handleDismiss = React.useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem("severinno:client:geo-badge-dismissed", "true")
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
  }, [])

  const hasLocation =
    status === "ready" &&
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)

  const nearbyQuery = useQuery({
    queryKey: [
      "geo-awareness",
      hasLocation ? lat!.toFixed(3) : null,
      hasLocation ? lng!.toFixed(3) : null,
    ],
    queryFn: () =>
      fetchProviders({
        lat: lat!,
        lng: lng!,
        sort: "distance",
        radius: AWARENESS_RADIUS_KM,
        limit: 1, // minimal payload – we only need total
      }),
    enabled: hasLocation,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  const providerCount = nearbyQuery.data?.total ?? 0
  const isLoading = nearbyQuery.isLoading
  const hasProviders = providerCount > 0
  const ready = !nearbyQuery.isLoading && nearbyQuery.isFetched

  if (dismissed) return null

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-4 transition-all",
        hasProviders
          ? "to-background border-emerald-200 bg-gradient-to-r from-emerald-50/80 dark:border-emerald-900/40 dark:from-emerald-950/20"
          : hasLocation
            ? "to-background border-amber-200 bg-gradient-to-r from-amber-50/80 dark:border-amber-900/40 dark:from-amber-950/20"
            : "to-background border-blue-200 bg-gradient-to-r from-blue-50/80 dark:border-blue-900/40 dark:from-blue-950/20",
      )}
    >
      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="text-muted-foreground/60 hover:bg-muted hover:text-foreground absolute top-2 right-2 flex size-5 items-center justify-center rounded-full transition-colors"
        aria-label="Dispensar"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 sm:items-center">
        {/* Icon */}
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
            hasProviders
              ? "bg-emerald-100 text-emerald-700 ring-emerald-200/50 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800/30"
              : hasLocation
                ? "bg-amber-100 text-amber-700 ring-amber-200/50 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-800/30"
                : "bg-blue-100 text-blue-700 ring-blue-200/50 dark:bg-blue-900/40 dark:text-blue-300 dark:ring-blue-800/30",
          )}
        >
          <Navigation className="size-5" />
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {!hasLocation ? (
            <>
              <p className="text-foreground text-sm font-semibold">
                Encontre prestadores perto de você
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Compartilhe sua localização para descobrir prestadores verificados na sua região.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await setFromGPS()
                  }}
                  className="h-8 gap-1.5 border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/40 dark:text-blue-300"
                >
                  <MapPin className="size-3.5" />
                  Compartilhar localização
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("vitrine")}
                  className="text-muted-foreground hover:text-foreground h-8 gap-1.5 text-xs"
                >
                  Ver vitrine
                </Button>
              </div>
            </>
          ) : isLoading ? (
            <>
              <p className="text-foreground text-sm font-semibold">
                Buscando prestadores na sua região…
              </p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Procurando num raio de {AWARENESS_RADIUS_KM} km
              </p>
            </>
          ) : ready && hasProviders ? (
            <button
              type="button"
              onClick={() => navigate("vitrine")}
              className="w-full text-left outline-none"
              aria-label="Ver prestadores na vitrine"
            >
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                {providerCount} prestador
                {providerCount !== 1 ? "es" : ""} encontrado
                {providerCount !== 1 ? "s" : ""} num raio de {AWARENESS_RADIUS_KM} km
              </p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                <Navigation className="size-3 text-emerald-600" />
                Clique para ver na vitrine
              </p>
            </button>
          ) : ready && !hasProviders ? (
            <button
              type="button"
              onClick={() => navigate("vitrine")}
              className="w-full text-left outline-none"
              aria-label="Ver vitrine"
            >
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Nenhum prestador encontrado num raio de {AWARENESS_RADIUS_KM} km
              </p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                Aumente o raio de busca ou clique para ver todos os prestadores
              </p>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
