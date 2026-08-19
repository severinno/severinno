"use client"

/**
 * InteractiveGeoMap — 100% Open Source Vector/Raster Map using MapLibre GL.
 *
 * Features:
 * - High performance WebGL rendering with OpenStreetMap / CARTO tiles
 * - Custom price-tag markers (e.g. "R$ 120")
 * - Interactive Popup cards with Provider Profile, Rating and Verified Badge
 * - Floating "Buscar nesta área do mapa" button on drag/pan
 */

import * as React from "react"
import maplibregl, { Map as MapLibreMap, Marker, Popup } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { Loader2, RefreshCw } from "lucide-react"

import { formatBRL } from "@/lib/format"
import { Button } from "@/components/ui/button"

export type MapProviderPin = {
  id: string
  name: string
  avatarUrl?: string | null
  verified: boolean
  avgRating: number
  reviewCount: number
  lat: number
  lng: number
  minPrice: number
  city?: string | null
}

type InteractiveGeoMapProps = {
  centerLat?: number
  centerLng?: number
  zoom?: number
  providers: MapProviderPin[]
  onSelectProvider?: (providerId: string) => void
  onBoundsChange?: (bounds: {
    minLat: number
    minLng: number
    maxLat: number
    maxLng: number
  }) => void
  className?: string
}

export function InteractiveGeoMap({
  centerLat = -23.5505,
  centerLng = -46.6333,
  zoom = 13,
  providers,
  onSelectProvider,
  onBoundsChange,
  className = "w-full h-[450px] rounded-2xl overflow-hidden",
}: InteractiveGeoMapProps) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapInstanceRef = React.useRef<MapLibreMap | null>(null)
  const markersRef = React.useRef<Marker[]>([])
  const [mapMoved, setMapMoved] = React.useState(false)
  const [loadingBbox, setLoadingBbox] = React.useState(false)

  // Initialize MapLibre GL
  React.useEffect(() => {
    if (!mapContainerRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
      center: [centerLng, centerLat],
      zoom,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right")

    map.on("dragend", () => {
      setMapMoved(true)
    })

    map.on("zoomend", () => {
      setMapMoved(true)
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Render provider pins
  React.useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    // Clear old markers
    for (const m of markersRef.current) {
      m.remove()
    }
    markersRef.current = []

    // Add new markers
    for (const p of providers) {
      if (!p.lat || !p.lng) continue

      // Custom marker DOM element
      const el = document.createElement("div")
      el.className = "group relative cursor-pointer"
      el.innerHTML = `
        <div class="flex items-center gap-1 rounded-full border-2 border-white bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white shadow-lg transition-transform group-hover:scale-110 group-hover:bg-emerald-700">
          <span>${p.minPrice > 0 ? formatBRL(p.minPrice) : "Ver"}</span>
          ${p.verified ? `<svg class="size-3 text-emerald-200 inline" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>` : ""}
        </div>
      `

      // Popup content
      const popupHtml = `
        <div class="p-2 space-y-2 text-zinc-900 min-w-[180px]">
          <div class="flex items-center gap-2">
            <div class="size-9 rounded-full bg-emerald-100 flex items-center justify-center font-bold text-emerald-800 text-xs border">
              ${p.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div class="flex items-center gap-1">
                <span class="font-bold text-xs">${p.name}</span>
                ${p.verified ? `<span class="text-emerald-600 text-[10px]">✔</span>` : ""}
              </div>
              <div class="flex items-center gap-1 text-[11px] text-zinc-500">
                <span class="text-amber-500 font-bold">★ ${p.avgRating.toFixed(1)}</span>
                <span>(${p.reviewCount})</span>
              </div>
            </div>
          </div>
          <div class="text-xs font-semibold text-emerald-700">
            ${p.minPrice > 0 ? `a partir de ${formatBRL(p.minPrice)}` : "Sob consulta"}
          </div>
          <button id="btn-view-${p.id}" class="w-full rounded bg-emerald-600 py-1 text-center text-xs font-bold text-white hover:bg-emerald-700">
            Ver Perfil
          </button>
        </div>
      `

      const popup = new Popup({ offset: 25, closeButton: false }).setHTML(popupHtml)

      popup.on("open", () => {
        const btn = document.getElementById(`btn-view-${p.id}`)
        if (btn) {
          btn.onclick = () => onSelectProvider?.(p.id)
        }
      })

      const marker = new Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map)

      markersRef.current.push(marker)
    }
  }, [providers, onSelectProvider])

  // Handle Search this Area
  const handleSearchArea = () => {
    const map = mapInstanceRef.current
    if (!map) return

    setLoadingBbox(true)
    const bounds = map.getBounds()
    onBoundsChange?.({
      minLat: bounds.getSouth(),
      minLng: bounds.getWest(),
      maxLat: bounds.getNorth(),
      maxLng: bounds.getEast(),
    })
    setMapMoved(false)
    setLoadingBbox(false)
  }

  return (
    <div className={`relative ${className}`}>
      <div ref={mapContainerRef} className="size-full" />

      {/* Floating "Search This Area" Button */}
      {mapMoved && (
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2">
          <Button
            onClick={handleSearchArea}
            disabled={loadingBbox}
            className="h-9 gap-2 rounded-full bg-emerald-600 px-4 text-xs font-semibold text-white shadow-xl transition-all hover:scale-105 hover:bg-emerald-700"
          >
            {loadingBbox ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Buscar nesta área do mapa
          </Button>
        </div>
      )}
    </div>
  )
}
