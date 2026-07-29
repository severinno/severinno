"use client"

/**
 * ProviderGeoAwarenessBadge — "X clientes ativos na sua região" card for the
 * provider dashboard.
 *
 * Helps the provider understand market demand in their service area:
 *   - With location configured: "12 solicitações ativas num raio de 50 km"
 *   - Without location: "Configure sua região para ver a demanda local"
 *   - Links to the provider's profile/settings on click
 *
 * Data is fetched once (60s stale time) via TanStack Query.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Navigation,
  MapPin,
  Loader2,
  X,
  Users,
  Settings,
} from "lucide-react"

import { fetchRegionDemand } from "@/lib/api"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_TIME = 60 * 1000 // 60 s
const GC_TIME = 5 * 60 * 1000 // 5 min
const REFETCH_INTERVAL = 2 * 60 * 1000 // 2 min — auto-refresh

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderGeoAwarenessBadge() {
  const navigate = useViewStore((s) => s.navigate)
  const [dismissed, setDismissed] = React.useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("severinno:provider:geo-badge-dismissed") === "true"
  })

  const handleDismiss = React.useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem("severinno:provider:geo-badge-dismissed", "true")
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
  }, [])

  const demandQuery = useQuery({
    queryKey: ["provider", "region-demand"],
    queryFn: fetchRegionDemand,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchInterval: REFETCH_INTERVAL,
  })

  const data = demandQuery.data
  const isLoading = demandQuery.isLoading
  const isFetched = demandQuery.isFetched
  const regionConfigured = data?.regionConfigured ?? false
  const total = data?.total ?? 0
  const radiusKm = data?.radiusKm

  if (dismissed) return null

  // ------------------------------------------------------------------
  // Derive visual state
  // ------------------------------------------------------------------
  const needsSetup = isFetched && !regionConfigured
  const hasDemand = isFetched && regionConfigured && total > 0
  const noDemand = isFetched && regionConfigured && total === 0

  // ------------------------------------------------------------------
  // Color scheme based on state
  // ------------------------------------------------------------------
  const scheme = (() => {
    if (hasDemand) return "emerald"
    if (noDemand) return "amber"
    if (needsSetup) return "blue"
    return "muted" // loading
  })()

  const borderColor = {
    emerald: "border-emerald-200 dark:border-emerald-900/40",
    amber: "border-amber-200 dark:border-amber-900/40",
    blue: "border-blue-200 dark:border-blue-900/40",
    muted: "border-muted",
  }[scheme]

  const bgGradient = {
    emerald:
      "bg-gradient-to-r from-emerald-50/80 to-background dark:from-emerald-950/20",
    amber:
      "bg-gradient-to-r from-amber-50/80 to-background dark:from-amber-950/20",
    blue:
      "bg-gradient-to-r from-blue-50/80 to-background dark:from-blue-950/20",
    muted: "",
  }[scheme]

  const iconBg = {
    emerald:
      "bg-emerald-100 text-emerald-700 ring-emerald-200/50 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800/30",
    amber:
      "bg-amber-100 text-amber-700 ring-amber-200/50 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-800/30",
    blue:
      "bg-blue-100 text-blue-700 ring-blue-200/50 dark:bg-blue-900/40 dark:text-blue-300 dark:ring-blue-800/30",
    muted: "bg-muted text-muted-foreground",
  }[scheme]

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-4 transition-all",
        borderColor,
        bgGradient,
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
            iconBg,
          )}
        >
          {needsSetup ? (
            <Settings className="size-5" />
          ) : (
            <Navigation className="size-5" />
          )}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <>
              <p className="text-foreground text-sm font-semibold">
                Analisando demanda na região…
              </p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Calculando solicitações ativas
              </p>
            </>
          ) : needsSetup ? (
            <>
              <p className="text-foreground text-sm font-semibold">
                Configure sua região de atendimento
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Defina sua localização e raio de atendimento para descobrir
                quantos clientes estão ativos perto de você.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("provider.settings")}
                  className="h-8 gap-1.5 border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/40 dark:text-blue-300"
                >
                  <MapPin className="size-3.5" />
                  Configurar região
                </Button>
              </div>
            </>
          ) : hasDemand ? (
            <button
              type="button"
              onClick={() => navigate("provider.agenda")}
              className="w-full text-left outline-none"
              aria-label="Ver solicitações"
            >
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                {total} solicitação
                {total !== 1 ? "ões" : ""} ativa
                {total !== 1 ? "s" : ""} na sua região
              </p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                <Users className="size-3 text-emerald-600" />
                {data!.bookings} agendamento
                {data!.bookings !== 1 ? "s" : ""} &middot; {data!.quotes}{" "}
                orçamento
                {data!.quotes !== 1 ? "s" : ""} pendente
                {data!.quotes !== 1 ? "s" : ""}
                {radiusKm != null && (
                  <>
                    {" "}
                    &middot; Raio de {radiusKm} km
                  </>
                )}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <Navigation className="size-2.5" />
                Clique para ver na agenda
              </p>
            </button>
          ) : noDemand ? (
            <button
              type="button"
              onClick={() => navigate("provider.settings")}
              className="w-full text-left outline-none"
              aria-label="Ajustar região"
            >
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Nenhuma solicitação ativa no momento
              </p>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                <MapPin className="size-3 text-amber-600" />
                {radiusKm != null && (
                  <>Raio de {radiusKm} km &middot; </>
                )}
                Amplie sua região ou configure seu endereço para alcançar
                mais clientes
              </p>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
