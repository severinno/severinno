"use client"

/**
 * ProviderServiceZoneEditor — Interactive polygon drawing tool on MapLibre GL.
 *
 * Allows providers to draw, edit, and save their custom service zone
 * directly on the map using vertex clicks.
 */

import * as React from "react"
import maplibregl, { Map as MapLibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import {
  Loader2,
  MapPin,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiGet, apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

type ServiceZoneResponse = {
  ok: boolean
  polygon: GeoJSONPolygon | null
  center: { lat: number; lng: number } | null
  radiusKm: number
}

type GeoJSONPolygon = {
  type: "Polygon"
  coordinates: number[][][]
}

export function ProviderServiceZoneEditor() {
  const queryClient = useQueryClient()
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const [vertices, setVertices] = React.useState<[number, number][]>([])
  const [isDrawing, setIsDrawing] = React.useState(false)

  const { data, isLoading } = useQuery<ServiceZoneResponse>({
    queryKey: ["provider-service-zone"],
    queryFn: () => apiGet<ServiceZoneResponse>("/api/provider/service-zone"),
  })

  const saveMutation = useMutation({
    mutationFn: (polygon: GeoJSONPolygon) =>
      apiPost("/api/provider/service-zone", { polygon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-service-zone"] })
      toast.success("Zona de atendimento salva com sucesso!")
      setIsDrawing(false)
    },
    onError: () => {
      toast.error("Erro ao salvar zona de atendimento")
    },
  })

  const centerLat = data?.center?.lat ?? -23.5505
  const centerLng = data?.center?.lng ?? -46.6333

  // Initialize map
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
              '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
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
      zoom: 12,
    })

    map.addControl(new maplibregl.NavigationControl(), "top-right")

    mapRef.current = map

    return () => {
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recenter map when data loads
  React.useEffect(() => {
    if (mapRef.current && data?.center) {
      mapRef.current.flyTo({
        center: [data.center.lng, data.center.lat],
        zoom: 12,
      })
    }
  }, [data?.center])

  // Draw existing polygon on the map
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !data?.polygon) return

    const drawExisting = () => {
      if (map.getSource("service-zone")) {
        map.removeLayer("service-zone-fill")
        map.removeLayer("service-zone-outline")
        map.removeSource("service-zone")
      }

      map.addSource("service-zone", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: data.polygon!,
        },
      })

      map.addLayer({
        id: "service-zone-fill",
        type: "fill",
        source: "service-zone",
        paint: {
          "fill-color": "#059669",
          "fill-opacity": 0.15,
        },
      })

      map.addLayer({
        id: "service-zone-outline",
        type: "line",
        source: "service-zone",
        paint: {
          "line-color": "#059669",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      })
    }

    if (map.isStyleLoaded()) {
      drawExisting()
    } else {
      map.on("load", drawExisting)
    }
  }, [data?.polygon])

  // Click handler for drawing mode
  React.useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!isDrawing) return
      const point: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      setVertices((prev) => [...prev, point])
    }

    map.on("click", handleClick)
    return () => {
      map.off("click", handleClick)
    }
  }, [isDrawing])

  // Render live polygon as user draws
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !isDrawing) return

    const renderDraft = () => {
      if (map.getSource("draft-zone")) {
        map.removeLayer("draft-zone-fill")
        map.removeLayer("draft-zone-outline")
        map.removeLayer("draft-zone-vertices")
        map.removeSource("draft-zone")
      }

      if (vertices.length < 2) return

      const ring = [...vertices, vertices[0]]

      map.addSource("draft-zone", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [ring],
              },
            },
            ...vertices.map((v, i) => ({
              type: "Feature" as const,
              properties: { index: i },
              geometry: {
                type: "Point" as const,
                coordinates: v,
              },
            })),
          ],
        },
      })

      map.addLayer({
        id: "draft-zone-fill",
        type: "fill",
        source: "draft-zone",
        filter: ["==", "$type", "Polygon"],
        paint: {
          "fill-color": "#059669",
          "fill-opacity": 0.2,
        },
      })

      map.addLayer({
        id: "draft-zone-outline",
        type: "line",
        source: "draft-zone",
        filter: ["==", "$type", "Polygon"],
        paint: {
          "line-color": "#059669",
          "line-width": 2,
        },
      })

      map.addLayer({
        id: "draft-zone-vertices",
        type: "circle",
        source: "draft-zone",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#059669",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      })
    }

    if (map.isStyleLoaded()) {
      renderDraft()
    }
  }, [vertices, isDrawing])

  const startDrawing = () => {
    setVertices([])
    setIsDrawing(true)

    const map = mapRef.current
    if (map) {
      // Clear existing polygon
      if (map.getSource("service-zone")) {
        map.removeLayer("service-zone-fill")
        map.removeLayer("service-zone-outline")
        map.removeSource("service-zone")
      }
    }
  }

  const cancelDrawing = () => {
    setIsDrawing(false)
    setVertices([])

    const map = mapRef.current
    if (map && map.getSource("draft-zone")) {
      map.removeLayer("draft-zone-fill")
      map.removeLayer("draft-zone-outline")
      map.removeLayer("draft-zone-vertices")
      map.removeSource("draft-zone")
    }
  }

  const saveZone = () => {
    if (vertices.length < 3) {
      toast.error("Desenhe no mínimo 3 pontos no mapa para formar uma zona")
      return
    }

    const ring = [...vertices, vertices[0]]
    const polygon: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [ring],
    }

    saveMutation.mutate(polygon)
  }

  if (isLoading) {
    return (
      <Card className="rounded-xl border shadow-sm">
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-emerald-600" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-xl border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <MapPin className="size-5 text-emerald-600" />
            Zona de Atendimento Personalizada
          </CardTitle>
          {data?.polygon && !isDrawing && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✔ Zona configurada
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Desenhe no mapa os bairros e regiões exatas que deseja atender.
          Clientes fora desta zona não poderão solicitar seus serviços.
        </p>

        {/* Map container */}
        <div className="relative h-[400px] w-full rounded-xl overflow-hidden border">
          <div ref={mapContainerRef} className="size-full" />

          {isDrawing && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xl">
              📍 Clique no mapa para adicionar pontos ({vertices.length} vértice{vertices.length !== 1 ? "s" : ""})
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {!isDrawing ? (
            <Button
              onClick={startDrawing}
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <Pencil className="size-3.5" />
              {data?.polygon ? "Redesenhar Zona" : "Desenhar Zona"}
            </Button>
          ) : (
            <>
              <Button
                onClick={saveZone}
                disabled={vertices.length < 3 || saveMutation.isPending}
                size="sm"
                className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Salvar Zona ({vertices.length} pontos)
              </Button>
              <Button
                onClick={() => setVertices((prev) => prev.slice(0, -1))}
                disabled={vertices.length === 0}
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
              >
                <RotateCcw className="size-3.5" />
                Desfazer
              </Button>
              <Button
                onClick={cancelDrawing}
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="size-3.5" />
                Cancelar
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
