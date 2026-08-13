"use client"

/**
 * ProviderMiniMap — a compact, lazily-loaded MapLibre map showing the
 * provider's location and, optionally, the user's location.
 *
 * Used inside the ProviderProfileModal to give a quick visual sense of
 * where the provider is located relative to the user.
 *
 * SSR-safe: the actual map is only instantiated inside a useEffect.
 * Falls back to an OpenStreetMap static image if JS is unavailable or
 * the map fails to load.
 */

import { useEffect, useRef, useState } from "react"
import { Loader2, Maximize2, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  providerLat: number
  providerLng: number
  providerName: string
  userLat?: number | null
  userLng?: number | null
  /** Live provider position (WebSocket tracking:position) — [lat, lng]. */
  liveLat?: number | null
  liveLng?: number | null
  /** Label shown next to the live marker (e.g. the provider's name). */
  liveLabel?: string
  /** Height in px. Default 200. */
  height?: number
  className?: string
}

// Static map fallback URL (OpenStreetMap static image via staticmap.openstreetmap.de)
function staticMapUrl(
  lat: number,
  lng: number,
  zoom = 14,
  width = 400,
  height = 200,
): string {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=mapnik&markers=${lat},${lng},red-pushpin`
}

export default function ProviderMiniMap({
  providerLat,
  providerLng,
  providerName,
  userLat,
  userLng,
  liveLat,
  liveLng,
  liveLabel,
  height = 200,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const liveMarkerRef = useRef<{
    setLngLat: (c: [number, number]) => void
    show: () => void
    hide: () => void
  } | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  // Defensive guard: coords that are null/NaN/Infinity, or the placeholder
  // (0, 0), render a placeholder instead of a map centered on the Gulf of
  // Guinea. Callers already filter these, but direct usage stays safe.
  const hasValidCoords =
    Number.isFinite(providerLat) &&
    Number.isFinite(providerLng) &&
    !(providerLat === 0 && providerLng === 0)

  useEffect(() => {
    if (!containerRef.current || !hasValidCoords) return

    let cancelled = false
    let mapInstance: unknown = null
    let cleanup: (() => void) | undefined

    ;(async () => {
      try {
        const maplibregl = await import("maplibre-gl")
        await import("maplibre-gl/dist/maplibre-gl.css")
        if (cancelled || !containerRef.current) return

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
                maxzoom: 19,
              },
            },
            layers: [
              {
                id: "osm-tiles",
                type: "raster",
                source: "osm",
                paint: { "raster-opacity": 1 },
              },
            ],
          },
          center: [providerLng, providerLat],
          zoom: 14,
          attributionControl: { compact: true },
          scrollZoom: false,
          dragPan: true,
          interactive: true,
        })

        map.on("load", () => {
          if (cancelled) return
          setStatus("ready")
        })

        // Fallback: after 5s mark as ready anyway
        const fallbackTimer = window.setTimeout(() => {
          if (!cancelled) setStatus("ready")
        }, 5000)

        // Add provider marker
        const providerEl = document.createElement("button")
        providerEl.type = "button"
        providerEl.setAttribute("aria-label", providerName)
        providerEl.style.cssText = `
          width: 28px; height: 28px;
          border-radius: 50%;
          background: var(--primary, #059669);
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        `
        providerEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`
        new maplibregl.Marker({ element: providerEl })
          .setLngLat([providerLng, providerLat])
          .addTo(map)

        // Add user marker if available
        if (typeof userLat === "number" && typeof userLng === "number") {
          const userEl = document.createElement("div")
          userEl.setAttribute("aria-label", "Sua localização")
          userEl.style.cssText = `
            width: 16px; height: 16px;
            border-radius: 50%;
            background: #2563eb;
            border: 3px solid white;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25);
          `
          new maplibregl.Marker({ element: userEl })
            .setLngLat([userLng, userLat])
            .addTo(map)
        }

        // Add live-tracking marker — ALWAYS created (hidden until the first
        // fix arrives); moved via setLngLat by the effect below so position
        // updates never recreate the map.
        const liveEl = document.createElement("div")
        liveEl.setAttribute("aria-label", liveLabel ?? "Prestador ao vivo")
        liveEl.className = "animate-pulse"
        liveEl.style.cssText = `
          width: 22px; height: 22px;
          border-radius: 50%;
          background: #059669;
          border: 3px solid white;
          box-shadow: 0 0 0 4px rgba(5, 150, 105, 0.35);
        `
        liveEl.style.display = "none"
        const liveMarker = new maplibregl.Marker({ element: liveEl })
          .setLngLat([providerLng, providerLat])
          .addTo(map)
        liveMarkerRef.current = {
          setLngLat: (c: [number, number]) => liveMarker.setLngLat(c),
          show: () => {
            liveEl.style.display = ""
          },
          hide: () => {
            liveEl.style.display = "none"
          },
        }

        mapInstance = map

        cleanup = () => {
          map.remove()
          window.clearTimeout(fallbackTimer)
        }
      } catch {
        if (!cancelled) setStatus("error")
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [providerLat, providerLng, providerName, userLat, userLng, liveLabel, hasValidCoords])

  // Move + reveal the live marker without recreating the map
  useEffect(() => {
    const m = liveMarkerRef.current
    if (!m) return
    if (typeof liveLat === "number" && typeof liveLng === "number") {
      m.setLngLat([liveLng, liveLat])
      m.show()
    } else {
      m.hide()
    }
  }, [liveLat, liveLng])

  const openInOSM = () => {
    window.open(
      `https://www.openstreetmap.org/?mlat=${providerLat}&mlon=${providerLng}&zoom=15`,
      "_blank",
      "noopener",
    )
  }

  // Invalid coordinates — no map to render
  if (!hasValidCoords) {
    return (
      <div
        data-testid="mini-map-placeholder"
        className={cn(
          "relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border bg-muted text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        <MapPin className="size-4" />
        <p className="text-[11px] font-medium">Localização indisponível</p>
      </div>
    )
  }

  return (
    <div
      data-testid="provider-mini-map"
      className={cn("relative overflow-hidden rounded-xl border bg-muted", className)}
      style={{ height }}
    >
      {/* Loading state */}
      {status === "loading" && (
        <div
          data-testid="mini-map-loading"
          className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80"
        >
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* MapLibre container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Fallback static image (if MapLibre failed) */}
      {status === "error" && (
        <div
          data-testid="mini-map-fallback"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-muted"
        >
          <img
            data-testid="mini-map-fallback-image"
            src={staticMapUrl(providerLat, providerLng, 14, 400, height)}
            alt={`Mapa de ${providerName}`}
            className="size-full object-cover"
          />
          <p className="absolute bottom-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-0.5 rounded">
            Mapa interativo indisponível
          </p>
        </div>
      )}

      {/* Provider location badge */}
      <div
        data-testid="mini-map-badge"
        className="absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm"
      >
        <MapPin className="size-3 text-primary" />
        <span className="truncate max-w-[120px]">{providerName}</span>
      </div>

      {/* Expand button */}
      <button
        type="button"
        onClick={openInOSM}
        data-testid="mini-map-expand"
        className="absolute top-2 right-2 z-20 flex size-7 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
        aria-label="Abrir no OpenStreetMap"
        title="Abrir no OpenStreetMap"
      >
        <Maximize2 className="size-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}
