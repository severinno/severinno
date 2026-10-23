import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderBookings } from "../provider-bookings"

const mockBookings = [
  {
    id: "b1",
    clientId: "c1",
    providerId: "p1",
    serviceId: "s1",
    scheduledAt: new Date().toISOString(),
    status: "PENDING",
    address: "Rua Israel Pinheiro, 2000 - Centro, GV",
    cep: "35010-130",
    lat: -18.851,
    lng: -41.942,
    amount: 150,
    quantity: 1,
    unit: "FIXED",
    paymentMethod: "PIX",
    paymentStatus: "PENDING",
    notes: "Tocar interfone 202",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    service: {
      id: "s1",
      title: "Reparo Hidráulico",
      basePrice: 150,
      unit: "FIXED",
    },
    client: {
      id: "c1",
      name: "João da Silva",
      avatarUrl: null,
    },
    payment: {
      id: "pay1",
      amount: 150,
      method: "PIX",
      status: "PENDING",
    },
  },
  {
    id: "b2",
    clientId: "c2",
    providerId: "p1",
    serviceId: "s2",
    scheduledAt: new Date().toISOString(),
    status: "CONFIRMED",
    address: "Av. Brasil, 500 - Ilha dos Araújos, GV",
    cep: "35020-000",
    lat: -18.86,
    lng: -41.95,
    amount: 280,
    quantity: 1,
    unit: "FIXED",
    paymentMethod: "CREDIT_CARD",
    paymentStatus: "PAID",
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    service: {
      id: "s2",
      title: "Instalação Elétrica Completa",
      basePrice: 280,
      unit: "FIXED",
    },
    client: {
      id: "c2",
      name: "Fernanda Costa",
      avatarUrl: null,
    },
    payment: {
      id: "pay2",
      amount: 280,
      method: "CREDIT_CARD",
      status: "PAID",
    },
  },
]

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/api/bookings") {
        return { items: mockBookings, total: 2 }
      }
      return { items: [], total: 0 }
    }),
    apiPatch: vi.fn(async () => ({ ok: true })),
  }
})

describe("ProviderBookings", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it("renderiza a esteira de pipeline de status e tabs", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderBookings />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Gestão de Agendamentos")).toBeDefined()
    expect(screen.getAllByText("Pendentes").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Confirmados").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Em Andamento").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Concluídos").length).toBeGreaterThanOrEqual(1)
  })

  it("permite filtrar por busca textual", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderBookings />
      </QueryClientProvider>,
    )

    // Initially on PENDING tab, showing João da Silva in table and/or mobile card
    const joaoElements = await screen.findAllByText("João da Silva")
    expect(joaoElements.length).toBeGreaterThanOrEqual(1)

    const searchInput = screen.getByPlaceholderText("Buscar por cliente, serviço...")
    fireEvent.change(searchInput, { target: { value: "Inexistente" } })

    expect(await screen.findByText("Nenhum agendamento encontrado")).toBeDefined()
  })
})
