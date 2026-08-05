"use client"

/**
 * useGeoSearch — SWR pattern hook for geocoding queries using TanStack Query.
 *
 * Wraps fetchGeoSearch with staleTime (5 min) and gcTime (30 min) so that
 * repeated searches for the same address are instant — no network request.
 *
 * The hook is disabled when the query is < 3 characters, preventing wasted
 * API calls during typing.
 *
 * Usage:
 *   const { data, isLoading } = useGeoSearch("Rua Augusta, São Paulo")
 */

import { useQuery } from "@tanstack/react-query"
import { fetchGeoSearch, type GeoSearchResult } from "@/lib/api"

export function useGeoSearch(
  q: string,
  limit = 5,
): {
  data: GeoSearchResult[]
  isLoading: boolean
  isFetching: boolean
  error: Error | null
} {
  const trimmed = q.trim()
  const enabled = trimmed.length >= 3

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["geo-search", trimmed.toLowerCase(), limit],
    queryFn: () => fetchGeoSearch(trimmed, limit),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min — SWR: serve cache while re-fetching in background
    gcTime: 30 * 60 * 1000, // 30 min — keep in garbage-collectible cache
    retry: 1,
  })

  return {
    data: data ?? [],
    isLoading: enabled && isLoading,
    isFetching: enabled && isFetching,
    error: error as Error | null,
  }
}
