"use client"

/**
 * TrackingMap — live map for the tracking page.
 *
 * Isolated from tracking-page-client.tsx so react-map-gl/maplibre (~267 KB
 * gzip) can be loaded via next/dynamic({ ssr: false }) only when the map is
 * actually rendered, instead of being part of the eager /tracking/[id] JS.
 * The maplibre-gl CSS travels with this chunk.
 */

import Map, {
  Marker,
  Source,
  Layer,
  NavigationControl,
} from "react-map-gl/maplibre"
import { MapPin, Navigation } from "lucide-react"
import "maplibre-gl/dist/maplibre-gl.css"

type TrackingMapProps = {
  lat: number
  lng: number
  providerLocation: [number, number] | null
  providerName: string
  routeCoords: [number, number][] | null
}

export function TrackingMap({
  lat,
  lng,
  providerLocation,
  providerName,
  routeCoords,
}: TrackingMapProps) {
  return (
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
            <MapPin className="size-4" />
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
              <Navigation className="size-4 rotate-45" />
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
  )
}
