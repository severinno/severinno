import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getOrCreateReferralCode,
  registerReferralInvite,
  processReferralFirstBookingConversion,
  getReferralStats,
  getReferralLeaderboard,
  isAmbassador,
} from "@/lib/referral"

const mockCache = new Map<string, any>()

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "referrer-1", name: "Carlos Eduardo Silva", avatarUrl: null }]),
    },
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => mockCache.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    mockCache.set(key, val)
    return true
  }),
}))

vi.mock("@/lib/loyalty", () => ({
  awardPoints: vi.fn().mockResolvedValue({ points: 50, total: 150, newBadges: [] }),
}))

describe("Referral Engine (Indique e Ganhe)", () => {
  beforeEach(() => {
    mockCache.clear()
    vi.clearAllMocks()
  })

  it("gera código de indicação determinístico e consistente", async () => {
    const code1 = await getOrCreateReferralCode("user-123")
    expect(code1).toMatch(/^SEV[A-Z0-9]{5}$/)

    // Deve retornar o mesmo código armazenado
    const code2 = await getOrCreateReferralCode("user-123")
    expect(code2).toBe(code1)
  })

  it("registra convite de indicação vinculando novo usuário", async () => {
    const code = await getOrCreateReferralCode("referrer-1")
    const success = await registerReferralInvite("invited-user-2", code)

    expect(success).toBe(true)

    // Não deve permitir auto-indicação
    const selfInvite = await registerReferralInvite("referrer-1", code)
    expect(selfInvite).toBe(false)
  })

  it("recompensa o indicador com +50 pontos na primeira conversão de agendamento", async () => {
    const code = await getOrCreateReferralCode("referrer-1")
    await registerReferralInvite("client-new", code)

    // Primeira conversão
    const res1 = await processReferralFirstBookingConversion("booking-1", "client-new")
    expect(res1.rewarded).toBe(true)
    expect(res1.pointsAwarded).toBe(50)
    expect(res1.referrerId).toBe("referrer-1")

    // Segunda tentativa para o mesmo cliente não deve recompensar novamente (idempotência)
    const res2 = await processReferralFirstBookingConversion("booking-2", "client-new")
    expect(res2.rewarded).toBe(false)
  })

  it("retorna estatísticas completas e links de compartilhamento", async () => {
    const code = await getOrCreateReferralCode("referrer-1")
    await registerReferralInvite("friend-1", code)

    const stats = await getReferralStats("referrer-1")
    expect(stats.code).toBe(code)
    expect(stats.totalInvites).toBe(1)
    expect(stats.inviteLink).toContain(`/convite/${code}`)
    expect(stats.whatsappShareUrl).toContain("api.whatsapp.com")
  })

  it("retorna o ranking do leaderboard e identifica embaixadores", async () => {
    const code = await getOrCreateReferralCode("referrer-1")
    await registerReferralInvite("client-a", code)
    await processReferralFirstBookingConversion("b-1", "client-a")

    const leaderboard = await getReferralLeaderboard(10)
    expect(leaderboard.length).toBe(1)
    expect(leaderboard[0].rank).toBe(1)
    expect(leaderboard[0].userId).toBe("referrer-1")
    // PII Guard check: "Carlos Eduardo Silva" -> "Carlos S."
    expect(leaderboard[0].name).toBe("Carlos S.")
    expect(leaderboard[0].convertedCount).toBe(1)

    // Testa detecção de Embaixador (>= 3 amigos)
    expect(await isAmbassador("referrer-1")).toBe(false)
    mockCache.set("referral:converted_count:referrer-1", 4)
    expect(await isAmbassador("referrer-1")).toBe(true)
  })
})
