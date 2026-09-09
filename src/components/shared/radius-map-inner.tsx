"use client"

/**
 * RadiusMapInner — Inner map component for RadiusPreviewMap.
 *
 * Renders a MapLibre map with the provider marker and radius circle.
 * Dynamically imported to avoid SSR issues.
 */

import * as React from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import { syncRadiusCircle, removeRadiusCircle, type MapLike } from "@/lib/geo-circle"

type Props = {
  lat: number
  lng: number
  radius: number
}

export function RadiusMapInner({ lat, lng, radius }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<maplibregl.Map | null>(null)

  React.useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [lng, lat],
      zoom: 9,
      attributionControl: false,
    })

    map.on("load", () => {
      // Provider marker
      const el = document.createElement("div")
      el.className =
        "flex size-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg border-2 border-white"
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

      new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)

      // Radius circle
      syncRadiusCircle(map as unknown as MapLike, lat, lng, radius)
    })

    mapRef.current = map

    return () => {
      removeRadiusCircle(map as unknown as MapLike)
      map.remove()
      mapRef.current = null
    }
  }, [lat, lng, radius])

  // Update radius circle when radius prop changes
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    // Remove old circle, re-add new one
    try {
      removeRadiusCircle(map as unknown as MapLike)
      syncRadiusCircle(map as unknown as MapLike, lat, lng, radius)
    } catch {
      // map may not be fully loaded
    }
  }, [radius, lat, lng])

  return (
    <div
      ref={containerRef}
      className="size-full"
      aria-label="Mapa de visualização do raio de atendimento"
    />
  )
}
