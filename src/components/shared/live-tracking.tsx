"use client"

/**
 * LiveTracking — Real-time tracking component for clients to follow
 * their provider's journey via SSE + Leaflet map.
 *
 * Features:
 *   - Real-time map with provider marker (animated movement)
 *   - Destination marker with geofence circle (200m)
 *   - Route polyline (provider → destination)
 *   - ETA display with live updates
 *   - Journey status timeline (A Caminho → Chegando → No Local → etc.)
 *   - SSE connection to /api/tracking/[id]/stream
 *   - Auto-reconnect with exponential backoff
 *   - Responsive (mobile-first)
 */

import * as React from "react"
import {
  Navigation,
  MapPin,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Loader2,
  WifiOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { syncRadiusCircle, type MapLike } from "@/lib/geo-circle"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LiveTrackingProps = {
  bookingId: string
  destinationLat: number
  destinationLng: number
  providerName: string
  className?: string
}

type Position = {
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  timestamp: string
}

type JourneyStep = {
  key: string
  label: string
  icon: React.ElementType
  active: boolean
  completed: boolean
}

type SSEStatus = "connecting" | "connected" | "reconnecting" | "disconnected"

// ---------------------------------------------------------------------------
// Journey step definitions
// ---------------------------------------------------------------------------

function getJourneySteps(distanceMeters: number | null, bookingStatus: string): JourneyStep[] {
  const isNearby = distanceMeters !== null && distanceMeters <= 200
  const isAtLocation = distanceMeters !== null && distanceMeters <= 50
  const isCompleted = bookingStatus === "COMPLETED"
  const isInProgress = bookingStatus === "IN_PROGRESS"

  return [
    {
      key: "en-route",
      label: "A Caminho",
      icon: Navigation,
      active: isInProgress && !isNearby,
      completed: isNearby || isAtLocation || isCompleted,
    },
    {
      key: "arriving",
      label: "Chegando",
      icon: MapPin,
      active: isNearby && !isAtLocation,
      completed: isAtLocation || isCompleted,
    },
    {
      key: "at-location",
      label: "No Local",
      icon: User,
      active: isAtLocation && !isCompleted,
      completed: isCompleted,
    },
    {
      key: "completed",
      label: "Concluído",
      icon: CheckCircle2,
      active: isCompleted,
      completed: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// Haversine helper (client-side, meters)
// ---------------------------------------------------------------------------

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatETA(durationMin: number): string {
  if (durationMin < 1) return "< 1 min"
  if (durationMin < 60) return `~${Math.round(durationMin)} min`
  const h = Math.floor(durationMin / 60)
  const m = Math.round(durationMin % 60)
  return `~${h}h${m > 0 ? ` ${m}min` : ""}`
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LiveTracking({
  bookingId,
  destinationLat,
  destinationLng,
  providerName,
  className,
}: LiveTrackingProps) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<unknown>(null)
  const providerMarkerRef = React.useRef<unknown>(null)

  const [sseStatus, setSSEStatus] = React.useState<SSEStatus>("connecting")
  const [position, setPosition] = React.useState<Position | null>(null)
  const [bookingStatus, setBookingStatus] = React.useState("IN_PROGRESS")
  const [distanceMeters, setDistanceMeters] = React.useState<number | null>(null)
  const [etaMin, setEtaMin] = React.useState<number | null>(null)
  const [geofenceEntered, setGeofenceEntered] = React.useState(false)

  const eventSourceRef = React.useRef<EventSource | null>(null)
  const reconnectAttemptRef = React.useRef(0)
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const maplibreglCacheRef = React.useRef<typeof import("maplibre-gl") | null>(null)

  // ── Update provider marker on map ──
  const updateMarker = React.useCallback(
    (pos: Position) => {
      if (!mapRef.current) return

      const loadAndRun = async () => {
        const maplibregl =
          maplibreglCacheRef.current ??
          (await import("maplibre-gl")).default ??
          (await import("maplibre-gl"))
        maplibreglCacheRef.current = maplibregl

        const map = mapRef.current as InstanceType<typeof maplibregl.Map>
        if (!map) return

        if (providerMarkerRef.current) {
          const marker = providerMarkerRef.current as InstanceType<typeof maplibregl.Marker>
          marker.setLngLat([pos.lng, pos.lat])
        } else {
          const providerEl = document.createElement("div")
          providerEl.style.display = "flex"
          providerEl.style.alignItems = "center"
          providerEl.style.justifyContent = "center"
          providerEl.style.width = "36px"
          providerEl.style.height = "36px"
          providerEl.style.borderRadius = "50%"
          providerEl.style.backgroundColor = "#3b82f6"
          providerEl.style.border = "3px solid white"
          providerEl.style.boxShadow = "0 2px 10px rgba(59,130,246,0.5)"
          providerEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="#3b82f6" stroke-width="2"/></svg>`

          const marker = new maplibregl.Marker({ element: providerEl })
            .setLngLat([pos.lng, pos.lat])
            .addTo(map)
          providerMarkerRef.current = marker
        }

        // Fit bounds to show both markers
        const bounds = new maplibregl.LngLatBounds()
          .extend([pos.lng, pos.lat])
          .extend([destinationLng, destinationLat])
        map.fitBounds(bounds, { padding: 50, maxZoom: 16 })
      }

      loadAndRun().catch(() => {
        /* ignore */
      })
    },
    [destinationLat, destinationLng],
  )

  // ── SSE connection ──
  React.useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return

      setSSEStatus("connecting")
      const es = new EventSource(`/api/tracking/${bookingId}/stream`)
      eventSourceRef.current = es

      es.addEventListener("connected", () => {
        if (cancelled) return
        setSSEStatus("connected")
        reconnectAttemptRef.current = 0
      })

      es.addEventListener("position", (e) => {
        if (cancelled) return
        try {
          const pos: Position = JSON.parse(e.data)
          setPosition(pos)

          // Calculate distance to destination
          const dist = haversineMeters(pos.lat, pos.lng, destinationLat, destinationLng)
          setDistanceMeters(Math.round(dist))

          // Rough ETA based on speed or distance (~30km/h urban average)
          const speedKmh = pos.speed && pos.speed > 0 ? pos.speed * 3.6 : 30
          const eta = (dist / 1000 / speedKmh) * 60
          setEtaMin(eta)

          // Update map marker
          updateMarker(pos)
        } catch {
          /* ignore parse errors */
        }
      })

      es.addEventListener("geofence", (e) => {
        if (cancelled) return
        try {
          const data = JSON.parse(e.data)
          if (data.type === "enter") {
            setGeofenceEntered(true)
          }
        } catch {
          /* ignore */
        }
      })

      es.addEventListener("status", (e) => {
        if (cancelled) return
        try {
          const data = JSON.parse(e.data)
          if (data.status) setBookingStatus(data.status)
        } catch {
          /* ignore */
        }
      })

      es.addEventListener("end", () => {
        es.close()
        setSSEStatus("disconnected")
      })

      es.onerror = () => {
        if (cancelled) return
        es.close()
        setSSEStatus("reconnecting")

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const attempt = reconnectAttemptRef.current++
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000)
        reconnectTimerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      eventSourceRef.current?.close()
    }
  }, [bookingId, destinationLat, destinationLng, updateMarker])

  // ── Map initialization (MapLibre GL dynamic import) ──
  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    let isMounted = true

    Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")])
      .then(([maplibreglModule]) => {
        if (!isMounted || !mapContainerRef.current) return
        const maplibregl =
          (maplibreglModule as unknown as { default: typeof import("maplibre-gl") }).default ??
          maplibreglModule

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "&copy; OpenStreetMap Contributors",
              },
            },
            layers: [
              {
                id: "osm-tiles",
                type: "raster",
                source: "osm",
                minzoom: 0,
                maxzoom: 19,
              },
            ],
          },
          center: [destinationLng, destinationLat],
          zoom: 14,
        })

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right")

        // Destination marker
        const destEl = document.createElement("div")
        destEl.style.display = "flex"
        destEl.style.alignItems = "center"
        destEl.style.justifyContent = "center"
        destEl.style.width = "32px"
        destEl.style.height = "32px"
        destEl.style.borderRadius = "50%"
        destEl.style.backgroundColor = "#10b981"
        destEl.style.border = "3px solid white"
        destEl.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)"
        destEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3" fill="white" stroke="#10b981" stroke-width="2"/></svg>`

        new maplibregl.Marker({ element: destEl })
          .setLngLat([destinationLng, destinationLat])
          .addTo(map)

        // Draw geofence circle (200m = 0.2km)
        map.on("load", () => {
          try {
            syncRadiusCircle(map as unknown as MapLike, destinationLat, destinationLng, 0.2)
          } catch {
            /* best effort */
          }
        })

        mapRef.current = map
      })
      .catch(() => {
        // MapLibre unavailable
      })

    return () => {
      isMounted = false
      if (mapRef.current) {
        const map = mapRef.current as { remove?: () => void }
        if (typeof map.remove === "function") {
          map.remove()
        }
        mapRef.current = null
      }
      providerMarkerRef.current = null
    }
  }, [destinationLat, destinationLng])

  // ── Journey steps ──
  const journeySteps = React.useMemo(
    () => getJourneySteps(distanceMeters, bookingStatus),
    [distanceMeters, bookingStatus],
  )

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* ── Connection status bar ── */}
      <div className="bg-muted/30 flex items-center justify-between rounded-lg border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Navigation className="size-4 text-emerald-600" />
          <span>Rastreando {providerName}</span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
            sseStatus === "connected"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
              : sseStatus === "reconnecting" || sseStatus === "connecting"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
          )}
        >
          {sseStatus === "connected" ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              Ao vivo
            </>
          ) : sseStatus === "connecting" || sseStatus === "reconnecting" ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              {sseStatus === "connecting" ? "Conectando…" : "Reconectando…"}
            </>
          ) : (
            <>
              <WifiOff className="size-3" />
              Desconectado
            </>
          )}
        </span>
      </div>

      {/* ── Map ── */}
      <div className="relative overflow-hidden rounded-xl border shadow-sm">
        <div
          ref={mapContainerRef}
          className="h-64 w-full bg-gray-100 sm:h-80 dark:bg-gray-800"
          style={{ minHeight: 256 }}
        />

        {/* ETA overlay */}
        {etaMin !== null && distanceMeters !== null && sseStatus === "connected" && (
          <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 rounded-lg border bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm dark:bg-zinc-900/95">
            <Clock className="size-4 text-blue-600" />
            <div>
              <p className="text-xs font-bold text-blue-700 tabular-nums dark:text-blue-300">
                {formatETA(etaMin)}
              </p>
              <p className="text-muted-foreground text-[10px] tabular-nums">
                {formatDistance(distanceMeters)}
              </p>
            </div>
          </div>
        )}

        {/* Geofence badge */}
        {geofenceEntered && (
          <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-md">
            <MapPin className="size-3" />
            Próximo!
          </div>
        )}

        {/* No position yet */}
        {!position && sseStatus === "connected" && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-lg bg-white/90 px-4 py-3 text-sm shadow-lg dark:bg-zinc-900/90">
              <Loader2 className="size-4 animate-spin text-blue-600" />
              Aguardando posição do prestador…
            </div>
          </div>
        )}
      </div>

      {/* ── Journey Timeline ── */}
      <div className="bg-card rounded-xl border p-4">
        <h4 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
          Jornada do Serviço
        </h4>
        <div className="flex items-center gap-1">
          {journeySteps.map((step, i) => {
            const Icon = step.icon
            return (
              <React.Fragment key={step.key}>
                <div
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1.5 rounded-lg px-2 py-2 transition-colors",
                    step.active && "bg-blue-50 dark:bg-blue-950/30",
                    step.completed && "opacity-60",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full",
                      step.active
                        ? "bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-blue-900/30"
                        : step.completed
                          ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500",
                    )}
                  >
                    {step.completed ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <Icon className={cn("size-4", step.active && "animate-pulse")} />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-center text-[10px] leading-tight font-medium",
                      step.active
                        ? "text-blue-700 dark:text-blue-300"
                        : step.completed
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {i < journeySteps.length - 1 && (
                  <ArrowRight
                    className={cn(
                      "size-3 shrink-0",
                      step.completed ? "text-emerald-400" : "text-gray-300 dark:text-gray-600",
                    )}
                  />
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* ── Info card ── */}
      <div className="flex items-start gap-2 rounded-lg border bg-blue-50/50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/20 dark:text-blue-300">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <span>
          A localização é atualizada em tempo real enquanto o prestador compartilha sua posição. O
          rastreamento é encerrado automaticamente ao concluir o serviço.
        </span>
      </div>
    </div>
  )
}

export default LiveTracking
