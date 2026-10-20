import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderBookings } from "../provider-bookings"
import { cacheOfflineBookings, clearOfflineBookingsCache } from "@/lib/offline-bookings-cache"
import { apiGet } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}))

vi.mock("@/hooks/use-location-broadcaster", () => ({
  useLocationBroadcaster: vi.fn().mockReturnValue({ isBroadcasting: false }),
}))

describe("ProviderBookings Offline Resiliency", () => {
  let queryClient: QueryClient

  beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineBookingsCache()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(async () => {
    await clearOfflineBookingsCache()
    cleanup()
  })

  it("exibe agendamentos salvos no IndexedDB e banner de modo offline quando apiGet falha", async () => {
    // 1. Simula agendamento previamente armazenado no cache offline
    await cacheOfflineBookings([
      {
        id: "book-offline-valadares",
        scheduledAt: new Date().toISOString(),
        status: "PENDING",
        paymentStatus: "HELD",
        paymentMethod: "PIX",
        amount: 350,
        address: "Rua Peçanha, 450, Centro, GV",
        client: {
          id: "cli-1",
          name: "Mariana Souza (Offline)",
        },
        service: {
          id: "srv-1",
          title: "Instalação de Padrão Bifásico",
          basePrice: 350,
        },
      },
    ])

    // 2. Simula falha de conexão de rede no fetch remoto
    vi.mocked(apiGet).mockRejectedValueOnce(new Error("Failed to fetch (offline network error)"))

    render(
      <QueryClientProvider client={queryClient}>
        <ProviderBookings />
      </QueryClientProvider>,
    )

    // 3. Deve renderizar os dados do cache offline e o banner informativo
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument()
      expect(screen.getByText(/Modo Offline Ativo/i)).toBeInTheDocument()
      expect(screen.getAllByText("Mariana Souza (Offline)").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("Instalação de Padrão Bifásico").length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/Rua Peçanha/i).length).toBeGreaterThanOrEqual(1)
    })
  })
})
