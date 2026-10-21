import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AdminOperationsMap, GV_ALL_20_NEIGHBORHOODS } from "../admin-operations-map"

vi.mock("maplibre-gl", () => {
  class MockMap {
    addControl = vi.fn()
    flyTo = vi.fn()
    remove = vi.fn()
  }
  class MockMarker {
    setLngLat = vi.fn().mockReturnThis()
    setPopup = vi.fn().mockReturnThis()
    addTo = vi.fn().mockReturnThis()
    remove = vi.fn()
  }
  class MockPopup {
    setHTML = vi.fn().mockReturnThis()
  }
  return {
    default: {
      Map: MockMap,
      Marker: MockMarker,
      Popup: MockPopup,
      NavigationControl: vi.fn(),
    },
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    NavigationControl: vi.fn(),
  }
})

describe("AdminOperationsMap — Torre de Controle Operacional GV", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    // Mock global fetch para /api/admin/operations/live
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        city: "Governador Valadares",
        state: "MG",
        center: { lat: -18.8548, lng: -41.9482 },
        kpis: {
          activeBookings: 3,
          onlineProviders: 5,
          escrowHeldAmount: 540.0,
          escrowHeldCount: 3,
          escrowReleasedToday: 1200.0,
        },
        bookings: [
          {
            id: "b-1",
            clientId: "c-1",
            clientName: "Cliente 1",
            clientPhone: "33999",
            providerId: "p-1",
            providerName: "Prestador 1",
            providerPhone: "33888",
            serviceTitle: "Conserto Chuveiro",
            status: "IN_PROGRESS",
            paymentStatus: "HELD",
            amount: 150,
            lat: -18.8584,
            lng: -41.9515,
            address: "Rua Israel Pinheiro, Ilha",
            neighborhood: "Ilha dos Araújos",
            scheduledAt: new Date().toISOString(),
            escrowReleasedAt: null,
          },
        ],
        providers: [
          {
            id: "p-1",
            name: "Carlos Eletricista",
            phone: "33888",
            city: "Governador Valadares",
            state: "MG",
            lat: -18.8584,
            lng: -41.9515,
            active: true,
            verified: true,
          },
        ],
        neighborhoods: {
          Centro: { total: 0, inProgress: 0, heldAmount: 0 },
          "Ilha dos Araújos": { total: 1, inProgress: 1, heldAmount: 150 },
        },
      }),
    }) as any
  })

  it("exporta a lista completa com os 20 bairros de Governador Valadares", () => {
    expect(GV_ALL_20_NEIGHBORHOODS.length).toBe(20)
    const names = GV_ALL_20_NEIGHBORHOODS.map((n) => n.name)
    expect(names).toContain("Centro")
    expect(names).toContain("Ilha dos Araújos")
    expect(names).toContain("Vila Isa")
    expect(names).toContain("São Pedro")
    expect(names).toContain("Grã-Duquesa")
    expect(names).toContain("Santos Dumont")
  })

  it("renderiza o cabeçalho da Torre de Controle e os 20 botões de filtro de bairro", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AdminOperationsMap />
      </QueryClientProvider>,
    )

    expect(screen.getByText(/Torre de Controle Operacional — Governador Valadares/i)).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText("TODOS")).toBeDefined()
      expect(screen.getByText("Ilha dos Araújos")).toBeDefined()
      expect(screen.getByText("Vila Isa")).toBeDefined()
      expect(screen.getByText("São Pedro")).toBeDefined()
      expect(screen.getByText("Santos Dumont")).toBeDefined()
    })
  })

  it("permite filtrar por bairro e exibe contagem ativa", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AdminOperationsMap />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const ilhaBtn = screen.getByText("Ilha dos Araújos")
      expect(ilhaBtn).toBeDefined()
      fireEvent.click(ilhaBtn)
    })

    await waitFor(() => {
      expect(screen.getByText("Conserto Chuveiro")).toBeDefined()
      expect(screen.getByText("Prestador 1")).toBeDefined()
    })
  })
})
