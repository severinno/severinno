/**
 * Tests for ClientProfile — Client profile view and editable form.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockApiPatch, mockToastSuccess, mockToastInfo } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockApiPatch: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastInfo: vi.fn(),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector?: (s: { navigate: ReturnType<typeof vi.fn> }) => unknown) => {
    const state = { navigate: mockNavigate }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: "user-123", name: "João Cliente", role: "CLIENT" },
      status: "authenticated",
      setUser: vi.fn(),
    }
    return selector ? selector(state) : state
  }),
}))

const mockUser = {
  id: "user-123",
  email: "cliente@severinno.com",
  name: "João Cliente",
  role: "CLIENT",
  cpfCnpj: "123.456.789-09",
  whatsapp: "(11) 98888-1111",
  phone: "(11) 3888-1111",
  avatarUrl: "https://example.com/avatar.jpg",
  bio: "Morador de São Paulo em busca de serviços para minha residência.",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "Apto 101",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  lat: -23.5615,
  lng: -46.6559,
  verified: true,
  soundEnabled: true,
  vibrateEnabled: true,
  createdAt: "2026-01-15T10:00:00.000Z",
}

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url === "/api/users/me") {
      return Promise.resolve({ user: mockUser })
    }
    return Promise.resolve({})
  }),
  apiPatch: mockApiPatch,
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  playCompletionSound: vi.fn(),
  playReviewSound: vi.fn(),
  tryVibrate: vi.fn(),
}))

vi.mock("@/hooks/use-service-worker", () => ({
  usePushSubscription: () => ({
    isSubscribed: true,
    isSupported: true,
    permission: "granted",
    loading: false,
    testing: false,
    subscribe: vi.fn().mockResolvedValue(true),
    unsubscribe: vi.fn().mockResolvedValue(true),
    sendTestNotification: vi.fn().mockResolvedValue({ ok: true }),
  }),
  useServiceWorker: () => ({
    isRegistered: false,
    updateAvailable: false,
    error: null,
    applyUpdate: vi.fn(),
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
    info: mockToastInfo,
  },
}))

import { ClientProfile } from "../client-profile"

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("ClientProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPatch.mockResolvedValue({
      user: { ...mockUser, name: "João Cliente Atualizado" },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("renders Hero banner, badge, and navigation actions", async () => {
    renderWithClient(<ClientProfile />)

    expect(await screen.findByText("Perfil & Identidade Cadastral")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Meu Perfil", level: 1 })).toBeInTheDocument()

    const dashboardBtn = screen.getByRole("button", { name: /visão geral/i })
    expect(dashboardBtn).toBeInTheDocument()
    fireEvent.click(dashboardBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.dashboard")

    const securityBtn = screen.getByRole("button", { name: /segurança & senha/i })
    expect(securityBtn).toBeInTheDocument()
    fireEvent.click(securityBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.security")
  })

  it("renders Account Health & Location StatCards", async () => {
    renderWithClient(<ClientProfile />)

    expect(await screen.findByText("Verificada")).toBeInTheDocument()
    expect(screen.getByText("Status da Conta")).toBeInTheDocument()
    expect(screen.getByText("Localização Ativa")).toBeInTheDocument()
    expect((await screen.findAllByText("Completude do Perfil")).length).toBeGreaterThanOrEqual(1)
  })

  it("renders Visual Identity card with member date and completeness checklist", async () => {
    renderWithClient(<ClientProfile />)

    expect((await screen.findAllByText("cliente@severinno.com")).length).toBe(2)
    expect(screen.getByText(/membro desde/i)).toBeInTheDocument()
    expect(screen.getByText("Foto de perfil")).toBeInTheDocument()
    expect(screen.getByText("WhatsApp de contato")).toBeInTheDocument()
    expect(screen.getByText("Endereço cadastrado")).toBeInTheDocument()
  })

  it("renders Official Registered Data card with anti-fraud shield advisory", async () => {
    renderWithClient(<ClientProfile />)

    expect(await screen.findByText("Dados Cadastrais Oficiais")).toBeInTheDocument()
    expect(screen.getByText("E-mail principal")).toBeInTheDocument()
    expect(screen.getByText("123.456.789-09")).toBeInTheDocument()
    expect(screen.getByText(/prevenção de fraudes e compliance fiscal/i)).toBeInTheDocument()
  })

  it("navigates to security settings via quick action card", async () => {
    renderWithClient(<ClientProfile />)

    const manageSecurityBtn = await screen.findByRole("button", { name: /gerenciar segurança/i })
    expect(manageSecurityBtn).toBeInTheDocument()
    fireEvent.click(manageSecurityBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.security")
  })

  it("populates editable fields with user data", async () => {
    renderWithClient(<ClientProfile />)

    const nameInput = (await screen.findByLabelText(/nome completo/i)) as HTMLInputElement
    expect(nameInput.value).toBe("João Cliente")

    const whatsappInput = screen.getByLabelText(/whatsapp/i) as HTMLInputElement
    expect(whatsappInput.value).toBe("(11) 98888-1111")

    const bioInput = screen.getByLabelText(/apresentação pessoal/i) as HTMLTextAreaElement
    expect(bioInput.value).toBe("Morador de São Paulo em busca de serviços para minha residência.")
  })

  it("tracks dirty state and allows discarding changes", async () => {
    renderWithClient(<ClientProfile />)

    const nameInput = (await screen.findByLabelText(/nome completo/i)) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Nome Temporário" } })

    expect(await screen.findByText("Alterações não salvas")).toBeInTheDocument()

    const discardBtn = screen.getByRole("button", { name: /descartar/i })
    expect(discardBtn).not.toBeDisabled()
    fireEvent.click(discardBtn)

    expect(mockToastInfo).toHaveBeenCalledWith("Alterações descartadas.")
    expect(nameInput.value).toBe("João Cliente")
  })

  it("submits profile update mutation when clicking save", async () => {
    renderWithClient(<ClientProfile />)

    const nameInput = (await screen.findByLabelText(/nome completo/i)) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "João Silva Cliente" } })

    const saveBtn = screen.getByRole("button", { name: /salvar alterações/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith(
        "/api/users/me",
        expect.objectContaining({
          name: "João Silva Cliente",
        }),
      )
    })

    expect(mockToastSuccess).toHaveBeenCalledWith("Perfil atualizado com sucesso!")
  })

  it("allows toggling between list view and grid view", async () => {
    renderWithClient(<ClientProfile />)

    const gridBtn = await screen.findByRole("button", { name: "Visualização em Grade" })
    const listBtn = screen.getByRole("button", { name: "Visualização em Lista" })

    expect(listBtn).toHaveAttribute("aria-pressed", "true")
    expect(gridBtn).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(gridBtn)
    expect(gridBtn).toHaveAttribute("aria-pressed", "true")
    expect(listBtn).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(listBtn)
    expect(listBtn).toHaveAttribute("aria-pressed", "true")
    expect(gridBtn).toHaveAttribute("aria-pressed", "false")
  })

  it("filters profile sections via search input and clears via X button", async () => {
    renderWithClient(<ClientProfile />)

    expect(await screen.findByText("Dados Pessoais & Contato")).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(
      /filtrar dados cadastrais, endereço ou preferências/i,
    )

    // Filter to something only in Address
    fireEvent.change(searchInput, { target: { value: "residencial" } })
    expect(screen.getByText(/endereço & localização residencial/i)).toBeInTheDocument()
    expect(screen.queryByText("Dados Pessoais & Contato")).not.toBeInTheDocument()

    // Clear via X button
    const clearBtn = screen.getByRole("button", { name: /limpar busca/i })
    fireEvent.click(clearBtn)
    expect(searchInput).toHaveValue("")
    expect(screen.getByText("Dados Pessoais & Contato")).toBeInTheDocument()
  })

  it("shows empty state when search term has no matches and allows resetting", async () => {
    renderWithClient(<ClientProfile />)

    expect(await screen.findByText("Dados Pessoais & Contato")).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(
      /filtrar dados cadastrais, endereço ou preferências/i,
    )
    fireEvent.change(searchInput, { target: { value: "inexistente999xyz" } })

    expect(screen.getByText("Nenhuma seção encontrada")).toBeInTheDocument()
    expect(screen.queryByText("Dados Pessoais & Contato")).not.toBeInTheDocument()

    const resetBtn = screen.getByRole("button", { name: /limpar filtro/i })
    fireEvent.click(resetBtn)

    expect(screen.getByText("Dados Pessoais & Contato")).toBeInTheDocument()
  })

  it("passes accessibility checks with 0 axe violations", async () => {
    const { container } = renderWithClient(<ClientProfile />)

    await screen.findByDisplayValue("João Cliente")

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
