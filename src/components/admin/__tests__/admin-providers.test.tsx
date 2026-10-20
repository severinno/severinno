import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { axe } from "vitest-axe"
import { AdminProviders } from "../admin-providers"

const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPatch = vi.hoisted(() => vi.fn())
const mockOpenProvider = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api", () => ({
  apiGet: mockApiGet,
  apiPatch: mockApiPatch,
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/store/ui", () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      openProvider: mockOpenProvider,
      closeProvider: vi.fn(),
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: Object.assign(
    vi.fn((selector) => {
      const state = {
        view: "admin.providers",
        navigate: mockNavigate,
      }
      return selector ? selector(state) : state
    }),
    {
      getState: () => ({
        view: "admin.providers",
        navigate: mockNavigate,
      }),
    },
  ),
}))

describe("AdminProviders Component", () => {
  const mockProvidersData = {
    items: [
      {
        id: "prov-1",
        name: "Carlos Eletricista",
        email: "carlos@eletrica.com",
        role: "PROVIDER",
        phone: "(11) 98765-4321",
        whatsapp: "(11) 98765-4321",
        cpfCnpj: "123.456.789-00",
        avatarUrl: "https://example.com/avatar.jpg",
        city: "São Paulo",
        state: "SP",
        bio: "Especialista em instalações elétricas residenciais",
        verified: true,
        active: true,
        createdAt: "2026-01-15T10:00:00.000Z",
        distanceKm: 4.5,
      },
      {
        id: "prov-2",
        name: "Mariana Encanadora",
        email: "mariana@hidraulica.com",
        role: "PROVIDER",
        phone: "(11) 91234-5678",
        whatsapp: "(11) 91234-5678",
        cpfCnpj: "987.654.321-11",
        avatarUrl: null,
        city: "Campinas",
        state: "SP",
        bio: "Desentupimentos e reparos rápidos",
        verified: false,
        active: true,
        createdAt: "2026-02-10T14:30:00.000Z",
        distanceKm: 12.0,
      },
    ],
    total: 2,
    page: 1,
    limit: 12,
  }

  const mockBadgesData = {
    activeBookings: 8,
    pendingKyc: 1,
    openDisputes: 0,
    services: 45,
    taxonomy: 30,
    verifiedProviders: 1,
  }

  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/api/admin/badges") {
        return Promise.resolve(mockBadgesData)
      }
      return Promise.resolve(mockProvidersData)
    })
    mockApiPatch.mockResolvedValue({ user: mockProvidersData.items[0] })
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AdminProviders />
      </QueryClientProvider>,
    )

  it("renderiza cabeçalho, Bento StatCards e lista de prestadores", async () => {
    renderComponent()

    expect(await screen.findByText("Prestadores")).toBeDefined()
    expect(
      screen.getByText("Gerencie prestadores de serviços, verificação e status."),
    ).toBeDefined()

    // Bento StatCards
    expect(screen.getByText("Total de Prestadores")).toBeDefined()
    expect(screen.getByText("Verificados (KYC)")).toBeDefined()
    expect(screen.getByText("Aguardando Verificação")).toBeDefined()
    expect(screen.getByText("Prestadores Ativos")).toBeDefined()

    // Prestadores na tabela
    expect(await screen.findByText("Carlos Eletricista")).toBeDefined()
    expect(screen.getByText("carlos@eletrica.com")).toBeDefined()
    expect(screen.getByText("Mariana Encanadora")).toBeDefined()
    expect(screen.getByText("mariana@hidraulica.com")).toBeDefined()
  })

  it("renderiza as pílulas de triagem rápida e filtra ao clicar", async () => {
    renderComponent()

    const pillAll = await screen.findByRole("button", { name: /todos os prestadores/i })
    const pillVerified = screen.getByRole("button", { name: /verificados kyc/i })
    const pillPending = screen.getByRole("button", { name: /aguardando kyc/i })
    const pillActive = screen.getByRole("button", { name: /ativos na vitrine/i })

    expect(pillAll).toBeDefined()
    expect(pillVerified).toBeDefined()
    expect(pillPending).toBeDefined()
    expect(pillActive).toBeDefined()

    // Clicar em "Verificados KYC" filtra a lista
    fireEvent.click(pillVerified)
    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeDefined()
      expect(screen.queryByText("Mariana Encanadora")).toBeNull()
    })

    // Clicar em "Aguardando KYC" exibe apenas não verificados
    fireEvent.click(pillPending)
    await waitFor(() => {
      expect(screen.getByText("Mariana Encanadora")).toBeDefined()
      expect(screen.queryByText("Carlos Eletricista")).toBeNull()
    })
  })

  it("chama openProvider ao clicar no avatar/nome ou no botão 'Ver perfil'", async () => {
    renderComponent()

    const carlosRowBtn = await screen.findByRole("button", {
      name: /ver perfil de carlos eletricista/i,
    })
    fireEvent.click(carlosRowBtn)

    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")

    // Botão explícito "Ver perfil"
    const viewButtons = screen.getAllByRole("button", { name: /ver perfil/i })
    fireEvent.click(viewButtons[1]) // Carlos button
    expect(mockOpenProvider).toHaveBeenCalledWith("prov-1")
  })

  it("exibe empty state quando não há prestadores retornados", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/api/admin/badges") return Promise.resolve(mockBadgesData)
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 12 })
    })

    renderComponent()

    expect(await screen.findByText("Nenhum prestador encontrado")).toBeDefined()
    expect(screen.getByText("Ajuste os filtros de busca ou aguarde novos cadastros.")).toBeDefined()
  })

  it("passa no teste de acessibilidade axe sem violações", async () => {
    const { container } = renderComponent()

    await screen.findByText("Carlos Eletricista")
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
