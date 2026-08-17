import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const mockApiGet = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api", () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}))

import { useAuthStore } from "../auth"

const SAMPLE_USER = {
  id: "user-1",
  name: "Maria",
  email: "maria@test.com",
  role: "CLIENT" as const,
  avatarUrl: null,
}

const EXPIRY = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    user: null,
    status: "idle",
    error: null,
    initialized: false,
    sessionExpiresAt: null,
  })
})

describe("renewSession — contrato NÃO-destrutivo (renovação proativa)", () => {
  it("atualiza user/sessionExpiresAt no sucesso (GET /api/auth/me reemite <15d)", async () => {
    mockApiGet.mockResolvedValue({ user: SAMPLE_USER, expiresAt: EXPIRY })
    useAuthStore.setState({
      user: SAMPLE_USER,
      status: "authenticated",
      initialized: true,
      sessionExpiresAt: EXPIRY - 30 * 24 * 60 * 60, // expiry antigo (quase vencido)
    })

    await useAuthStore.getState().renewSession()

    const s = useAuthStore.getState()
    expect(mockApiGet).toHaveBeenCalledWith("/api/auth/me")
    expect(s.sessionExpiresAt).toBe(EXPIRY)
    expect(s.user).toEqual(SAMPLE_USER)
    expect(s.status).toBe("authenticated")
    expect(s.initialized).toBe(true)
  })

  it("em erro de rede MANTÉM user/status/sessionExpiresAt (nunca marca unauthenticated)", async () => {
    mockApiGet.mockRejectedValue(new Error("network down"))
    useAuthStore.setState({
      user: SAMPLE_USER,
      status: "authenticated",
      initialized: true,
      sessionExpiresAt: EXPIRY,
    })

    await useAuthStore.getState().renewSession()

    const s = useAuthStore.getState()
    // A renovaçao que falha NÃO pode expulsar o usuário (diferente do fetchMe).
    expect(s.user).toEqual(SAMPLE_USER)
    expect(s.status).toBe("authenticated")
    expect(s.sessionExpiresAt).toBe(EXPIRY)
  })

  it("em erro 5xx MANTÉM o estado (não derruba para login)", async () => {
    mockApiGet.mockRejectedValue({ status: 500, message: "Erro interno" })
    useAuthStore.setState({
      user: SAMPLE_USER,
      status: "authenticated",
      initialized: true,
      sessionExpiresAt: EXPIRY,
    })

    await useAuthStore.getState().renewSession()

    const s = useAuthStore.getState()
    expect(s.status).toBe("authenticated")
    expect(s.user).toEqual(SAMPLE_USER)
    expect(s.sessionExpiresAt).toBe(EXPIRY)
  })

  it("com user: null na resposta mantém o estado atual (próximo fetchMe/guarda resolve)", async () => {
    mockApiGet.mockResolvedValue({ user: null, expiresAt: null })
    useAuthStore.setState({
      user: SAMPLE_USER,
      status: "authenticated",
      initialized: true,
      sessionExpiresAt: EXPIRY,
    })

    await useAuthStore.getState().renewSession()

    const s = useAuthStore.getState()
    expect(s.user).toEqual(SAMPLE_USER)
    expect(s.status).toBe("authenticated")
  })
})

describe("fetchMe — contrato destrutivo (referência: derruba em erro)", () => {
  it("em erro de rede marca unauthenticated (é o comportamento que o renewSession evita)", async () => {
    mockApiGet.mockRejectedValue(new Error("network down"))
    useAuthStore.setState({
      user: SAMPLE_USER,
      status: "authenticated",
      initialized: true,
      sessionExpiresAt: EXPIRY,
    })

    await useAuthStore.getState().fetchMe()

    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.status).toBe("unauthenticated")
    expect(s.sessionExpiresAt).toBeNull()
  })
})

describe("seedSessionExpiry — semeadura SSR do countdown (paint inicial)", () => {
  it("preenche sessionExpiresAt quando ainda está null (SSR antes do fetchMe)", () => {
    useAuthStore.setState({ sessionExpiresAt: null })
    useAuthStore.getState().seedSessionExpiry(EXPIRY)
    expect(useAuthStore.getState().sessionExpiresAt).toBe(EXPIRY)
  })

  it("NÃO sobrescreve um valor já resolvido (o mais fresco vence)", () => {
    useAuthStore.setState({ sessionExpiresAt: EXPIRY })
    // Um SSR mais lento chegando depois do fetchMe não pode regredir o valor.
    useAuthStore.getState().seedSessionExpiry(EXPIRY - 30 * 24 * 60 * 60)
    expect(useAuthStore.getState().sessionExpiresAt).toBe(EXPIRY)
  })

  it("NÃO altera user/status/initialized (é só o paint inicial do countdown)", () => {
    useAuthStore.setState({
      user: SAMPLE_USER,
      status: "authenticated",
      initialized: true,
      sessionExpiresAt: null,
    })
    useAuthStore.getState().seedSessionExpiry(EXPIRY)
    const s = useAuthStore.getState()
    expect(s.user).toEqual(SAMPLE_USER)
    expect(s.status).toBe("authenticated")
    expect(s.initialized).toBe(true)
    expect(s.sessionExpiresAt).toBe(EXPIRY)
  })
})
