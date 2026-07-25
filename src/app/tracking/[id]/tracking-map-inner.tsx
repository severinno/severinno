"use client"

import Map, { Marker, Source, Layer, NavigationControl } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { Navigation } from "lucide-react"

type TrackingMapInnerProps = {
  lat: number
  lng: number
  providerName: string
  providerLocation: [number, number] | null
  routeCoords: [number, number][] | null
  etaInfo: { distanceKm: number; durationMin: number } | null
  proximityAlerted: boolean
}

export default function TrackingMapInner({
  lat,
  lng,
  providerName,
  providerLocation,
  routeCoords,
  etaInfo,
  proximityAlerted,
}: TrackingMapInnerProps) {
  return (
    <div className="h-80 w-full relative bg-muted/20">
      {proximityAlerted && (
        <div className="absolute top-3 left-3 right-12 z-20 bg-emerald-600 text-white rounded-lg px-3 py-2 text-xs font-semibold shadow-lg flex items-center gap-2 animate-bounce">
          <Navigation className="size-4" />
          <span>O prestador está muito próximo!</span>
        </div>
      )}
      {etaInfo && !proximityAlerted && (etaInfo.distanceKm < 0.5 || etaInfo.durationMin < 3) && (
        <div className="absolute top-3 left-3 right-12 z-20 bg-emerald-600 text-white rounded-lg px-3 py-2 text-xs font-semibold shadow-lg flex items-center gap-2 animate-bounce">
          <Navigation className="size-4" />
          <span>O prestador está muito próximo!</span>
        </div>
      )}
      <Map
        initialViewState={{
          latitude: lat,
          longitude: lng,
          zoom: 13,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" visualizePitch={false} />

        {/* Client Destination Marker */}
        <Marker latitude={lat} longitude={lng}>
          <div className="flex flex-col items-center">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg border-2 border-background">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <span className="text-[10px] font-semibold bg-background px-1.5 py-0.5 rounded shadow mt-0.5 max-w-[80px] truncate">
              Você
            </span>
          </div>
        </Marker>

        {/* Provider Live Location Marker */}
        {providerLocation && (
          <Marker latitude={providerLocation[1]} longitude={providerLocation[0]}>
            <div className="flex flex-col items-center">
              <div className="flex size-8 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg border-2 border-background animate-pulse">
                <Navigation className="size-4" />
              </div>
              <span className="text-[10px] font-semibold bg-background px-1.5 py-0.5 rounded shadow mt-0.5 max-w-[80px] truncate">
                {providerName}
              </span>
            </div>
          </Marker>
        )}

        {/* OSRM Route Line */}
        {routeCoords && (
          <Source
            id="tracking-route"
            type="geojson"
            data={{
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: routeCoords,
              },
            }}
          >
            <Layer
              id="tracking-route-layer"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": "#059669",
                "line-width": 4,
              }}
            />
          </Source>
        )}
      </Map>
    </div>
  )
}
