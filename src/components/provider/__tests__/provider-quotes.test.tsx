import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderQuotes } from "../provider-quotes"

const mockQuotes = [
  {
    id: "qr1",
    clientId: "c1",
    providerId: "p1",
    status: "PENDING",
    address: "Rua Israel Pinheiro, 1500 - Centro, GV",
    cep: "35010-130",
    lat: -18.851,
    lng: -41.942,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client: {
      id: "c1",
      name: "Mariana Oliveira",
      avatarUrl: null,
    },
    items: [
      {
        id: "qi1",
        requestId: "qr1",
        providerId: "p1",
        serviceId: "s1",
        description: "Preciso trocar a fiação do chuveiro",
        quantity: 1,
        unit: "FIXED",
        photos: [],
        price: null,
        providerNote: null,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        service: {
          id: "s1",
          title: "Instalação Elétrica Chuveiro",
          basePrice: 120,
          unit: "FIXED",
        },
        provider: {
          id: "p1",
          name: "Carlos Eletricista",
          avatarUrl: null,
        },
      },
    ],
  },
]

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/api/quotes") {
        return { items: mockQuotes, total: 1 }
      }
      return { items: [], total: 0 }
    }),
    apiPatch: vi.fn(async () => ({ ok: true })),
  }
})

describe("ProviderQuotes", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it("renderiza o pipeline de orçamentos e itens pendentes", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderQuotes />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Orçamentos & Propostas")).toBeDefined()
    expect(screen.getAllByText("Aguardando Resposta").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Propostas Enviadas").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Aprovados / Fechados").length).toBeGreaterThanOrEqual(1)
  })

  it("calcula em tempo real o valor líquido ao digitar o preço da proposta", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderQuotes />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Mariana Oliveira")).toBeDefined()
    expect(screen.getByText("Compor Proposta Comercial")).toBeDefined()

    const priceInput = screen.getByPlaceholderText("0,00")
    fireEvent.change(priceInput, { target: { value: "200" } })

    // 200 - 12% (24) = 176 líquido
    expect(await screen.findByText("Líquido no Bolso")).toBeDefined()
    expect(screen.getByText("Taxa Severinno (12%)")).toBeDefined()
  })
})
