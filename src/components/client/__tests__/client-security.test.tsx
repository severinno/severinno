/**
 * Tests for ClientSecurity — account security, 2FA and LGPD privacy management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---- Hoisted shared mocks --------------------------------------------------
const { mockNavigate, mockLogout, mockReset, mockApiPost, mockToastSuccess } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLogout: vi.fn(),
  mockReset: vi.fn(),
  mockApiPost: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn(
    (
      selector?: (s: {
        navigate: ReturnType<typeof vi.fn>
        reset: ReturnType<typeof vi.fn>
      }) => unknown,
    ) => {
      const state = { navigate: mockNavigate, reset: mockReset }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: "client-1", name: "João Cliente", role: "CLIENT" },
      status: "authenticated",
      logout: mockLogout,
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url === "/api/auth/2fa/status") {
      return Promise.resolve({ twoFactorEnabled: false })
    }
    return Promise.resolve({})
  }),
  apiPost: mockApiPost,
}))

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { ClientSecurity } from "../client-security"

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

// ---- Test suite ------------------------------------------------------------

describe("ClientSecurity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPost.mockResolvedValue({ ok: true, message: "Senha alterada com sucesso!" })
  })

  afterEach(() => {
    cleanup()
  })

  it("renders Hero banner, badge, and navigation actions", async () => {
    renderWithClient(<ClientSecurity />)

    expect(screen.getByText("Central de Segurança & LGPD")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Segurança & Privacidade" })).toBeInTheDocument()

    const dashboardBtn = screen.getByRole("button", { name: /Visão geral/i })
    fireEvent.click(dashboardBtn)
    expect(mockNavigate).toHaveBeenCalledWith("client.dashboard")
  })

  it("renders Security Health StatCards", async () => {
    renderWithClient(<ClientSecurity />)

    expect(screen.getByText("Status da Senha")).toBeInTheDocument()
    expect(screen.getByText("Protegida")).toBeInTheDocument()
    expect(screen.getByText("Autenticação 2FA")).toBeInTheDocument()
    expect(screen.getByText("Recomendada")).toBeInTheDocument()
    expect(screen.getByText("Privacidade LGPD")).toBeInTheDocument()
    expect(screen.getByText("Art. 18 Ativo")).toBeInTheDocument()
  })

  it("calculates password strength dynamically as user types", async () => {
    renderWithClient(<ClientSecurity />)

    const newPasswordInput = screen.getByPlaceholderText("Digite sua nova senha")
    fireEvent.change(newPasswordInput, { target: { value: "simple" } })

    // Strength meter appears (score 0: Muito Fraca)
    expect(screen.getByText(/Força da senha:/i)).toBeInTheDocument()
    expect(screen.getByText("Muito Fraca")).toBeInTheDocument()

    // 8+ characters (score 1: Fraca)
    fireEvent.change(newPasswordInput, { target: { value: "simplepass" } })
    expect(screen.getByText("Fraca")).toBeInTheDocument()

    // Add uppercase, number and special char (score 4: Muito Forte)
    fireEvent.change(newPasswordInput, { target: { value: "StrongPass123!" } })
    expect(screen.getByText("Muito Forte")).toBeInTheDocument()
  })

  it("toggles password visibility on eye button click", async () => {
    renderWithClient(<ClientSecurity />)

    const newPasswordInput = screen.getByPlaceholderText("Digite sua nova senha")
    expect(newPasswordInput).toHaveAttribute("type", "password")

    const toggleBtn = screen.getByRole("button", { name: "Mostrar nova senha" })
    fireEvent.click(toggleBtn)

    expect(newPasswordInput).toHaveAttribute("type", "text")
  })

  it("submits password change mutation when valid", async () => {
    renderWithClient(<ClientSecurity />)

    const currentPwdInput = screen.getByPlaceholderText("Digite sua senha atual")
    const newPwdInput = screen.getByPlaceholderText("Digite sua nova senha")
    const confirmPwdInput = screen.getByPlaceholderText("Repita a nova senha")

    fireEvent.change(currentPwdInput, { target: { value: "OldPassword123!" } })
    fireEvent.change(newPwdInput, { target: { value: "NewPassword123!" } })
    fireEvent.change(confirmPwdInput, { target: { value: "NewPassword123!" } })

    const submitBtn = screen.getByRole("button", { name: /Salvar Nova Senha/i })
    expect(submitBtn).not.toBeDisabled()

    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/api/auth/change-password", {
        currentPassword: "OldPassword123!",
        newPassword: "NewPassword123!",
      })
    })

    expect(mockToastSuccess).toHaveBeenCalledWith("Senha alterada com sucesso!")
  })

  it("allows toggling LGPD consent preferences", async () => {
    renderWithClient(<ClientSecurity />)

    const switches = screen.getAllByRole("switch")
    expect(switches.length).toBeGreaterThanOrEqual(2)

    fireEvent.click(switches[0])
    expect(mockToastSuccess).toHaveBeenCalledWith("Preferência de notificações atualizada.")
  })

  it("triggers data export download", async () => {
    // Mock fetch and createObjectURL
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["{}"], { type: "application/json" })),
    } as Response)

    window.URL.createObjectURL = vi.fn(() => "blob:http://localhost/test")
    window.URL.revokeObjectURL = vi.fn()

    renderWithClient(<ClientSecurity />)

    const exportBtn = screen.getByRole("button", { name: /Exportar meus dados \(JSON\)/i })
    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/users/me/data-export")
    })
  })

  it("handles account deletion confirmation dialog", async () => {
    renderWithClient(<ClientSecurity />)

    const deleteBtn = screen.getByRole("button", { name: /Excluir conta/i })
    fireEvent.click(deleteBtn)

    expect(screen.getByText(/Atenção: Esta ação é definitiva e irreversível/i)).toBeInTheDocument()

    const confirmBtn = screen.getByRole("button", { name: /Confirmar Exclusão Definitiva/i })
    expect(confirmBtn).toBeDisabled()

    const confirmInput = screen.getByPlaceholderText("EXCLUIR MINHA CONTA")
    fireEvent.change(confirmInput, { target: { value: "EXCLUIR MINHA CONTA" } })

    expect(confirmBtn).not.toBeDisabled()
  })

  it("passes accessibility checks with 0 axe violations", async () => {
    const { container } = renderWithClient(<ClientSecurity />)

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Segurança & Privacidade" })).toBeInTheDocument()
    })

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
