"use client"

/**
 * EnhancedProvidersMap — Next-gen map with all features:
 *
 * - Animated provider pins with status dots
 * - Rich tooltip cards (desktop) / bottom sheet (mobile)
 * - Heatmap overlay for provider density
 * - Dashed route line (user → provider)
 * - Floating filter bar
 * - Dark mode tiles support
 * - Offline indicator styling
 *
 * Wraps ProvidersMap functionality with enhanced UX.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { createAnimatedPinElement } from "@/components/map/pins"
import { HeatmapOverlay, RouteLine } from "@/components/map/overlays"
import { Slider } from "@/components/ui/slider"
import {
  Layers,
  Route,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Loader2,
  Download,
  Maximize2,
  Minimize2,
} from "lucide-react"
import type { ProviderCard } from "@/lib/api"
import { precacheTiles, getCacheSizeMB } from "@/lib/map-tile-cache"
import {
  buildClusterGeoJSON,
  fitProvidersBounds,
  syncUserLocationMarker,
} from "@/components/map/helpers"
import type { GeoJSONSource } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

type Props = {
  providers: ProviderCard[]
  userLat?: number | null
  userLng?: number | null
  onSelectProvider?: (id: string) => void
  selectedId?: string | null
  className?: string
  radius?: number
  onRadiusChange?: (radius: number) => void
}

const OSM_TILES_LIGHT = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const OSM_TILES_DARK = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | &copy; <a href="https://carto.com/">CARTO</a>'

const DEFAULT_CENTER: [number, number] = [-41.9455, -18.8566] // GV
const CLUSTER_MAX_ZOOM = 14
const CLUSTER_RADIUS = 50

type MapLibreMap = InstanceType<typeof import("maplibre-gl").Map>
type MarkerInstance = InstanceType<typeof import("maplibre-gl").Marker>

export default function EnhancedProvidersMap({
  providers,
  userLat,
  userLng,
  onSelectProvider,
  selectedId,
  className,
  radius,
  onRadiusChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Record<string, MarkerInstance>>({})
  const userMarkerRef = useRef<MarkerInstance | null>(null)
  const clusterSourceAdded = useRef(false)
  const maplibreglRef = useRef<typeof import("maplibre-gl") | null>(null)
  const selectRef = useRef(onSelectProvider)
  const markerSyncCleanupRef = useRef<(() => void) | null>(null)
  const providersRef = useRef(providers)
  const userLatRef = useRef(userLat)
  const userLngRef = useRef(userLng)

  // State for overlays
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [showRoute, setShowRoute] = useState(true)
  const [isDark, setIsDark] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null)
  const [cacheSizeMB, setCacheSizeMB] = useState(0)
  const [isPrecaching, setIsPrecaching] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    selectRef.current = onSelectProvider
    providersRef.current = providers
    userLatRef.current = userLat
    userLngRef.current = userLng
  })

  const hasUserLocation = typeof userLat === "number" && typeof userLng === "number"

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!wrapperRef.current) return
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }, [])

  // Listen for fullscreen changes (e.g. user presses Escape)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  // Handle manual precache
  const handlePrecache = async () => {
    if (!mapInstance || isPrecaching) return
    setIsPrecaching(true)
    try {
      const bounds = mapInstance.getBounds()
      const zoom = Math.floor(mapInstance.getZoom())
      await precacheTiles(
        {
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
        },
        zoom,
      )
      setCacheSizeMB(await getCacheSizeMB())
    } finally {
      setIsPrecaching(false)
    }
  }

  // Get selected provider coordinates for route line
  const selectedProvider = selectedId ? providers.find((p) => p.id === selectedId) : null

  // ---- Initialize map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    let cleanup: (() => void) | undefined

    ;(async () => {
      const maplibregl = await import("maplibre-gl")
      if (cancelled || !containerRef.current) return
      maplibreglRef.current = maplibregl

      const tiles = isDark ? OSM_TILES_DARK : OSM_TILES_LIGHT

      const map = new maplibregl.Map({
        container: containerRef.current,
        trackResize: true,
        touchZoomRotate: true,
        touchPitch: false,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [tiles],
              tileSize: 256,
              attribution: OSM_ATTRIBUTION,
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
        center: DEFAULT_CENTER,
        zoom: 13,
        attributionControl: { compact: true },
      })

      map.addControl(
        new maplibregl.NavigationControl({
          visualizePitch: false,
          showZoom: true,
          showCompass: false,
        }),
        "top-right",
      )
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

      // Touch handling configured via Map constructor options above

      map.on("load", () => {
        map.resize()
        fitProvidersBounds(map, providersRef.current, userLatRef.current, userLngRef.current)
        // Force-sync markers on map load — the useEffect may have missed the
        // window because mapRef/maplibreglRef were still null during its run.
        const ml = maplibreglRef.current
        if (ml && providersRef.current.length > 0) {
          syncAnimatedMarkers({
            map,
            maplibregl: ml,
            providers: providersRef.current,
            selectedId: null,
            onSelectProvider: selectRef.current,
            markersRef,
          })
        }
      })

      // Auto pre-cache tiles on viewport move (debounced)
      let precacheTimer: ReturnType<typeof setTimeout> | null = null
      map.on("moveend", () => {
        if (precacheTimer) clearTimeout(precacheTimer)
        precacheTimer = setTimeout(async () => {
          const bounds = map.getBounds()
          const zoom = Math.floor(map.getZoom())
          await precacheTiles(
            {
              minLat: bounds.getSouth(),
              minLng: bounds.getWest(),
              maxLat: bounds.getNorth(),
              maxLng: bounds.getEast(),
            },
            zoom,
          )
          setCacheSizeMB(await getCacheSizeMB())
        }, 2000)
      })

      // Resize passes
      const t1 = window.setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.resize()
          fitProvidersBounds(
            mapRef.current,
            providersRef.current,
            userLatRef.current,
            userLngRef.current,
          )
        }
      }, 100)

      mapRef.current = map
      setMapInstance(map)

      cleanup = () => {
        window.clearTimeout(t1)
        map.remove()
        mapRef.current = null
        setMapInstance(null)
        markersRef.current = {}
        userMarkerRef.current = null
        clusterSourceAdded.current = false
      }
    })().catch((err) => {
      console.error("Erro ao inicializar o mapa:", err)
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isDark intentionally excluded from init; synced via setStyle effect
  }, []) // Initialize once — dark mode handled via setStyle effect below

  // ---- Sync dark mode via setStyle (avoids full map re-creation) -----------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const tiles = isDark ? OSM_TILES_DARK : OSM_TILES_LIGHT
    try {
      map.setStyle({
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [tiles],
            tileSize: 256,
            attribution: OSM_ATTRIBUTION,
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
      })
    } catch {
      /* map may not be fully initialized yet */
    }
  }, [isDark])

  // Resize map when fullscreen changes
  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (mapRef.current) {
          mapRef.current.resize()
        }
      },
      isFullscreen ? 300 : 50,
    )
    return () => clearTimeout(timer)
  }, [isFullscreen])

  // Update cache size on mount
  useEffect(() => {
    getCacheSizeMB().then(setCacheSizeMB)
  }, [])

  // ---- Sync providers → animated markers -----------------------------------
  useEffect(() => {
    const syncMarkers = () => {
      const map = mapRef.current
      const maplibregl = maplibreglRef.current
      if (!map || !maplibregl) return

      const sync = () => {
        if (!map.isStyleLoaded()) return
        const useClustering = providers.length > 20
        if (useClustering) {
          syncClusterSource(map, providers, markersRef, clusterSourceAdded)
        } else {
          removeClusterSource(map, clusterSourceAdded)
          syncAnimatedMarkers({
            map,
            maplibregl,
            providers,
            selectedId,
            onSelectProvider: selectRef.current,
            markersRef,
          })
        }
        fitProvidersBounds(map, providers, userLat, userLng)
      }

      if (map.isStyleLoaded()) {
        sync()
      } else {
        map.once("style.load", sync)
      }

      return () => {
        map.off("style.load", sync)
      }
    }

    // Try immediately — refs may already be set
    const cleanup = syncMarkers()
    if (cleanup) return cleanup

    // If refs are still null (async init pending), use a short timeout chain
    let timeoutId: ReturnType<typeof setTimeout>
    const poll = () => {
      const c = syncMarkers()
      if (c) {
        markerSyncCleanupRef.current = c
      } else {
        timeoutId = setTimeout(poll, 200)
      }
    }
    timeoutId = setTimeout(poll, 200)

    return () => {
      clearTimeout(timeoutId)
      markerSyncCleanupRef.current?.()
    }
  }, [providers, selectedId, userLat, userLng, mapInstance])

  // ---- Sync user location marker -------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    const maplibregl = maplibreglRef.current
    if (!map || !maplibregl) return

    if (map.isStyleLoaded()) {
      syncUserLocationMarker({ map, maplibregl, lat: userLat, lng: userLng, userMarkerRef })
    } else {
      const onReady = () =>
        syncUserLocationMarker({ map, maplibregl, lat: userLat, lng: userLng, userMarkerRef })
      map.once("style.load", onReady)
      return () => {
        map.off("style.load", onReady)
      }
    }
  }, [userLat, userLng, mapInstance])

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "bg-muted relative h-full min-h-[400px] w-full overflow-hidden rounded-xl border",
        isFullscreen && "fixed inset-0 z-[9999] min-h-screen rounded-none",
        className,
      )}
      aria-label="Mapa de prestadores"
      role="application"
      style={{ touchAction: "pan-x pan-y pinch-zoom" }}
    >
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {/* Heatmap overlay */}
      <HeatmapOverlay map={mapInstance} providers={providers} enabled={showHeatmap} />

      {/* Route line */}
      <RouteLine
        map={mapInstance}
        userLat={userLat}
        userLng={userLng}
        providerLat={selectedProvider?.lat}
        providerLng={selectedProvider?.lng}
        visible={showRoute && !!selectedProvider}
      />

      {/* Floating filter bar */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex size-10 items-center justify-center rounded-xl border bg-white/90 shadow-lg backdrop-blur-sm transition-all hover:scale-105",
            showFilters ? "border-emerald-500 bg-emerald-50" : "border-gray-200",
          )}
          title="Filtros do mapa"
        >
          <Layers className="size-5 text-gray-600" />
        </button>

        {showFilters && (
          <div className="w-56 space-y-3 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm">
            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className="flex size-10 items-center justify-center rounded-xl border border-gray-200 bg-white/90 shadow-lg backdrop-blur-sm transition-all hover:scale-105"
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {isFullscreen ? (
                <Minimize2 className="size-5 text-gray-600" />
              ) : (
                <Maximize2 className="size-5 text-gray-600" />
              )}
            </button>

            {/* Dark mode toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Modo escuro</span>
              <button
                onClick={() => setIsDark(!isDark)}
                className="flex size-7 items-center justify-center rounded-lg bg-gray-100 transition-colors hover:bg-gray-200"
              >
                {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>

            {/* Heatmap toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Heatmap</span>
              <button
                onClick={() => setShowHeatmap(!showHeatmap)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg transition-colors",
                  showHeatmap ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500",
                )}
              >
                {showHeatmap ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
            </div>

            {/* Route toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Rota</span>
              <button
                onClick={() => setShowRoute(!showRoute)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg transition-colors",
                  showRoute ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500",
                )}
              >
                <Route className="size-4" />
              </button>
            </div>

            {/* Precache button */}
            <button
              onClick={handlePrecache}
              disabled={isPrecaching}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              {isPrecaching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {isPrecaching ? "Baixando tiles..." : "Cache offline"}
            </button>

            {/* Cache stats */}
            <div className="border-t border-gray-100 pt-2">
              <p className="text-[10px] text-gray-400">
                {providers.length} prestadores · {cacheSizeMB.toFixed(1)} MB cache
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Radius slider overlay */}
      {hasUserLocation && typeof radius === "number" && onRadiusChange ? (
        <div className="absolute bottom-3 left-1/2 z-30 w-[calc(100%-24px)] max-w-xs -translate-x-1/2">
          <div className="bg-background/95 flex items-center gap-3 rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tabular-nums">
              {radius} km
            </span>
            <Slider
              min={1}
              max={100}
              step={1}
              value={[radius]}
              onValueChange={([v]) => onRadiusChange(v ?? 15)}
              aria-label="Ajustar raio de busca"
              className="flex-1 [&_[data-slot=slider-track]]:h-1.5"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncAnimatedMarkers(opts: {
  map: MapLibreMap
  maplibregl: typeof import("maplibre-gl")
  providers: ProviderCard[]
  selectedId?: string | null
  onSelectProvider?: (id: string) => void
  markersRef: React.MutableRefObject<Record<string, MarkerInstance>>
}) {
  const { map, maplibregl, providers, selectedId, onSelectProvider, markersRef } = opts
  const registry = markersRef.current ?? {}

  // Remove markers for providers no longer in the list
  for (const [id, marker] of Object.entries(registry)) {
    if (!providers.some((p) => p.id === id)) {
      marker.remove()
      delete registry[id]
    }
  }

  for (const provider of providers) {
    if (typeof provider.lat !== "number" || typeof provider.lng !== "number") continue
    const existing = registry[provider.id]
    const isSelected = selectedId === provider.id

    if (existing) {
      existing.getElement().dataset.selected = isSelected ? "true" : "false"
      continue
    }

    const el = createAnimatedPinElement({ provider, isSelected, onSelect: onSelectProvider })

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([provider.lng, provider.lat])
      .addTo(map)

    registry[provider.id] = marker
  }

  markersRef.current = registry
}

function syncClusterSource(
  map: MapLibreMap,
  providers: ProviderCard[],
  markersRef: React.MutableRefObject<Record<string, MarkerInstance>>,
  clusterSourceAdded: React.MutableRefObject<boolean>,
) {
  // Remove existing HTML markers
  const registry = markersRef.current ?? {}
  for (const marker of Object.values(registry)) marker.remove()
  markersRef.current = {}

  const source = map.getSource("providers") as GeoJSONSource | undefined
  const geojson = buildClusterGeoJSON(providers)

  if (source) {
    source.setData(geojson)
    return
  }

  map.addSource("providers", {
    type: "geojson",
    data: geojson,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: CLUSTER_RADIUS,
  })

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "providers",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "rgba(16, 185, 129, 0.85)",
        10,
        "rgba(5, 150, 105, 0.9)",
        50,
        "rgba(4, 120, 87, 0.95)",
      ],
      "circle-radius": ["step", ["get", "point_count"], 22, 10, 30, 50, 38],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff",
    },
  })

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "providers",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 13,
    },
    paint: { "text-color": "#fff" },
  })

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "providers",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "rgba(16, 185, 129, 0.9)",
      "circle-radius": 8,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff",
    },
  })

  clusterSourceAdded.current = true
}

function removeClusterSource(
  map: MapLibreMap,
  clusterSourceAdded: React.MutableRefObject<boolean>,
) {
  if (!clusterSourceAdded.current) return
  try {
    if (map.getLayer("unclustered-point")) map.removeLayer("unclustered-point")
    if (map.getLayer("cluster-count")) map.removeLayer("cluster-count")
    if (map.getLayer("clusters")) map.removeLayer("clusters")
    if (map.getSource("providers")) map.removeSource("providers")
  } catch {
    /* ignore */
  }
  clusterSourceAdded.current = false
}

// Inject pulse keyframes
if (typeof document !== "undefined") {
  const id = "enhanced-map-pulse-keyframes"
  if (!document.getElementById(id)) {
    const style = document.createElement("style")
    style.id = id
    style.textContent = `
      @keyframes vitrine-map-pulse {
        0%   { transform: scale(0.6); opacity: 0.9; }
        100% { transform: scale(2.0); opacity: 0; }
      }
    `
    document.head.appendChild(style)
  }
}
