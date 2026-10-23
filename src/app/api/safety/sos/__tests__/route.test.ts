import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST, GET, PATCH } from "../route"
import { clearSOSIncidentsForTesting, triggerEmergencySOS } from "@/lib/emergency-sos"
import { NextRequest } from "next/server"

const mockRequireUser = vi.fn()
const mockAssertRateLimit = vi.fn()

vi.mock("@/lib/auth", () => ({
  requireUser: () => mockRequireUser(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: () => mockAssertRateLimit(),
}))

describe("/api/safety/sos route security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSOSIncidentsForTesting()
  })

  it("rejeita requisições POST não autenticadas", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthorized"))
    const req = new NextRequest("http://localhost:3000/api/safety/sos", {
      method: "POST",
      body: JSON.stringify({
        latitude: -18.85,
        longitude: -41.95,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it("cria incidente vinculado estritamente ao session.userId", async () => {
    mockRequireUser.mockResolvedValue({
      userId: "user-legit-123",
      role: "PROVIDER",
    })

    // Atacante tenta injetar userId de outra pessoa no body
    const req = new NextRequest("http://localhost:3000/api/safety/sos", {
      method: "POST",
      body: JSON.stringify({
        userId: "user-victim-999",
        latitude: -18.85,
        longitude: -41.95,
        userName: "Maria",
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    // O ID deve ser o da sessão, não o injetado
    expect(data.incident.userId).toBe("user-legit-123")
  })

  it("bloqueia leitura de incidente de terceiro (IDOR)", async () => {
    // Cria incidente pertencente a user-A
    const inc = triggerEmergencySOS({
      userId: "user-owner-A",
      userName: "User A",
      userRole: "CLIENT",
      latitude: -18.85,
      longitude: -41.95,
    })

    // Usuário B tenta ler
    mockRequireUser.mockResolvedValue({
      userId: "user-snooper-B",
      role: "CLIENT",
    })

    const req = new NextRequest(`http://localhost:3000/api/safety/sos?id=${inc.id}`, {
      method: "GET",
    })

    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it("permite leitura e resolução pelo próprio autor ou admin", async () => {
    const inc = triggerEmergencySOS({
      userId: "user-owner-A",
      userName: "User A",
      userRole: "CLIENT",
      latitude: -18.85,
      longitude: -41.95,
    })

    // Usuário A lê com sucesso
    mockRequireUser.mockResolvedValue({
      userId: "user-owner-A",
      role: "CLIENT",
    })

    const getReq = new NextRequest(`http://localhost:3000/api/safety/sos?id=${inc.id}`, {
      method: "GET",
    })

    const getRes = await GET(getReq)
    expect(getRes.status).toBe(200)

    // Usuário A resolve seu próprio alarme
    const patchReq = new NextRequest("http://localhost:3000/api/safety/sos", {
      method: "PATCH",
      body: JSON.stringify({
        sosId: inc.id,
        status: "RESOLVED",
        resolutionNotes: "Tudo bem agora",
      }),
    })

    const patchRes = await PATCH(patchReq)
    expect(patchRes.status).toBe(200)
    const patchData = await patchRes.json()
    expect(patchData.incident.status).toBe("RESOLVED")
  })
})
