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

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, Maximize2, MapPin, Radio } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocationBroadcaster } from "@/hooks/use-location-broadcaster"
import {
  syncRadiusCircle,
  removeRadiusCircle,
  syncAccuracyCircle,
  removeAccuracyCircle,
  syncRadiusHandle,
  removeRadiusHandle,
  makeRadiusEdgeDraggable,
  type EdgeDragMap,
  type MapLike,
} from "@/lib/geo-circle"
import { ensureMaplibreWorker } from "@/lib/maplibre-worker"
import { Slider } from "@/components/ui/slider"
import { apiPatch } from "@/lib/api"

// ── Module-level preload ──────────────────────────────────────────────────
// Starting the dynamic import at module evaluation time (not inside useEffect)
// makes the bundle download in parallel with React rendering, so the map
// appears near-instantly when the component mounts.
//
// The promise is cached globally so multiple instances share one download.

let _maplibrePromise: Promise<unknown> | null = null
let _cssPromise: Promise<void> | null = null

/**
 * Kick off the maplibre-gl dynamic import NOW so it's cached by the time
 * the component's useEffect runs. Safe to call multiple times — the promise
 * is cached and the import only happens once.
 */
export function preloadMaplibreGl(): void {
  if (!_maplibrePromise) {
    _maplibrePromise = import("maplibre-gl")
    _cssPromise = import("maplibre-gl/dist/maplibre-gl.css") as Promise<void>
  }
}

type Props = {
  providerLat: number
  providerLng: number
  providerName: string
  userLat?: number | null
  userLng?: number | null
  /** Provider's service radius in km (for drawing the radius circle on the map). */
  radiusKm?: number | null
  /** Precisão da última fix do GPS do prestador (± m) — círculo pontilhado de incerteza. */
  accuracyM?: number | null
  /** Called when the user adjusts the radius slider. */
  onRadiusChange?: (radiusKm: number) => void
  /** Enable interactive edge-dot dragging. Only meaningful for the provider's own profile. */
  interactive?: boolean
  /** Height in px. Default 200. */
  height?: number
  className?: string
  /** Optional active booking ID for live GPS broadcasting to client. */
  activeBookingId?: string | null
}

// Static map fallback URL (OpenStreetMap static image via staticmap.openstreetmap.de)
function staticMapUrl(lat: number, lng: number, zoom = 14, width = 400, height = 200): string {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=mapnik&markers=${lat},${lng},red-pushpin`
}

export default function ProviderMiniMap({
  providerLat,
  providerLng,
  providerName,
  userLat,
  userLng,
  radiusKm,
  accuracyM,
  onRadiusChange,
  interactive = false,
  height = 200,
  className,
  activeBookingId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<unknown>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [radius, setRadius] = useState(radiusKm ?? 50)
  const [saving, setSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { isBroadcasting, toggle: toggleBroadcasting } = useLocationBroadcaster({
    bookingId: activeBookingId,
  })

  // ── Auto-save: debounced PATCH to /api/users/me ────────────────────
  const autoSaveRadius = useCallback(
    (km: number) => {
      if (!interactive) return
      setSaving(true)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        try {
          await apiPatch("/api/users/me", { radiusKm: km })
        } catch {
          // save failed silently — the slider still works locally
        } finally {
          setSaving(false)
        }
      }, 800)
    },
    [interactive],
  )

  // Refs dos callbacks instáveis — o effect de init do mapa roda com deps
  // geo primitivas; ler onRadiusChange/autoSaveRadius via ref evita recriar o
  // mapa quando o callback do pai muda de identidade (mesmo padrão do
  // selectRef no providers-map). interactive é boolean prop — dep estável.
  //
  // A sincronização acontece num effect (não durante o render): a regra
  // react-hooks/refs proíbe escrever `ref.current = ...` no corpo do
  // componente (React 19 — atualizar ref durante render pode quebrar
  // renderização concorrente). O effect roda antes de qualquer handler, então
  // os callbacks do mapa sempre leem a versão atual.
  const onRadiusChangeRef = useRef(onRadiusChange)
  const autoSaveRadiusRef = useRef(autoSaveRadius)
  useEffect(() => {
    onRadiusChangeRef.current = onRadiusChange
    autoSaveRadiusRef.current = autoSaveRadius
  }, [onRadiusChange, autoSaveRadius])

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Sync local radius when the radiusKm PROP changes — intentional: the
  // slider should follow when the provider's configured radius loads
  // asynchronously (e.g. null/undefined → 50).
  //
  // We schedule via rAF to avoid synchronous setState inside effect (ESLint
  // rule), but ONLY when the prop actually changed from the previous render:
  // the mount case (radiusKm == initial radius, no change) must not schedule
  // a rAF — in jsdom the pending rAF fires mid-test and clobbers the slider
  // state, causing an extra syncRadiusCircle (flaky "expected spy to be
  // called 2 times, but got 3").
  const prevRadiusKmRef = useRef(radiusKm)
  useEffect(() => {
    // Atualiza o ref SEMPRE (mesmo quando radiusKm é null) — se o pai
    // fizer 50 → null → 50, o ref precisa voltar a 50 para o sync disparar
    // de novo (o slider pode ter mudado enquanto radiusKm era null).
    const prev = prevRadiusKmRef.current
    prevRadiusKmRef.current = radiusKm
    if (radiusKm != null && radiusKm !== prev) {
      const id = requestAnimationFrame(() => setRadius(radiusKm))
      return () => cancelAnimationFrame(id)
    }
  }, [radiusKm])

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    let mapInstance: unknown = null
    let cleanup: (() => void) | undefined

    // Prime the import if it hasn't started yet (safe to call multiple times)
    preloadMaplibreGl()

    ;(async () => {
      try {
        const [maplibreModule] = await Promise.all([_maplibrePromise!, _cssPromise!])
        const maplibregl = maplibreModule as typeof import("maplibre-gl")
        if (cancelled || !containerRef.current) return

        // Worker por URL ANTES da criação do mapa — o bundler quebra o worker
        // blob do MapLibre (mapa em branco, zero tiles .pbf).
        await ensureMaplibreWorker()
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
                attribution:
                  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
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

        let dragCleanup: (() => void) | null = null

        map.on("load", () => {
          if (cancelled) return
          setStatus("ready")
          // Draw provider's service radius circle
          if (typeof radiusKm === "number" && radiusKm > 0) {
            const mapLike = map as unknown as MapLike
            syncRadiusCircle(mapLike, providerLat, providerLng, radiusKm)
            if (interactive) {
              syncRadiusHandle(mapLike, providerLat, providerLng, radiusKm)
              dragCleanup = makeRadiusEdgeDraggable(
                map as unknown as EdgeDragMap,
                providerLat,
                providerLng,
                (newRadius: number) => {
                  setRadius(newRadius)
                  onRadiusChangeRef.current?.(newRadius)
                  autoSaveRadiusRef.current(newRadius)
                },
              )
            }
          }
          // Círculo de incerteza da ÚLTIMA fix do GPS salva (± m) — aparece
          // com a localização salva, sem nova fix; inválida não desenha.
          if (accuracyM != null) {
            syncAccuracyCircle(map as unknown as MapLike, providerLat, providerLng, accuracyM)
          }
        })

        // Fallback: after 5s mark as ready anyway
        const fallbackTimer = window.setTimeout(() => {
          if (!cancelled) {
            setStatus("ready")
            if (typeof radiusKm === "number" && radiusKm > 0 && mapInstance) {
              const mapLike = map as unknown as MapLike
              syncRadiusCircle(mapLike, providerLat, providerLng, radiusKm)
              if (interactive) {
                syncRadiusHandle(mapLike, providerLat, providerLng, radiusKm)
                dragCleanup = makeRadiusEdgeDraggable(
                  map as unknown as EdgeDragMap,
                  providerLat,
                  providerLng,
                  (newRadius: number) => {
                    setRadius(newRadius)
                    onRadiusChangeRef.current?.(newRadius)
                    autoSaveRadiusRef.current(newRadius)
                  },
                )
              }
            }
            if (accuracyM != null && mapInstance) {
              syncAccuracyCircle(map as unknown as MapLike, providerLat, providerLng, accuracyM)
            }
          }
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
          new maplibregl.Marker({ element: userEl }).setLngLat([userLng, userLat]).addTo(map)
        }

        mapInstance = map
        mapRef.current = map

        cleanup = () => {
          dragCleanup?.()
          removeRadiusHandle(map as unknown as MapLike)
          map.remove()
          window.clearTimeout(fallbackTimer)
        }
      } catch {
        if (!cancelled) setStatus("error")
      }
    })()

    return () => {
      cancelled = true
      // Cleanup radius circle layers
      if (mapInstance) {
        removeRadiusCircle(mapInstance as unknown as MapLike)
        removeAccuracyCircle(mapInstance as unknown as MapLike)
        removeRadiusHandle(mapInstance as unknown as MapLike)
      }
      cleanup?.()
    }
  }, [providerLat, providerLng, providerName, userLat, userLng, radiusKm, accuracyM, interactive])

  // Update radius circle dynamically when slider changes (without recreating map)
  // NOTE: We do NOT call removeRadiusCircle/removeRadiusHandle here because
  // syncRadiusCircle and syncRadiusHandle already use setData() when the
  // source exists — avoiding layer recreation preserves MapLibre event
  // listeners registered by makeRadiusEdgeDraggable.
  useEffect(() => {
    const map = mapRef.current as MapLike | null
    if (!map) return
    if (typeof radius !== "number" || radius <= 0) return
    try {
      syncRadiusCircle(map, providerLat, providerLng, radius)
      if (interactive) {
        syncRadiusHandle(map, providerLat, providerLng, radius)
      }
    } catch {
      // map may not be fully loaded yet
    }
  }, [radius, providerLat, providerLng, interactive])

  const handleRadiusChange = (value: number[]) => {
    const newRadius = value[0] ?? 50
    setRadius(newRadius)
    onRadiusChange?.(newRadius)
  }

  const openInOSM = () => {
    window.open(
      `https://www.openstreetmap.org/?mlat=${providerLat}&mlon=${providerLng}&zoom=15`,
      "_blank",
      "noopener",
    )
  }

  return (
    <>
      <div
        className={cn("bg-muted relative overflow-hidden rounded-xl border", className)}
        style={{ height }}
      >
        {/* Loading state */}
        {status === "loading" && (
          <div className="bg-muted/80 absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {/* MapLibre container */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Fallback static image (if MapLibre failed) */}
        {status === "error" && (
          <div className="bg-muted absolute inset-0 z-10 flex flex-col items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- fallback estático externo */}
            <img
              src={staticMapUrl(providerLat, providerLng, 14, 400, height)}
              alt={`Mapa de ${providerName}`}
              className="size-full object-cover"
            />
            <p className="text-muted-foreground bg-background/80 absolute bottom-2 rounded px-2 py-0.5 text-[10px]">
              Mapa interativo indisponível
            </p>
          </div>
        )}

        {/* Provider location badge */}
        <div className="bg-background/90 text-foreground absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium shadow-sm backdrop-blur-sm">
          <MapPin className="text-primary size-3" />
          <span className="max-w-[120px] truncate">{providerName}</span>
        </div>

        {/* Expand button */}
        <button
          type="button"
          onClick={openInOSM}
          className="bg-background/90 hover:bg-background absolute top-2 right-2 z-20 flex size-7 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition-colors"
          aria-label="Abrir no OpenStreetMap"
          title="Abrir no OpenStreetMap"
        >
          <Maximize2 className="text-muted-foreground size-3.5" />
        </button>
      </div>

      {/* Radius slider */}
      <div className="mt-2 grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-[11px] font-medium">Raio de busca</span>
          <span className="flex items-center gap-2">
            {saving && (
              <span className="text-muted-foreground animate-pulse text-[9px]">Salvando…</span>
            )}
            <span className="text-xs font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
              {radius} km
            </span>
          </span>
        </div>
        <Slider
          value={[radius]}
          onValueChange={handleRadiusChange}
          min={1}
          max={100}
          step={1}
          className="[&>span:first-child]:h-1.5 [&>span:first-child]:bg-emerald-100 [&>span:first-child_span]:bg-emerald-600 [&>span:last-child]:size-3.5 [&>span:last-child]:border-emerald-600"
          aria-label="Raio de busca em quilômetros"
        />
        <div className="text-muted-foreground flex justify-between text-[9px]">
          <span>1 km</span>
          <span>50 km</span>
          <span>100 km</span>
        </div>
      </div>

      {activeBookingId ? (
        <div className="border-border/80 bg-muted/40 mt-2.5 flex items-center justify-between rounded-lg border p-2.5 text-xs">
          <div className="flex items-center gap-2">
            <Radio
              className={cn(
                "size-4 shrink-0",
                isBroadcasting ? "animate-pulse text-emerald-600" : "text-muted-foreground",
              )}
            />
            <div>
              <p className="text-foreground font-medium">
                {isBroadcasting ? "Transmitindo GPS" : "Compartilhar localização"}
              </p>
              <p className="text-muted-foreground text-[10px]">
                {isBroadcasting
                  ? "Cliente acompanha seu trajeto em tempo real"
                  : "Ative para o cliente acompanhar sua rota"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleBroadcasting}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
              isBroadcasting
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "border-input bg-background hover:bg-muted text-foreground border",
            )}
          >
            {isBroadcasting ? "Ativo" : "Iniciar GPS"}
          </button>
        </div>
      ) : null}
    </>
  )
}
