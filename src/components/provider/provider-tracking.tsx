"use client"

/**
 * ProviderTrackingPanel — live-location broadcasting controls for a single
 * booking (provider side).
 *
 * The provider starts a geolocation watch (useGeoTracking) that throttles
 * `tracking:position` emissions every 5s through the realtime mini-service,
 * which relays them to the client's socket room (`user:{clientId}`). The
 * client watches them on /tracking/[id].
 *
 * This is a *presentational* component: the parent owns the single
 * useGeoTracking instance (one active watch app-wide) and passes state +
 * callbacks down, so multiple IN_PROGRESS rows can share one tracking session.
 */

import { Loader2, Navigation, Radio, Share2, Square, WifiOff } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = {
  bookingId: string
  clientName: string
  /** Whether this booking is the one currently being tracked. */
  isTracking: boolean
  /** Realtime socket connected (needed to relay positions to the client). */
  isConnected: boolean
  /** Latest broadcast coordinates [lng, lat] (MapLibre order). */
  currentPosition: [number, number] | null
  error: string | null
  onStart: () => void
  onStop: () => void
}

export function ProviderTrackingPanel({
  bookingId,
  clientName,
  isTracking,
  isConnected,
  currentPosition,
  error,
  onStart,
  onStop,
}: Props) {
  const copyTrackingLink = async () => {
    const url = `${window.location.origin}/tracking/${bookingId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // clipboard unavailable — ignore, button is a convenience
    }
  }

  const [lng, lat] = currentPosition ?? [null, null]

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        isTracking
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "border-border bg-muted/20",
      )}
    >
      {/* Header: title + connection status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio
            className={cn(
              "size-4",
              isTracking ? "animate-pulse text-emerald-600" : "text-muted-foreground",
            )}
          />
          <p className="text-xs font-semibold">Rastreamento ao vivo</p>
        </div>
        {isConnected ? (
          <Badge className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Conectado
          </Badge>
        ) : (
          <Badge className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <WifiOff className="size-2.5" />
            Offline
          </Badge>
        )}
      </div>

      {error ? (
        <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {isTracking ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Sua localização está sendo enviada para{" "}
            <span className="font-medium text-foreground">{clientName}</span> a
            cada 5 segundos.
          </p>
          <div className="mt-2 flex items-center gap-2 rounded-md bg-background/80 px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-muted-foreground">
            <Navigation className="size-3 text-emerald-600" />
            {typeof lat === "number" && typeof lng === "number"
              ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
              : "aguardando posição…"}
            <Loader2 className="size-3 animate-spin" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              className="h-8 gap-1.5 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Square className="size-3.5" />
              Parar rastreamento
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyTrackingLink}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <Share2 className="size-3.5" />
              Copiar link do cliente
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Ao iniciar, o cliente poderá acompanhar sua chegada em tempo real.
          </p>
          <div className="mt-3">
            <Button
              size="sm"
              onClick={onStart}
              disabled={!isConnected}
              className="h-8 gap-1.5 bg-emerald-600 px-2.5 text-xs hover:bg-emerald-700"
            >
              <Radio className="size-3.5" />
              Iniciar rastreamento
            </Button>
            {!isConnected && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Conecte-se ao serviço em tempo real para habilitar.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ProviderTrackingPanel
