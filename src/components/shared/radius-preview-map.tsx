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
 *   - Raio inicial sugerido pela precisão do GPS (accuracy)
 *
 * Usa MapLibre (já carregado no projeto) e syncRadiusCircle do geo-circle.ts.
 */

import * as React from "react"
import dynamic from "next/dynamic"
import { Navigation, MapPin, Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { nearbyPhrase, suggestRadiusFromAccuracy } from "@/lib/geo-radius"
import { refineSuggestedRadius } from "@/lib/geo-density"
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
  /** Precisão da fix do GPS em metros (±) — círculo pontilhado de incerteza no mapa */
  accuracyM?: number | null
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
  accuracyM,
  initialRadius = 10,
  onRadiusChange,
  onLocationChange,
  className,
  height = 300,
  showLocationControls = true,
}: Props) {
  const [radius, setRadius] = React.useState(initialRadius)
  const [locating, setLocating] = React.useState(false)
  // Dica de precisão (após GPS interno): "±X m — raio sugerido: Y km".
  const [accuracyHint, setAccuracyHint] = React.useState<string | null>(null)
  // Precisão capturada pelo GPS interno — tem precedência sobre a prop
  // externa (é a ação do usuário mais recente dentro do mapa).
  const [gpsAccuracyM, setGpsAccuracyM] = React.useState<number | null>(null)
  // Token do refino assíncrono por densidade: cada fix de GPS e cada ajuste
  // manual do slider invalida refinos pendentes (o toque do usuário vence).
  const refineSeqRef = React.useRef(0)
  const effectiveAccuracyM = gpsAccuracyM ?? accuracyM ?? null
  // Derived from props — no need for setState in effect
  const hasLocation = lat != null && lng != null

  // Segue a sugestão do pai quando initialRadius muda (ex.: raio sugerido
  // pela precisão do GPS no onboarding). Arrastar o slider também flui para
  // o pai via onRadiusChange — valor igual = no-op, sem loop. Ajuste de
  // estado durante o render (padrão React para seguir props sem effect).
  const [lastInitialRadius, setLastInitialRadius] = React.useState(initialRadius)
  if (lastInitialRadius !== initialRadius) {
    setLastInitialRadius(initialRadius)
    setRadius(initialRadius)
  }

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
      // Precisão da fix (± m) → círculo pontilhado de incerteza no mapa.
      setGpsAccuracyM(pos.coords.accuracy ?? null)
      // Raio inicial ideal a partir da precisão da fix (±accuracy em m).
      const suggested = suggestRadiusFromAccuracy(pos.coords.accuracy)
      setRadius(suggested)
      setAccuracyHint(
        `Precisão do GPS: ±${Math.round(pos.coords.accuracy)} m — raio sugerido: ${suggested} km.`,
      )
      onLocationChange?.(newLat, newLng)
      onRadiusChange?.(suggested)

      // Refino assíncrono com as métricas de busca do marketplace (densidade
      // de prestadores por bairro/anel): área densa encolhe o raio, área
      // esparsa cresce. A sugestão por accuracy já está aplicada; o refino
      // só sobrescreve se a densidade realmente mudar o número e o usuário
      // não tiver mexido no slider nesse meio-tempro.
      const token = ++refineSeqRef.current
      const fixAccuracy = pos.coords.accuracy
      void refineSuggestedRadius({
        accuracyM: fixAccuracy,
        baseRadiusKm: suggested,
        lat: newLat,
        lng: newLng,
      }).then((refined) => {
        if (!refined || refineSeqRef.current !== token) return
        setRadius(refined.radiusKm)
        onRadiusChange?.(refined.radiusKm)
        const districtPart = refined.district ? ` · bairro mais denso: ${refined.district}` : ""
        setAccuracyHint(
          `Precisão do GPS: ±${Math.round(fixAccuracy)} m — raio sugerido: ${refined.radiusKm} km (${nearbyPhrase(refined.nearbyCount)}${districtPart}).`,
        )
      })
    } catch {
      // silently fail
    } finally {
      setLocating(false)
    }
  }, [onLocationChange, onRadiusChange])

  const handleRadiusChange = React.useCallback(
    (value: number[]) => {
      // Ajuste manual vence refinos pendentes por densidade.
      refineSeqRef.current++
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
          <RadiusMap lat={lat} lng={lng} radius={radius} accuracyM={effectiveAccuracyM} />
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

      {/* Dica de precisão do GPS + raio sugerido */}
      {accuracyHint && (
        <p aria-live="polite" className="text-xs text-emerald-700 dark:text-emerald-400">
          {accuracyHint}
        </p>
      )}

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
