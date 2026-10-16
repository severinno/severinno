import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../route"
import { NextRequest } from "next/server"

const mockGetSession = vi.fn()
const mockAssertRateLimit = vi.fn()
const mockUploadBuffer = vi.fn().mockResolvedValue("https://s3.example.com/file.jpg")

vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: () => mockAssertRateLimit(),
}))

vi.mock("@/lib/s3", () => ({
  uploadBuffer: (...args: any[]) => mockUploadBuffer(...args),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: "user-123" }),
    },
  },
}))

describe("POST /api/auth/identity security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna 401 para requisição sem sessão ativa", async () => {
    mockGetSession.mockResolvedValue(null)
    const req = new NextRequest("http://localhost:3000/api/auth/identity", {
      method: "POST",
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("rejeita upload com MIME type não permitido (ex: script ou html)", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1" })

    const form = new FormData()
    form.append("document", new Blob(["alert(1)"], { type: "text/html" }), "doc.html")
    form.append("selfie", new Blob(["alert(2)"], { type: "text/html" }), "selfie.html")

    const req = {
      formData: async () => form,
    } as unknown as NextRequest

    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("Formato de arquivo não suportado")
  })

  function createTestFile(bytes: Uint8Array, type: string, name: string) {
    return {
      name,
      type,
      size: bytes.length,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as File
  }

  it("rejeita arquivo com extensão/MIME adulterado que falha na assinatura de magic bytes", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1" })

    // Payload texto plano fingindo ser image/png
    const fakeBytes = new TextEncoder().encode("NOT_A_REAL_PNG_HEADER")
    const fakeDoc = createTestFile(fakeBytes, "image/png", "document.png")
    const fakeSelfie = createTestFile(fakeBytes, "image/png", "selfie.png")

    const req = {
      formData: async () => ({
        get: (field: string) => (field === "document" ? fakeDoc : fakeSelfie),
      }),
    } as unknown as NextRequest

    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("Documento corrompido ou inválido")
  })

  it("aceita upload com magic bytes PNG e JPEG legítimos", async () => {
    mockGetSession.mockResolvedValue({ userId: "u-1" })

    // Bytes legítimos de cabeçalho PNG: 89 50 4E 47 0D 0A 1A 0A
    const validPngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ])
    // Bytes legítimos de cabeçalho JPEG: FF D8 FF
    const validJpgBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ])

    const validDoc = createTestFile(validPngBytes, "image/png", "doc.png")
    const validSelfie = createTestFile(validJpgBytes, "image/jpeg", "selfie.jpg")

    const req = {
      formData: async () => ({
        get: (field: string) => (field === "document" ? validDoc : validSelfie),
      }),
    } as unknown as NextRequest

    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBeDefined()
    expect(mockUploadBuffer).toHaveBeenCalledTimes(2)
  })
})
