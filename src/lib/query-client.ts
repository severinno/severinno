import { QueryClient } from "@tanstack/react-query"

let queryClient: QueryClient | null = null

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return createQueryClient()
  }
  if (!queryClient) queryClient = createQueryClient()
  return queryClient
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}
