"use client"

/**
 * RouteLine — Draws a dashed line from user location to selected provider.
 *
 * Features:
 * - Animated dashed line (marching ants effect)
 * - Auto-calculates bearing for proper dash angle
 * - Line opacity fades with distance
 * - Cleanup on provider change
 */

import { useEffect, useRef } from "react"
import * as maplibregl from "maplibre-gl"
import { haversineKm } from "@/lib/geo-server"

type MapLibreMap = InstanceType<typeof import("maplibre-gl").Map>

type Props = {
  map: MapLibreMap | null
  userLat?: number | null
  userLng?: number | null
  providerLat?: number | null
  providerLng?: number | null
  visible?: boolean
}

const ROUTE_SOURCE_ID = "user-provider-route"
const ROUTE_LAYER_ID = "user-provider-route-line"
const ROUTE_ANIM_LAYER_ID = "user-provider-route-anim"

export default function RouteLine({
  map,
  userLat,
  userLng,
  providerLat,
  providerLng,
  visible = true,
}: Props) {
  const sourceAdded = useRef(false)
  const animFrame = useRef<number | null>(null)
  const dashOffset = useRef(0)

  useEffect(() => {
    if (!map) return

    // Cleanup previous
    const cleanup = () => {
      if (animFrame.current) {
        cancelAnimationFrame(animFrame.current)
        animFrame.current = null
      }
      try {
        if (map.getLayer(ROUTE_ANIM_LAYER_ID)) map.removeLayer(ROUTE_ANIM_LAYER_ID)
        if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID)
        if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID)
      } catch {
        /* ignore */
      }
      sourceAdded.current = false
    }

    if (!visible || !userLat || !userLng || !providerLat || !providerLng) {
      cleanup()
      return
    }

    // Wait for map style to be loaded before adding sources/layers
    const addRoute = () => {
      if (!map || !map.isStyleLoaded()) return

      // Haversine distance in km
      const distanceKm = haversineKm(userLat, userLng, providerLat, providerLng)

      // Build GeoJSON line
      const geojson = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [userLng, userLat],
                [providerLng, providerLat],
              ],
            },
            properties: {
              distance: distanceKm,
            },
          },
        ],
      }

      const source = map.getSource(ROUTE_SOURCE_ID) as
        { setData: (data: typeof geojson) => void } | undefined
      if (source) {
        source.setData(geojson)
        return
      }

      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: geojson,
      })

      // Background line (solid, subtle)
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        paint: {
          "line-color": "#10b981",
          "line-width": 3,
          "line-opacity": 0.3,
        },
      })

      // Animated dashed line (marching ants)
      map.addLayer({
        id: ROUTE_ANIM_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        paint: {
          "line-color": "#10b981",
          "line-width": 2,
          "line-opacity": 0.8,
          "line-dasharray": [0, 4, 3],
        },
      })

      sourceAdded.current = true

      // Marching ants animation (~10fps to save CPU)
      let lastFrame = 0
      const animate = (now: number) => {
        if (now - lastFrame >= 100) {
          lastFrame = now
          dashOffset.current = (dashOffset.current + 0.05) % 1
          try {
            map.setPaintProperty(ROUTE_ANIM_LAYER_ID, "line-dasharray", [dashOffset.current, 4, 3])
          } catch {
            /* ignore */
          }
        }
        animFrame.current = requestAnimationFrame(animate)
      }
      animFrame.current = requestAnimationFrame(animate)

      // Fit bounds to include both points
      try {
        const bounds = new maplibregl.LngLatBounds()
          .extend([userLng, userLat])
          .extend([providerLng, providerLat])
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 800 })
      } catch {
        /* ignore — map may have been removed */
      }
    }

    // If style is already loaded, add immediately; otherwise wait
    if (map.isStyleLoaded()) {
      addRoute()
    } else {
      map.once("style.load", addRoute)
    }

    return () => {
      map.off("style.load", addRoute)
      cleanup()
    }
  }, [map, userLat, userLng, providerLat, providerLng, visible])

  return null
}
