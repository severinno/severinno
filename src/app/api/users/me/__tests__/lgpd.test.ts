import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as dataExport } from "@/app/api/users/me/data-export/route"
import { POST as deleteAccount } from "@/app/api/users/me/delete-account/route"
import { getSession, requireUser, destroySession } from "@/lib/auth"
import { db } from "@/lib/db"
import { deleteIdentityArtifacts } from "@/lib/identity-retention"

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    booking: { findMany: vi.fn() },
    review: { findMany: vi.fn() },
    favorite: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth")>()
  return {
    ...mod,
    getSession: vi.fn(),
    requireUser: vi.fn(),
    destroySession: vi.fn(),
    invalidateSessionCache: vi.fn(),
    invalidateUserCache: vi.fn(),
  }
})

vi.mock("@/lib/identity-retention", () => ({
  deleteIdentityArtifacts: vi.fn().mockResolvedValue({ deletedKeys: 2 }),
}))

vi.mock("@/lib/tracing", () => ({
  traceSpan: vi.fn(async (_name: string, fn: (span: unknown) => Promise<unknown>) => {
    // Span fake no contrato do wrapper: setAttribute nunca falha.
    const fakeSpan = { setAttribute: vi.fn() }
    return fn(fakeSpan)
  }),
}))

vi.mock("@/lib/request-context", () => ({
  establishRequestContext: vi.fn(async () => "req-test"),
  getRequestId: () => "req-test",
}))

const SESSION_USER = { userId: "u-123", role: "CLIENT" as const, sessionVersion: 0 }
const anonReq = (init?: RequestInit) => new Request("http://localhost:3000/api/users/me", init)

describe("GET /api/users/me/data-export — portabilidade por allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSession).mockResolvedValue(SESSION_USER)
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-123",
      name: "Cliente",
      email: "c@x.com",
      role: "CLIENT",
      identityStatus: "approved",
      identityVerifiedAt: new Date(),
    } as never)
    vi.mocked(db.booking.findMany).mockResolvedValue([])
    vi.mocked(db.review.findMany).mockResolvedValue([])
    vi.mocked(db.favorite.findMany).mockResolvedValue([])
  })

  it("200 com attachment JSON e cabeçalho no-store", async () => {
    const res = await dataExport(anonReq())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toContain("attachment")
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = JSON.parse(await res.text())
    expect(body.usuario.id).toBe("u-123")
    expect(body.geradoEm).toBeTruthy()
  })

  it("NÃO exporta segredos (passwordHash/sessionVersion/2FA/lytex) nem URLs de biometria", async () => {
    const res = await dataExport(anonReq())
    const text = await res.text()
    expect(text).not.toContain("passwordHash")
    expect(text).not.toContain("sessionVersion")
    expect(text).not.toContain("twoFactor")
    expect(text).not.toContain("lytexRecipientId")
    expect(text).not.toContain("identityDocUrl")
    expect(text).not.toContain("identitySelfieUrl")
  })

  it("bookings anotam o papel (cliente × prestador)", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      { id: "b1", clientId: "u-123", providerId: "p-1" },
      { id: "b2", clientId: "p-1", providerId: "u-123" },
    ] as never)
    const res = await dataExport(anonReq())
    const body = JSON.parse(await res.text())
    expect(body.bookings[0].papel).toBe("cliente")
    expect(body.bookings[1].papel).toBe("prestador")
  })

  it("401 sem sessão", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await dataExport(anonReq())
    expect(res.status).toBe(401)
  })
})

describe("POST /api/users/me/delete-account — a exclusão sai da plataforma no ato", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSession).mockResolvedValue(SESSION_USER)
    vi.mocked(requireUser).mockResolvedValue(SESSION_USER)
    vi.mocked(destroySession).mockResolvedValue(undefined)
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "u-123", role: "CLIENT" } as never)
    vi.mocked(db.user.update).mockResolvedValue({} as never)
  })

  const req = (body: unknown) =>
    new Request("http://localhost:3000/api/users/me/delete-account", {
      method: "POST",
      body: JSON.stringify(body),
    })

  it("400 sem a frase de confirmação exata (exclusão não é clique)", async () => {
    const res = await deleteAccount(req({ confirm: "sim" }))
    expect(res.status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it("anonimiza, bumpa a sessão, marca deletedAt e encerra o cookie", async () => {
    const res = await deleteAccount(req({ confirm: "EXCLUIR MINHA CONTA" }))
    expect(res.status).toBe(200)

    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-123" },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          active: false,
          sessionVersion: { increment: 1 },
          email: expect.stringMatching(/^anon\+u-123@deleted\.severinno$/),
          cpfCnpj: null,
          twoFactorSecret: null,
        }),
      }),
    )
    expect(destroySession).toHaveBeenCalledTimes(1)
  })

  it("a biometria é removida ANTES da anonimização (retenção primeiro)", async () => {
    const calls: string[] = []
    vi.mocked(deleteIdentityArtifacts).mockImplementation(async () => {
      calls.push("biometria")
      return { deletedKeys: 2 }
    })
    vi.mocked(db.user.update).mockImplementation((() => {
      calls.push("anonimizar")
      return Promise.resolve({})
    }) as never)

    await deleteAccount(req({ confirm: "EXCLUIR MINHA CONTA" }))
    expect(calls).toEqual(["biometria", "anonimizar"])
  })

  it("ADMIN não exclui a própria conta por este caminho (403)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "u-123", role: "ADMIN" } as never)
    const res = await deleteAccount(req({ confirm: "EXCLUIR MINHA CONTA" }))
    expect(res.status).toBe(403)
  })

  it("401 sem sessão", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await deleteAccount(req({ confirm: "EXCLUIR MINHA CONTA" }))
    expect(res.status).toBe(401)
  })
})
