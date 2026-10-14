import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST as verifyIdentity } from "@/app/api/provider/verify-identity/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

const PROVIDER_ID = "prov-123"

function createRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/provider/verify-identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/provider/verify-identity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: PROVIDER_ID, role: "PROVIDER" } as never)
  })

  it("rejeita com 403 se o usuário não for prestador", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" } as never)

    const req = createRequest({
      docUrl: "https://example.com/doc.jpg",
      selfieUrl: "https://example.com/selfie.jpg",
    })
    const res = await verifyIdentity(req)
    expect(res.status).toBe(403)
  })

  it("processa com aprovação automática quando documentos são válidos e consistentes", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      cpfCnpj: "123.456.789-00",
      name: "João Eletricista",
    } as never)

    vi.mocked(db.user.update).mockResolvedValue({
      id: PROVIDER_ID,
      name: "João Eletricista",
      identityStatus: "approved",
      verified: true,
    } as never)

    const req = createRequest({
      docUrl: "https://cdn.example.com/cnh-joao.jpg",
      selfieUrl: "https://cdn.example.com/selfie-joao.jpg",
      docType: "CNH",
    })

    const res = await verifyIdentity(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.kyc.autoApproved).toBe(true)
    expect(data.user.identityStatus).toBe("approved")
    expect(data.user.verified).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityStatus: "approved",
          verified: true,
        }),
      }),
    )
  })

  it("retorna 400 se a selfie for idêntica ao documento", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      cpfCnpj: "123.456.789-00",
      name: "João Eletricista",
    } as never)

    const req = createRequest({
      docUrl: "https://cdn.example.com/mesma-foto.jpg",
      selfieUrl: "https://cdn.example.com/mesma-foto.jpg",
    })

    const res = await verifyIdentity(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("A imagem da selfie não pode ser idêntica à do documento")
  })
})
