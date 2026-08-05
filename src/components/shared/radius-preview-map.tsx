"use client"

/**
 * RadiusPreviewMap — Mapa visual para o prestador ver e ajustar o raio de
 * atendimento durante o onboarding/configuração.
 *
 * Mostra:
 *   - Marcador verde na localização do prestador
 *   - Círculo semi-transparente representando o raio de atendimento
 *   - Slider para ajustar o raio (1–100 km)
 *   - Texto indicando o raio atual
 *
 * Usa MapLibre (já carregado no projeto) e syncRadiusCircle do geo-circle.ts.
 */

import * as React from "react"
import dynamic from "next/dynamic"
import { Navigation, MapPin, Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// MapLibre is client-only — dynamic import with ssr:false
const RadiusMap = dynamic(() => import("./radius-map-inner").then((mod) => mod.RadiusMapInner), {
  ssr: false,
  loading: () => (
    <div className="bg-muted flex h-[300px] items-center justify-center rounded-xl border">
      <Loader2 className="text-muted-foreground size-6 animate-spin" />
    </div>
  ),
})

type Props = {
  /** Latitude do prestador */
  lat?: number | null
  /** Longitude do prestador */
  lng?: number | null
  /** Raio inicial em km (default 10) */
  initialRadius?: number
  /** Chamado quando o raio muda */
  onRadiusChange?: (radiusKm: number) => void
  /** Chamado quando a localização muda (via GPS ou CEP) */
  onLocationChange?: (lat: number, lng: number) => void
  className?: string
  /** Altura do mapa em pixels */
  height?: number
  /** Exibir controles de localização */
  showLocationControls?: boolean
}

export default function RadiusPreviewMap({
  lat,
  lng,
  initialRadius = 10,
  onRadiusChange,
  onLocationChange,
  className,
  height = 300,
  showLocationControls = true,
}: Props) {
  const [radius, setRadius] = React.useState(initialRadius)
  const [locating, setLocating] = React.useState(false)
  // Derived from props — no need for setState in effect
  const hasLocation = lat != null && lng != null

  // GPS location
  const handleLocate = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return
    setLocating(true)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      })
      const newLat = pos.coords.latitude
      const newLng = pos.coords.longitude
      onLocationChange?.(newLat, newLng)
    } catch {
      // silently fail
    } finally {
      setLocating(false)
    }
  }, [onLocationChange])

  const handleRadiusChange = React.useCallback(
    (value: number[]) => {
      const newRadius = value[0] ?? initialRadius
      setRadius(newRadius)
      onRadiusChange?.(newRadius)
    },
    [initialRadius, onRadiusChange],
  )

  return (
    <div className={cn("grid gap-3", className)}>
      {/* Map */}
      <div className="relative overflow-hidden rounded-xl border" style={{ height }}>
        {hasLocation && lat != null && lng != null ? (
          <RadiusMap lat={lat} lng={lng} radius={radius} />
        ) : (
          <div className="bg-muted/30 flex h-full flex-col items-center justify-center gap-3">
            <div className="bg-muted flex size-12 items-center justify-center rounded-full">
              <MapPin className="text-muted-foreground size-6" />
            </div>
            <div className="text-center">
              <p className="text-muted-foreground text-sm font-medium">Localização não definida</p>
              <p className="text-muted-foreground/70 text-xs">
                Use sua localização atual para ver o mapa
              </p>
            </div>
            {showLocationControls && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLocate}
                disabled={locating}
                className="gap-2"
              >
                {locating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Navigation className="size-4" />
                )}
                Usar minha localização
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Radius slider */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground text-xs font-medium">Raio de atendimento</Label>
          <span className="text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
            {radius} km
          </span>
        </div>
        <Slider
          value={[radius]}
          onValueChange={handleRadiusChange}
          min={1}
          max={100}
          step={1}
          disabled={!hasLocation}
          className="[&>span:first-child]:h-2 [&>span:first-child]:bg-emerald-100 [&>span:first-child_span]:bg-emerald-600 [&>span:last-child]:size-4 [&>span:last-child]:border-emerald-600"
          aria-label="Raio de atendimento em quilômetros"
        />
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>1 km</span>
          <span>50 km</span>
          <span>100 km</span>
        </div>
      </div>

      {/* Info text */}
      <p className="text-muted-foreground text-xs">
        <MapPin className="mr-0.5 inline size-3 align-text-top text-emerald-600" />
        Você atenderá clientes num raio de até{" "}
        <strong className="text-foreground">{radius} km</strong> da sua localização. Quanto maior o
        raio, mais clientes poderão te encontrar.
      </p>
    </div>
  )
}
