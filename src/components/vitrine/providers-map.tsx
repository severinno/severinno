"use client"

/**
 * ProvidersMap — MapLibre GL map of provider markers + user location.
 *
 * SSR-safe: MapLibre is imported lazily inside a `useEffect` (so the component
 * itself can be statically imported, e.g. by `next/dynamic`). Tiles are
 * OpenStreetMap raster tiles (attribution required).
 *
 * When there are > 20 providers, clusters them via MapLibre's built-in
 * GeoJSON clustering for performance.
 *
 * RADIUS CIRCLE + SLIDER:
 *   When `radius` and `onRadiusChange` are provided, a semi-transparent circle
 *   representing the search area is drawn around the user's location. A slider
 *   overlay at the bottom of the map lets the user adjust the radius.
 */

import { useEffect, useRef, useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import { syncRadiusCircle, removeRadiusCircle, type MapLike } from "@/lib/geo-circle"
import { Slider } from "@/components/ui/slider"
import type { ProviderCard } from "@/lib/api"
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

type Props = {
  providers: ProviderCard[]
  userLat?: number | null
  userLng?: number | null
  onSelectProvider?: (id: string) => void
  selectedId?: string | null
  className?: string
  /** Current search radius in km (for the circle + slider). */
  radius?: number
  /** Called when the user adjusts the slider. */
  onRadiusChange?: (radius: number) => void
}

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

const SP_DEFAULT: [number, number] = [-46.6333, -23.5505]

const CLUSTER_MAX_ZOOM = 14
const CLUSTER_RADIUS = 50

type MapLibreMap = InstanceType<typeof import("maplibre-gl").Map>
type MarkerInstance = InstanceType<typeof import("maplibre-gl").Marker>
type PopupInstance = InstanceType<typeof import("maplibre-gl").Popup>

export default function ProvidersMap({
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
  const markersRef = useRef<Record<string, { marker: MarkerInstance; popup: PopupInstance }>>({})
  const userMarkerRef = useRef<MarkerInstance | null>(null)
  const clusterSourceAdded = useRef(false)
  const maplibreglRef = useRef<typeof import("maplibre-gl") | null>(null)
  // Counter incremented when the async map init completes — used to
  // re-trigger the sync effects that depend on a valid mapRef.
  const [mapReady, setMapReady] = useState(0)

  const selectRef = useRef(onSelectProvider)

  // Refs para o fit inicial — o effect de init do mapa roda UMA vez (deps []);
  // ler providers/coords via ref evita recriar o mapa quando o query refetch
  // entrega um array novo (o sync de markers abaixo é quem acompanha updates).
  // Updated in an effect (not during render) to satisfy react-hooks/refs.
  const providersRef = useRef(providers)
  const userLatRef = useRef(userLat)
  const userLngRef = useRef(userLng)

  useEffect(() => {
    selectRef.current = onSelectProvider
    providersRef.current = providers
    userLatRef.current = userLat
    userLngRef.current = userLng
  })

  const hasUserLocation = typeof userLat === "number" && typeof userLng === "number"

  const clusterClickHandler = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current
    if (!map || !e.features?.length) return
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })
    if (!features.length) return
    const clusterId = features[0].properties?.cluster_id
    const source = map.getSource("providers") as GeoJSONSource | undefined
    if (!source || typeof clusterId !== "number") return
    source
      .getClusterExpansionZoom(clusterId)
      .then((zoom) => {
        const geometry = features[0].geometry
        if (geometry.type === "Point") {
          const [lng, lat] = geometry.coordinates
          map.easeTo({ center: { lng, lat }, zoom })
        }
      })
      .catch(() => {
        // cluster source may be gone — ignore
      })
  }, [])

  const clusterMouseHandler = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = e.features?.length ? "pointer" : ""
  }, [])

  // ---- Initialize map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    let cleanup: (() => void) | undefined
    let resizeObserver: ResizeObserver | undefined

    ;(async () => {
      const maplibregl = await import("maplibre-gl")
      if (cancelled || !containerRef.current) return
      maplibreglRef.current = maplibregl

      const map = new maplibregl.Map({
        container: containerRef.current,
        trackResize: true,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [OSM_TILES],
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
        center: SP_DEFAULT,
        zoom: 12,
        attributionControl: { compact: true },
      })

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right")
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: false, // custom marker via syncUserMarker
          showAccuracyCircle: false, // radius circle via syncRadiusCircle
        }),
        "top-right",
      )
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

      map.on("load", () => {
        map.resize()
        fitToBounds(map, providersRef.current, userLatRef.current, userLngRef.current)
      })

      // Multiple resize passes to handle layout settle / animations
      const t1 = window.setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.resize()
          fitToBounds(mapRef.current, providersRef.current, userLatRef.current, userLngRef.current)
        }
      }, 100)

      const t2 = window.setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.resize()
        }
      }, 400)

      if (containerRef.current && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (mapRef.current) {
            mapRef.current.resize()
          }
        })
        resizeObserver.observe(containerRef.current)
      }

      mapRef.current = map
      setMapReady((n) => n + 1)

      cleanup = () => {
        window.clearTimeout(t1)
        window.clearTimeout(t2)
        resizeObserver?.disconnect()
        map.remove()
        mapRef.current = null
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
  }, [])

  // ---- Cluster click/mouse handlers ---------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handleClusterLeave = () => {
      map.getCanvas().style.cursor = ""
    }
    const handleUnclusteredClick = (e: MapLayerMouseEvent) => {
      if (!e.features?.length) return
      const id = e.features[0].properties?.id
      if (id) selectRef.current?.(id)
    }

    map.on("click", "clusters", clusterClickHandler)
    map.on("mouseenter", "clusters", clusterMouseHandler)
    map.on("mouseleave", "clusters", handleClusterLeave)
    map.on("click", "unclustered-point", handleUnclusteredClick)
    return () => {
      map.off("click", "clusters", clusterClickHandler)
      map.off("mouseenter", "clusters", clusterMouseHandler)
      map.off("mouseleave", "clusters", handleClusterLeave)
      map.off("click", "unclustered-point", handleUnclusteredClick)
    }
  }, [clusterClickHandler, clusterMouseHandler])

  // ---- Sync providers → markers or clustered source -----------------------
  useEffect(() => {
    const map = mapRef.current
    const maplibregl = maplibreglRef.current
    if (!map || !maplibregl) return
    let cancelled = false

    const sync = () => {
      if (cancelled || !map.isStyleLoaded()) return
      const useClustering = providers.length > 20
      if (useClustering) {
        syncClusterSource(
          map,
          maplibregl,
          providers,
          selectRef.current,
          markersRef,
          clusterSourceAdded,
        )
      } else {
        removeClusterSource(map, clusterSourceAdded)
        syncProviderMarkers({
          map,
          maplibregl,
          providers,
          selectedId,
          onSelectProvider: selectRef.current,
          markersRef,
        })
      }
      fitToBounds(map, providers, userLat, userLng)
    }

    if (map.isStyleLoaded()) {
      sync()
    } else {
      map.once("style.load", sync)
    }

    return () => {
      cancelled = true
      map.off("style.load", sync)
    }
  }, [providers, selectedId, userLat, userLng, mapReady])

  // ---- Sync user location marker + radius circle --------------------------
  useEffect(() => {
    const map = mapRef.current
    const maplibregl = maplibreglRef.current
    if (!map || !maplibregl) return
    let cancelled = false

    const sync = () => {
      if (cancelled) return
      syncUserMarker({ map, maplibregl, lat: userLat, lng: userLng, userMarkerRef })
      // Sync radius circle whenever user location or radius changes
      if (hasUserLocation && typeof radius === "number" && radius > 0) {
        syncRadiusCircle(map as unknown as MapLike, userLat!, userLng!, radius)
      } else {
        removeRadiusCircle(map as unknown as MapLike)
      }
    }

    if (map.isStyleLoaded()) {
      sync()
    } else {
      map.once("style.load", sync)
    }

    return () => {
      cancelled = true
      map.off("style.load", sync)
    }
  }, [userLat, userLng, radius, hasUserLocation, mapReady])

  return (
    <div
      className={cn(
        "bg-muted relative h-full min-h-[400px] w-full overflow-hidden rounded-xl border",
        className,
      )}
      aria-label="Mapa de prestadores"
      role="application"
    >
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {/* Radius slider overlay — only when user has location and onRadiusChange is provided */}
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
// GeoJSON helpers
// ---------------------------------------------------------------------------

function buildGeoJSON(providers: ProviderCard[]) {
  const features = providers.flatMap((p) => {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return []
    return [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { id: p.id },
      },
    ]
  })
  return {
    type: "FeatureCollection" as const,
    features,
  }
}

function syncClusterSource(
  map: MapLibreMap,
  maplibregl: typeof import("maplibre-gl"),
  providers: ProviderCard[],
  onSelectProvider: ((id: string) => void) | undefined,
  markersRef: React.MutableRefObject<Record<string, MarkerRef>>,
  clusterSourceAdded: React.MutableRefObject<boolean>,
) {
  // Remove existing HTML markers
  const registry = markersRef.current ?? {}
  for (const ref of Object.values(registry)) ref.marker.remove()
  markersRef.current = {}

  const source = map.getSource("providers") as GeoJSONSource | undefined
  const geojson = buildGeoJSON(providers)

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
        "rgba(16, 185, 129, 0.85)", // emerald/500 - <10
        10,
        "rgba(5, 150, 105, 0.9)", // emerald/600 - 10-50
        50,
        "rgba(4, 120, 87, 0.95)", // emerald/700 - 50+
      ],
      "circle-radius": [
        "step",
        ["get", "point_count"],
        22, // <10 providers
        10,
        30,
        50,
        38,
      ],
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
    paint: {
      "text-color": "#fff",
    },
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

// ---------------------------------------------------------------------------
// HTML marker helpers (used when < 20 providers)
// ---------------------------------------------------------------------------

function fitToBounds(
  map: MapLibreMap,
  providers: ProviderCard[],
  userLat?: number | null,
  userLng?: number | null,
) {
  const points: [number, number][] = []
  for (const p of providers) {
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      points.push([p.lng, p.lat])
    }
  }
  if (typeof userLat === "number" && typeof userLng === "number") {
    points.push([userLng, userLat])
  }
  if (points.length === 0) return
  if (points.length === 1) {
    map.setCenter(points[0])
    map.setZoom(14)
    return
  }
  let west = points[0][0]
  let south = points[0][1]
  let east = points[0][0]
  let north = points[0][1]
  for (const [lng, lat] of points) {
    if (lng < west) west = lng
    if (lat < south) south = lat
    if (lng > east) east = lng
    if (lat > north) north = lat
  }
  const pad = 0.005
  const bounds: [[number, number], [number, number]] = [
    [west - pad, south - pad],
    [east + pad, north + pad],
  ]
  try {
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 })
  } catch {
    /* ignore */
  }
}

type MarkerRef = { marker: MarkerInstance; popup: PopupInstance }

function syncProviderMarkers(opts: {
  map: MapLibreMap
  maplibregl: typeof import("maplibre-gl")
  providers: ProviderCard[]
  selectedId?: string | null
  onSelectProvider?: (id: string) => void
  markersRef: React.RefObject<Record<string, MarkerRef>>
}) {
  const { map, maplibregl, providers, selectedId, onSelectProvider, markersRef } = opts
  const registry = markersRef.current ?? {}

  for (const [id, ref] of Object.entries(registry)) {
    if (!providers.some((p) => p.id === id)) {
      ref.marker.remove()
      delete registry[id]
    }
  }

  for (const provider of providers) {
    if (typeof provider.lat !== "number" || typeof provider.lng !== "number") continue
    const existing = registry[provider.id]
    const isSelected = selectedId === provider.id

    if (existing) {
      existing.marker.getElement().dataset.selected = isSelected ? "true" : "false"
      continue
    }

    const el = document.createElement("button")
    el.type = "button"
    el.className = "vitrine-map-marker"
    el.dataset.selected = isSelected ? "true" : "false"
    el.dataset.verified = provider.verified ? "true" : "false"
    el.setAttribute("aria-label", `Ver ${provider.name} no mapa`)
    el.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 6px;
      border-radius: 9999px;
      border: 1px solid rgba(255,255,255,0.85);
      background: var(--primary);
      color: var(--primary-foreground);
      font-size: 12px; font-weight: 600; line-height: 1;
      box-shadow: 0 4px 12px -2px rgba(0,0,0,0.25);
      cursor: pointer;
      transform: translate(-50%, -100%);
      transition: transform 120ms ease, box-shadow 120ms ease;
    `

    const star = document.createElement("span")
    star.textContent = "★"
    star.style.color = "#facc15"
    el.appendChild(star)

    const rating = document.createElement("span")
    rating.textContent = provider.rating > 0 ? `${provider.rating.toFixed(1)}` : "Novo"
    el.appendChild(rating)

    const sep = document.createElement("span")
    sep.textContent = "·"
    sep.style.opacity = "0.6"
    el.appendChild(sep)

    const price = document.createElement("span")
    const min = provider.services?.[0]?.basePrice
    price.textContent = typeof min === "number" ? `a partir de ${formatBRL(min)}` : "Ver"
    el.appendChild(price)

    el.addEventListener("click", (e) => {
      e.stopPropagation()
      onSelectProvider?.(provider.id)
    })
    el.addEventListener("mouseenter", () => {
      el.style.transform = "translate(-50%, -100%) scale(1.06)"
    })
    el.addEventListener("mouseleave", () => {
      el.style.transform = "translate(-50%, -100%) scale(1)"
    })

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 18,
      className: "map-popup",
      maxWidth: "260px",
    }).setHTML(
      `<div class="p-3 text-sm">
        <div class="font-semibold leading-tight">${escapeHtml(provider.name)}</div>
        <div class="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
          <span>★ ${provider.rating.toFixed(1)} (${provider.reviewCount})</span>
          ${provider.city ? `<span>·</span><span>${escapeHtml(provider.city)}</span>` : ""}
          ${typeof provider.distanceKm === "number" ? `<span>·</span><span>${formatDistance(provider.distanceKm)}</span>` : ""}
        </div>
        ${provider.verified ? `<div class="mt-1 text-[11px] font-medium text-primary">✓ Verificado</div>` : ""}
      </div>`,
    )

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([provider.lng, provider.lat])
      .setPopup(popup)
      .addTo(map)

    el.addEventListener("mouseenter", () => popup.addTo(map))
    el.addEventListener("mouseleave", () => popup.remove())

    registry[provider.id] = { marker, popup }
  }

  markersRef.current = registry
}

function syncUserMarker(opts: {
  map: MapLibreMap
  maplibregl: typeof import("maplibre-gl")
  lat?: number | null
  lng?: number | null
  userMarkerRef: React.RefObject<MarkerInstance | null>
}) {
  const { map, maplibregl, lat, lng, userMarkerRef } = opts
  if (userMarkerRef.current) {
    userMarkerRef.current.remove()
    userMarkerRef.current = null
  }
  if (typeof lat !== "number" || typeof lng !== "number") return

  const el = document.createElement("div")
  el.setAttribute("aria-label", "Sua localização")
  el.style.cssText = `
    width: 18px; height: 18px;
    border-radius: 9999px;
    background: #2563eb;
    border: 3px solid white;
    box-shadow: 0 0 0 4px rgba(37,99,235,0.25), 0 2px 8px rgba(0,0,0,0.25);
    position: relative;
  `
  const pulse = document.createElement("span")
  pulse.style.cssText = `
    position: absolute; inset: -6px;
    border-radius: 9999px;
    border: 2px solid rgba(37,99,235,0.55);
    animation: vitrine-map-pulse 1.6s ease-out infinite;
  `
  el.appendChild(pulse)

  const marker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(map)
  userMarkerRef.current = marker
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

if (typeof document !== "undefined") {
  const id = "vitrine-map-pulse-keyframes"
  if (!document.getElementById(id)) {
    const style = document.createElement("style")
    style.id = id
    style.textContent = `
      @keyframes vitrine-map-pulse {
        0%   { transform: scale(0.6); opacity: 0.9; }
        100% { transform: scale(2.0); opacity: 0; }
      }
      .vitrine-map-marker[data-selected="true"] {
        z-index: 10 !important;
        box-shadow: 0 0 0 4px color-mix(in oklch, var(--primary) 35%, transparent), 0 6px 18px -2px rgba(0,0,0,0.35) !important;
        transform: translate(-50%, -100%) scale(1.08) !important;
      }
      .vitrine-map-marker[data-verified="false"] {
        background: var(--muted-foreground);
      }
    `
    document.head.appendChild(style)
  }
}
