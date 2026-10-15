"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useGeoStore } from "@/store/geo"
import { resolveRegionalContext } from "@/lib/regional-intelligence/engine"
import type { RegionalContext, WeatherCondition } from "@/lib/regional-intelligence/types"
import { apiGet } from "@/lib/api"

export type UseRegionalContextOptions = {
  forcedWeather?: WeatherCondition
}

export function useRegionalContext(options: UseRegionalContextOptions = {}): {
  context: RegionalContext
  isLoading: boolean
  isWeatherAdapted: boolean
} {
  const geoLat = useGeoStore((s) => s.lat)
  const geoLng = useGeoStore((s) => s.lng)
  const geoCity = useGeoStore((s) => s.city)
  const geoState = useGeoStore((s) => s.state)

  // Immediate synchronous fallback computed in-memory to prevent layout shift
  const initialFallback = React.useMemo(() => {
    return resolveRegionalContext({
      lat: geoLat,
      lng: geoLng,
      city: geoCity,
      state: geoState,
      forcedWeather: options.forcedWeather,
    })
  }, [geoLat, geoLng, geoCity, geoState, options.forcedWeather])

  const cityParam = geoCity || "Governador Valadares"
  const stateParam = geoState || "MG"
  const queryParams = new URLSearchParams({
    city: cityParam,
    state: stateParam,
  })
  if (geoLat != null) queryParams.set("lat", geoLat.toString())
  if (geoLng != null) queryParams.set("lng", geoLng.toString())
  if (options.forcedWeather) queryParams.set("weather", options.forcedWeather)

  const queryResult = useQuery<RegionalContext>({
    queryKey: [
      "vitrine-regional-context",
      cityParam,
      stateParam,
      geoLat,
      geoLng,
      options.forcedWeather,
    ],
    queryFn: () => apiGet<RegionalContext>(`/api/vitrine/context?${queryParams.toString()}`),
    initialData: initialFallback,
    staleTime: 60 * 1000,
  })

  const context = queryResult?.data || initialFallback
  const isWeatherAdapted = (context?.weather ?? "temperate") !== "temperate"

  return {
    context,
    isLoading: queryResult?.isLoading ?? false,
    isWeatherAdapted,
  }
}
