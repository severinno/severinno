import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderAgenda } from "../provider-agenda"

const mockBookings = [
  {
    id: "b1",
    scheduledAt: new Date().toISOString(),
    status: "CONFIRMED",
    address: "Rua Israel Pinheiro, 1000 - Centro, GV",
    amount: 250,
    service: { id: "s1", title: "Instalação de Ar Condicionado" },
    client: {
      id: "c1",
      name: "Mariana Silva",
      avatarUrl: null,
    },
  },
]

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/api/bookings") {
        return { items: mockBookings, total: 1 }
      }
      return { items: [], total: 0 }
    }),
  }
})

describe("ProviderAgenda", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it("renderiza os dias da semana com 3 letras (DOM SEG TER QUA QUI SEX SÁB)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderAgenda />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("DOM")).toBeDefined()
    expect(screen.getByText("SEG")).toBeDefined()
    expect(screen.getByText("TER")).toBeDefined()
    expect(screen.getByText("QUA")).toBeDefined()
    expect(screen.getByText("QUI")).toBeDefined()
    expect(screen.getByText("SEX")).toBeDefined()
    expect(screen.getByText("SÁB")).toBeDefined()
  })

  it("renderiza métricas rápidas e atalhos de navegação", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderAgenda />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Agendamentos no Mês")).toBeDefined()
    expect(screen.getByText("Previsão Financeira")).toBeDefined()
    expect(screen.getAllByText("Hoje").length).toBeGreaterThanOrEqual(2)
  })

  it("exibe atalhos para Google Maps e Waze nos cards de agendamento", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderAgenda />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Mariana Silva")).toBeDefined()
    expect(screen.getByText("Maps")).toBeDefined()
    expect(screen.getByText("Waze")).toBeDefined()
  })
})
