/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

/**
 * AdminCoverageMap — Coverage Heat Map for Provider Service Areas.
 *
 * Renders a MapLibre map showing:
 *   - Semi-transparent radius circles for every provider (individual layers)
 *   - Grid overlay as a SINGLE GeoJSON source with data-driven fill-color
 *   - Summary KPI cards (total providers, with location, coverage %, gap %)
 *
 * Data source: GET /api/admin/coverage
 *
 * Performance notes:
 *   - Grid cells are rendered as a single GeoJSON FeatureCollection with a
 *     data-driven paint expression — avoids thousands of individual layers.
 *   - Map is initialized once (empty deps). Data updates use setData() on
 *     existing sources, avoiding full map recreation on every refetch.
 *   - Grid computation runs server-side and is cached in Redis (if available).
 */

import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, MapPin, RefreshCw, Users } from "lucide-react"
import { ErrorState, RefreshButton } from "./_shared"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

import { preloadMaplibreGl } from "@/components/shared/provider-mini-map"

import type { CoverageResponse } from "@/app/api/admin/coverage/route"

// ── Constants ─────────────────────────────────────────────────────────────

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

const DENSITY_COLORS_STOPS = [
  0,
  "rgba(239, 68, 68, 0.35)", // red-500
  1,
  "rgba(249, 115, 22, 0.30)", // orange-500
  2,
  "rgba(234, 179, 8, 0.25)", // yellow-500
  3,
  "rgba(132, 204, 22, 0.20)", // lime-500
  4,
  "rgba(34, 197, 94, 0.15)", // green-500
] as const

const DENSITY_SWATCHES = [
  { color: DENSITY_COLORS_STOPS[1]!, label: "Sem cobertura" },
  { color: DENSITY_COLORS_STOPS[3]!, label: "1 prestador" },
  { color: DENSITY_COLORS_STOPS[5]!, label: "2 prestadores" },
  { color: DENSITY_COLORS_STOPS[7]!, label: "3–4 prestadores" },
  { color: DENSITY_COLORS_STOPS[9]!, label: "5+ prestadores" },
]

// ── Helpers ──────────────────────────────────────────────────────────────

function buildGridFeatureCollection(
  grid: CoverageResponse["grid"],
  halfDeg = 0.045,
): Record<string, unknown> {
  return {
    type: "FeatureCollection" as const,
    features: grid.map((cell) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [cell.lng - halfDeg, cell.lat - halfDeg],
            [cell.lng + halfDeg, cell.lat - halfDeg],
            [cell.lng + halfDeg, cell.lat + halfDeg],
            [cell.lng - halfDeg, cell.lat + halfDeg],
            [cell.lng - halfDeg, cell.lat - halfDeg],
          ],
        ],
      },
      properties: { density: Math.min(cell.density, 5) },
    })),
  }
}

function circleGeoJSON(
  lat: number,
  lng: number,
  radiusKm: number,
  points = 36,
): Record<string, unknown> {
  const numPoints = Math.max(3, Math.round(points))
  const coords: number[][] = []
  const kmPerDegLat = 111.32
  const latRad = (lat * Math.PI) / 180
  const kmPerDegLng = 111.32 * Math.cos(latRad)
  for (let i = 0; i <= numPoints; i++) {
    const bearing = (i * 360) / numPoints
    const bearingRad = (bearing * Math.PI) / 180
    coords.push([
      lng + (radiusKm / kmPerDegLng) * Math.sin(bearingRad),
      lat + (radiusKm / kmPerDegLat) * Math.cos(bearingRad),
    ])
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] },
    properties: {},
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export function AdminCoverageMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const initRef = useRef(false)
  const fitDoneRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(false)

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "coverage"],
    queryFn: () => apiGet<CoverageResponse>("/api/admin/coverage"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  // ── Initialize MapLibre once (or retry on mapError reset) ──────────
  useEffect(() => {
    if (!containerRef.current || initRef.current) return

    let cancelled = false
    let cleanup: (() => void) | null = null

    preloadMaplibreGl()

    ;(async () => {
      try {
        const maplibreglModule = await import("maplibre-gl")
        await import("maplibre-gl/dist/maplibre-gl.css")
        if (cancelled || !containerRef.current) return

        const maplibregl = maplibreglModule as typeof import("maplibre-gl")

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [TILE_URL],
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
          center: [-46.6333, -23.5505], // São Paulo (fallback)
          zoom: 4,
          attributionControl: { compact: true },
          scrollZoom: true,
          dragPan: true,
        })

        // Register persistent sources + layers so setData() has targets
        map.on("load", () => {
          if (cancelled) return
          initRef.current = true
          setMapReady(true)

          // Coverage grid (single source + data-driven paint)
          map.addSource("coverage-grid", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          })
          map.addLayer({
            id: "coverage-grid-fill",
            type: "fill",
            source: "coverage-grid",
            paint: {
              "fill-color": ["step", ["get", "density"], ...DENSITY_COLORS_STOPS] as any,
              "fill-opacity": 0.6,
            },
          })

          // Provider radius circles (persistent, updated via setData)
          map.addSource("provider-circles", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          })
          map.addLayer({
            id: "fill-all",
            type: "fill",
            source: "provider-circles",
            paint: { "fill-color": "#059669", "fill-opacity": 0.06 },
          })
          map.addLayer({
            id: "outline-all",
            type: "line",
            source: "provider-circles",
            paint: {
              "line-color": "#059669",
              "line-opacity": 0.2,
              "line-width": 1,
            },
          })

          // Provider markers (persistent, updated via setData)
          map.addSource("provider-markers", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          })
          map.addLayer({
            id: "provider-marker-dots",
            type: "circle",
            source: "provider-markers",
            paint: {
              "circle-color": "#059669",
              "circle-radius": 5,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          })
        })

        mapRef.current = map

        cleanup = () => {
          initRef.current = false
          map.remove()
        }
      } catch {
        if (!cancelled) setMapError(true)
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [mapError])

  // ── Update data when response changes ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const mapLoad = map?.loaded?.() ?? false
    if (!map || !mapLoad || !data || !data.bounds) return
    if (!initRef.current) return

    try {
      const { providers, grid, bounds } = data

      // Update provider circles via setData (source already exists from init)
      const circleSrc = map.getSource("provider-circles")
      if (circleSrc) {
        const circleFeatures: Record<string, unknown>[] = []
        for (const p of providers) {
          circleFeatures.push({
            ...circleGeoJSON(p.lat, p.lng, p.radiusKm),
            properties: { name: p.name, id: p.id },
          })
        }
        ;(circleSrc as any).setData({
          type: "FeatureCollection",
          features: circleFeatures,
        })
      }

      // Update grid data via setData
      const gridSrc = map.getSource("coverage-grid")
      if (gridSrc) {
        ;(gridSrc as any).setData(buildGridFeatureCollection(grid))
      }

      // Update provider markers via setData
      const markerSrc = map.getSource("provider-markers")
      if (markerSrc) {
        const markers = providers.map((p) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
          properties: { name: p.name, radius: p.radiusKm, city: p.city },
        }))
        ;(markerSrc as any).setData({
          type: "FeatureCollection",
          features: markers,
        })
      }

      // Fit bounds only on the first meaningful data load
      if (bounds && !fitDoneRef.current) {
        fitDoneRef.current = true
        map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          { padding: 60, maxZoom: 12 },
        )
      }
    } catch {
      // data update failed silently
    }
  }, [data])

  // ── Derived stats ──────────────────────────────────────────────────
  const coveragePct =
    data && data.total > 0 ? Math.round((data.withLocation / data.total) * 100) : 0

  const gaps = data?.grid?.filter((c) => c.gap).length ?? 0
  const totalCells = data?.grid?.length ?? 0
  const gapPct = totalCells > 0 ? Math.round((gaps / totalCells) * 100) : 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">Mapa de Cobertura</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Sobreposição dos raios de atendimento dos prestadores
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dataUpdatedAt ? (
            <span className="text-muted-foreground text-xs">
              Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
            </span>
          ) : null}
          <RefreshButton
            isFetching={isFetching}
            onRefresh={() => void refetch()}
            label="Atualizar mapa"
          />
        </div>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section
        aria-label="Indicadores de cobertura"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        <KpiCard
          icon={Users}
          label="Prestadores ativos"
          value={data?.total.toLocaleString("pt-BR") ?? "—"}
        />
        <KpiCard
          icon={MapPin}
          label="Com localização"
          value={data?.withLocation.toLocaleString("pt-BR") ?? "—"}
          subtitle={data ? `${coveragePct}% do total` : undefined}
        />
        <KpiCard
          icon={coveragePct >= 50 ? CheckCircle2 : AlertTriangle}
          label="Cobertura"
          value={data ? `${coveragePct}%` : "—"}
          subtitle={data ? `${data.withLocation}/${data.total} prestadores` : undefined}
          trend={data && coveragePct < 50 ? "up" : "down"}
        />
        <KpiCard
          icon={gapPct > 20 ? AlertTriangle : CheckCircle2}
          label="Áreas com lacuna"
          value={data ? `${gapPct}%` : "—"}
          subtitle={data ? `${gaps} de ${totalCells} células` : undefined}
          trend={gapPct > 20 ? "up" : "down"}
        />
      </section>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center gap-4 rounded-lg border px-4 py-2.5 text-xs">
        <span className="text-muted-foreground font-medium">Densidade:</span>
        {DENSITY_SWATCHES.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {/* ── Error / Loading / Map ────────────────────────────────────── */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar o mapa de cobertura"
          description="Verifique sua autenticação como administrador."
          onRetry={() => void refetch()}
        />
      ) : isLoading || !data ? (
        <CoverageSkeleton />
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border">
          {/* Map container */}
          <div ref={containerRef} className="h-[600px] w-full" />

          {/* Map loading overlay */}
          {!mapReady && !mapError && (
            <div className="bg-muted/50 flex h-[600px] items-center justify-center">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          )}

          {/* Map init error fallback */}
          {mapError && (
            <div className="bg-muted flex h-[600px] flex-col items-center justify-center gap-3 rounded-xl border">
              <AlertTriangle className="size-8 text-amber-500" />
              <p className="text-muted-foreground text-sm font-medium">
                Mapa interativo indisponível
              </p>
              <p className="text-muted-foreground text-xs">
                Verifique sua conexão e tente novamente.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMapError(false)
                  setMapReady(false)
                  initRef.current = false
                }}
                className="bg-background text-foreground hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors"
              >
                <RefreshCw className="size-3.5" />
                Tentar novamente
              </button>
            </div>
          )}

          {/* Footer meta */}
          <div className="text-muted-foreground border-t px-4 py-2.5 text-[10px]">
            {data.providers.length} prestadores com raio de atendimento configurado · {totalCells}{" "}
            células de grade analisadas
            {gaps > 0 && ` · ${gaps} células com baixa cobertura (< 2 prestadores)`}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
}: {
  icon: React.ElementType
  label: string
  value: string
  subtitle?: string
  trend?: "up" | "down"
}) {
  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <div className="flex items-start justify-between">
        <span className="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </span>
        {trend ? (
          trend === "up" ? (
            <AlertTriangle className="size-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      {subtitle ? <p className="text-muted-foreground mt-0.5 text-[10px]">{subtitle}</p> : null}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function CoverageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[600px] w-full rounded-xl" />
    </div>
  )
}
