import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderReviews } from "../provider-reviews"

const mockReviews = [
  {
    id: "r1",
    rating: 5,
    comment: "Excelente serviço! Muito pontual e caprichoso.",
    createdAt: new Date().toISOString(),
    booking: { id: "b1", serviceId: "s1" },
    service: { id: "s1", title: "Instalação Elétrica" },
    client: {
      id: "c1",
      name: "Mariana Silva",
      avatarUrl: null,
    },
  },
  {
    id: "r2",
    rating: 4,
    comment: "Muito bom, recomendo a todos.",
    createdAt: new Date().toISOString(),
    booking: { id: "b2", serviceId: "s2" },
    service: { id: "s2", title: "Reparo Hidráulico" },
    client: {
      id: "c2",
      name: "Carlos Andrade",
      avatarUrl: null,
    },
  },
]

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: "p1",
        name: "Carlos Eletricista",
        email: "carlos@test.com",
        role: "PROVIDER",
      },
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/api/reviews") {
        return { items: mockReviews, total: 2 }
      }
      return { items: [], total: 0 }
    }),
  }
})

describe("ProviderReviews", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it("renderiza o Score de Reputação e as tags de destaque", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderReviews />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Reputação & Avaliações")).toBeDefined()
    expect(screen.getByText("Score de Reputação")).toBeDefined()
    expect(screen.getByText("Pontualidade Britânica")).toBeDefined()
    expect(screen.getByText("100% Recomendado")).toBeDefined()
  })

  it("permite abrir modal de agradecimento ao cliente", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProviderReviews />
      </QueryClientProvider>,
    )

    const thankButtons = await screen.findAllByText("Agradecer cliente")
    expect(thankButtons.length).toBeGreaterThanOrEqual(1)

    fireEvent.click(thankButtons[0])

    expect(await screen.findByText("Agradecer Mariana Silva")).toBeDefined()
    expect(screen.getByText("Enviar Resposta")).toBeDefined()
  })
})
