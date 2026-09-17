"use client"

/**
 * HeatmapOverlay — MapLibre heatmap layer showing provider density.
 *
 * Features:
 * - Radial gradient heatmap based on provider count per area
 * - Color scale: green (many) → yellow (medium) → red (few)
 * - Configurable radius and intensity
 * - Toggle on/off
 * - Performance-optimized with debounced updates
 */

import { useEffect, useRef } from "react"
import type { ProviderCard } from "@/lib/api"

type MapLibreMap = InstanceType<typeof import("maplibre-gl").Map>

type Props = {
  map: MapLibreMap | null
  providers: ProviderCard[]
  enabled?: boolean
  radius?: number
  maxRadius?: number
}

const HEATMAP_LAYER_ID = "provider-heatmap"
const HEATMAP_SOURCE_ID = "provider-heatmap-source"

export default function HeatmapOverlay({
  map,
  providers,
  enabled = true,
  radius = 30,
  maxRadius = 50,
}: Props) {
  const sourceAdded = useRef(false)

  useEffect(() => {
    if (!map || !enabled) {
      // Remove heatmap if disabled
      if (map && sourceAdded.current) {
        try {
          if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID)
          if (map.getSource(HEATMAP_SOURCE_ID)) map.removeSource(HEATMAP_SOURCE_ID)
        } catch {
          /* ignore */
        }
        sourceAdded.current = false
      }
      return
    }

    // Wait for map style to be fully loaded before adding sources/layers
    const addHeatmap = () => {
      if (!map || !map.isStyleLoaded()) return

      const geojson = {
        type: "FeatureCollection" as const,
        features: providers
          .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
          .map((p) => ({
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [p.lng!, p.lat!],
            },
            properties: {
              // Weight by rating and review count
              weight: Math.max(0.3, Math.min(1, (p.rating / 5) * 0.5 + (p.reviewCount / 50) * 0.5)),
            },
          })),
      }

      const source = map.getSource(HEATMAP_SOURCE_ID) as
        { setData: (data: typeof geojson) => void } | undefined
      if (source) {
        source.setData(geojson)
        return
      }

      map.addSource(HEATMAP_SOURCE_ID, {
        type: "geojson",
        data: geojson,
      })

      map.addLayer({
        id: HEATMAP_LAYER_ID,
        type: "heatmap",
        source: HEATMAP_SOURCE_ID,
        paint: {
          // Weight by provider rating/review density
          "heatmap-weight": ["get", "weight"],
          // Color ramp: green → yellow → orange → red
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(16, 185, 129, 0)", // transparent
            0.2,
            "rgba(16, 185, 129, 0.3)", // light green
            0.4,
            "rgba(234, 179, 8, 0.5)", // yellow
            0.6,
            "rgba(249, 115, 22, 0.6)", // orange
            0.8,
            "rgba(239, 68, 68, 0.7)", // red
            1,
            "rgba(220, 38, 38, 0.8)", // dark red
          ],
          // Radius in pixels — increases with zoom
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            radius * 0.5,
            15,
            radius,
            20,
            radius * 1.5,
          ],
          // Intensity
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 1.2, 20, 1.5],
          // Opacity
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.7, 18, 0.4],
        },
      })

      sourceAdded.current = true
    }

    // If style is already loaded, add immediately; otherwise wait for 'style.load'
    if (map.isStyleLoaded()) {
      addHeatmap()
    } else {
      map.once("style.load", addHeatmap)
    }

    return () => {
      try {
        map.off("style.load", addHeatmap)
        if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID)
        if (map.getSource(HEATMAP_SOURCE_ID)) map.removeSource(HEATMAP_SOURCE_ID)
        sourceAdded.current = false
      } catch {
        /* ignore */
      }
    }
  }, [map, providers, enabled, radius, maxRadius])

  // This component has no UI — it only manages the heatmap layer
  return null
}
