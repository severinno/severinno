import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "@/app/api/referral/route"
import { requireUser } from "@/lib/auth"
import { getReferralStats, registerReferralInvite } from "@/lib/referral"

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/referral", () => ({
  getReferralStats: vi.fn(),
  registerReferralInvite: vi.fn(),
}))

describe("API /api/referral", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "u-1", role: "CLIENT" } as never)
  })

  it("GET retorna estatísticas do programa de indicação", async () => {
    vi.mocked(getReferralStats).mockResolvedValue({
      code: "SEV12345",
      inviteLink: "https://severinno.com.br/convite/SEV12345",
      shareText: "Convite",
      whatsappShareUrl: "https://api.whatsapp.com/...",
      totalInvites: 5,
      activeFriends: 2,
      pointsEarned: 100,
      tierBonusTitle: "Indicador Ativo",
    })

    const req = new Request("http://localhost:3000/api/referral")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stats.code).toBe("SEV12345")
    expect(json.stats.pointsEarned).toBe(100)
  })

  it("POST vincula código com sucesso", async () => {
    vi.mocked(registerReferralInvite).mockResolvedValue(true)

    const req = new Request("http://localhost:3000/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SEV99999" }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(registerReferralInvite).toHaveBeenCalledWith("u-1", "SEV99999", "client")
  })

  it("POST rejeita código inválido com 400", async () => {
    vi.mocked(registerReferralInvite).mockResolvedValue(false)

    const req = new Request("http://localhost:3000/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "INVALID" }),
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })
})
