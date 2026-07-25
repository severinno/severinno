"use client"

import dynamic from "next/dynamic"
import { MapPin } from "lucide-react"

const MapWithNoSSR = dynamic(
  () => import("./tracking-map-inner"),
  { ssr: false, loading: () => <MapFallback /> }
)

type TrackingMapProps = {
  lat: number
  lng: number
  providerName: string
  providerLocation: [number, number] | null
  routeCoords: [number, number][] | null
  etaInfo: { distanceKm: number; durationMin: number } | null
  proximityAlerted: boolean
}

export function TrackingMap(props: TrackingMapProps) {
  return <MapWithNoSSR {...props} />
}

function MapFallback() {
  return (
    <div className="h-80 w-full flex items-center justify-center bg-muted/20 rounded-lg">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <MapPin className="size-8" />
        <span className="text-sm">Carregando mapa…</span>
      </div>
    </div>
  )
}
