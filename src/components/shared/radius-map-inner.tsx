"use client"

/**
 * RadiusMapInner — Inner map component for RadiusPreviewMap.
 *
 * Renders a MapLibre map with the provider marker and radius circle.
 * Dynamically imported to avoid SSR issues.
 *
 * O mapa é criado UMA vez e depois apenas atualizado (marcador + círculo +
 * `fitBounds`), centralizando e dando zoom automaticamente no círculo de
 * raio — inclusive quando o raio é sugerido pela precisão do GPS.
 */

import * as React from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import { radiusBounds } from "@/lib/geo-radius"
import { ensureMaplibreWorker } from "@/lib/maplibre-worker"
import {
  syncRadiusCircle,
  removeRadiusCircle,
  syncAccuracyCircle,
  removeAccuracyCircle,
  startAccuracyPulse,
  type MapLike,
  type PulseMapLike,
} from "@/lib/geo-circle"

type Props = {
  lat: number
  lng: number
  radius: number
  /** Precisão da fix do GPS em metros (±) — desenha o círculo pontilhado de incerteza. */
  accuracyM?: number | null
}

/** Centraliza o mapa no círculo de raio (zoom proporcional ao raio). */
function fitToRadius(map: maplibregl.Map, lat: number, lng: number, radiusKm: number): void {
  try {
    map.fitBounds(radiusBounds(lat, lng, radiusKm), {
      padding: 48,
      maxZoom: 14,
      duration: 0,
    })
  } catch {
    // mapa ainda não carregado — o fit roda no "load"
  }
}

/**
 * Formata a precisão da fix para leitura humana: "±12 m" / "±5 km" / "±1.2 km".
 * Retorna null para accuracy inválida (sem fix) — o item some da legenda.
 */
function formatAccuracy(accuracyM: number | null | undefined): string | null {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) return null
  const km = accuracyM / 1000
  if (Number.isInteger(km)) return `±${km} km`
  if (km > 1) return `±${km.toFixed(1)} km`
  return `±${Math.round(accuracyM)} m`
}

/** id da legenda — referenciado por aria-describedby no wrapper do mapa. */
const LEGEND_ID = "radius-map-legend"

export function RadiusMapInner({ lat, lng, radius, accuracyM }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<maplibregl.Map | null>(null)
  const markerRef = React.useRef<maplibregl.Marker | null>(null)
  // Mapa pronto (criado após o worker) — dispara o efeito do pulso também no
  // primeiro GPS fix (o effect de [accuracyM] roda antes da criação assíncrona).
  const [mapReady, setMapReady] = React.useState(false)

  // Última localização/raio/accuracy renderizados — usado pelo "load" para
  // sincronizar o estado corrente sem recriar o mapa (props mudam via ref).
  const latestRef = React.useRef({ lat, lng, radius, accuracyM })
  // Sincroniza após cada render — refs não são escritas no render (regra do
  // compilador de hooks); os callbacks assíncronos (criação/load) leem o
  // estado corrente daqui.
  React.useEffect(() => {
    latestRef.current = { lat, lng, radius, accuracyM }
  })

  // Criação única do mapa — updates ficam nos effects abaixo. O worker é
  // configurado por URL ANTES da criação (evita worker blob quebrado).
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

    function createMap(container: HTMLDivElement): maplibregl.Map {
      const map = new maplibregl.Map({
        container,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        center: [latestRef.current.lng, latestRef.current.lat],
        zoom: 9,
        attributionControl: false,
      })

      map.on("load", () => {
        // Provider marker
        const el = document.createElement("div")
        el.className =
          "flex size-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg border-2 border-white"
        el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

        const { lat, lng, radius, accuracyM } = latestRef.current
        markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)

        // Radius circle + círculo pontilhado da incerteza do GPS (quando há fix)
        syncRadiusCircle(map as unknown as MapLike, lat, lng, radius)
        syncAccuracyCircle(map as unknown as MapLike, lat, lng, accuracyM)
        fitToRadius(map, lat, lng, radius)
      })

      return map
    }

    void ensureMaplibreWorker().finally(() => {
      if (disposed || !containerRef.current) return
      const map = createMap(containerRef.current)
      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      disposed = true
      const map = mapRef.current
      if (map) {
        try {
          removeRadiusCircle(map as unknown as MapLike)
          removeAccuracyCircle(map as unknown as MapLike)
          map.remove()
        } catch {
          // mapa já destruído
        }
      }
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  // Marcador + círculos + centralização quando location/raio/accuracy mudam
  // (GPS, sugestão pela accuracy, slider).
  React.useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.setLngLat([lng, lat])
    try {
      removeRadiusCircle(map as unknown as MapLike)
      syncRadiusCircle(map as unknown as MapLike, lat, lng, radius)
      // accuracyM inválida (null/undefined/≤ 0) remove o círculo de incerteza
      syncAccuracyCircle(map as unknown as MapLike, lat, lng, accuracyM)
    } catch {
      // mapa pode não estar totalmente carregado
    }
    fitToRadius(map, lat, lng, radius)
  }, [lat, lng, radius, accuracyM])

  // Efeito radar — pulso suave no círculo de incerteza. Só quando há fix
  // válida, o mapa existe e o usuário não prefere movimento reduzido
  // (a11y: sem animação decorativa com prefers-reduced-motion).
  React.useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const hasAccuracy = accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 0
    if (!hasAccuracy) return
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    ) {
      return
    }
    return startAccuracyPulse(map as unknown as PulseMapLike)
  }, [mapReady, accuracyM])

  // Texto da precisão do GPS para a legenda (null = sem fix → item oculto).
  const accuracyText = formatAccuracy(accuracyM)

  return (
    <div
      role="group"
      aria-label="Mapa de visualização do raio de atendimento"
      aria-describedby={LEGEND_ID}
      className="relative size-full"
    >
      <div ref={containerRef} className="size-full" />

      {/* Legenda acessível — explica os círculos desenhados no mapa. Sobreposto
          com pointer-events-none para não bloquear arrastar/zoom do mapa. */}
      <div className="pointer-events-none absolute top-2 left-2 z-10 max-w-[85%]">
        <ul
          id={LEGEND_ID}
          className="bg-background/95 text-foreground flex flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug font-medium shadow-sm backdrop-blur-sm"
        >
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full border-2 border-dashed border-blue-600/70"
            />
            <span>
              <strong className="font-semibold text-blue-700 dark:text-blue-300">
                Círculo azul tracejado
              </strong>{" "}
              — raio de atendimento ({radius} km)
            </span>
          </li>
          {accuracyText && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border-2 border-dotted border-amber-600/80"
              />
              <span>
                <strong className="font-semibold text-amber-800 dark:text-amber-300">
                  Círculo âmbar pontilhado
                </strong>{" "}
                — precisão do GPS ({accuracyText})
              </span>
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
