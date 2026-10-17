import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getOrCreateReferralCode,
  getReferrerByCode,
  registerReferralInvite,
  processReferralFirstBookingConversion,
  getReferralStats,
  getReferralLeaderboard,
  isAmbassador,
} from "@/lib/referral"

const memoryCache = new Map<string, any>()

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
          const users = [
            {
              id: "usr_referrer_001",
              name: "Lucas Ferreira Mendes",
              avatarUrl: "https://avatar.io/lucas.png",
            },
            { id: "usr_invitee_001", name: "Beatriz Oliveira Santos", avatarUrl: null },
            { id: "usr_fraud_001", name: "Marcos Rogério Silva", avatarUrl: null },
          ]
          return users.filter((u) => where.id.in.includes(u.id))
        }),
    },
    booking: {
      count: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { clientId: string; status: string } }) => {
          // Simula que 'usr_fraud_001' já tem agendamento concluído
          if (where.clientId === "usr_fraud_001") return 3
          return 0
        }),
    },
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => memoryCache.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    memoryCache.set(key, val)
    return true
  }),
}))

const mockAwardPoints = vi.fn().mockResolvedValue({ points: 50, total: 200, newBadges: [] })
vi.mock("@/lib/loyalty", () => ({
  awardPoints: (...args: any[]) => mockAwardPoints(...args),
}))

describe("Jornada E2E: Indique e Ganhe (Referral & Anti-Fraude)", () => {
  beforeEach(() => {
    memoryCache.clear()
    vi.clearAllMocks()
  })

  it("executa a esteira completa: do convite à premiação com proteção anti-fraude e LGPD", async () => {
    const referrerId = "usr_referrer_001"
    const newInviteeId = "usr_invitee_001"
    const existingClientId = "usr_fraud_001"

    // 1. Indicador gera código único de 24-bits de entropia (SEV + 6 hex)
    const referralCode = await getOrCreateReferralCode(referrerId)
    expect(referralCode).toMatch(/^SEV[A-Z0-9]{6}$/)

    // 2. Resolução do código aponta para o indicador correto
    const resolvedReferrer = await getReferrerByCode(referralCode)
    expect(resolvedReferrer).toBe(referrerId)

    // 3. Bloqueio Anti-Fraude: Auto-indicação é terminantemente rejeitada
    const selfInvite = await registerReferralInvite(referrerId, referralCode)
    expect(selfInvite).toBe(false)

    // 4. Bloqueio Anti-Fraude: Usuário antigo com agendamentos anteriores não pode ser indicado
    const fraudInvite = await registerReferralInvite(existingClientId, referralCode)
    expect(fraudInvite).toBe(false)

    // 5. Novo usuário válido acessa o link e é vinculado com sucesso
    const validInvite = await registerReferralInvite(newInviteeId, referralCode)
    expect(validInvite).toBe(true)

    // 6. Idempotência do vínculo: novo vínculo não sobrescreve
    const duplicateInvite = await registerReferralInvite(newInviteeId, referralCode)
    expect(duplicateInvite).toBe(true)

    // 7. Estatísticas do indicador refletem 1 convite registrado
    const statsBeforeConversion = await getReferralStats(referrerId)
    expect(statsBeforeConversion.totalInvites).toBe(1)
    expect(statsBeforeConversion.activeFriends).toBe(0)
    expect(statsBeforeConversion.pointsEarned).toBe(0)
    expect(statsBeforeConversion.inviteLink).toContain(`/convite/${referralCode}`)

    // 8. O convidado conclui seu primeiro agendamento pago (disparado pelo webhook Lytex)
    const conversionResult = await processReferralFirstBookingConversion(
      "booking_pay_999",
      newInviteeId,
    )
    expect(conversionResult.rewarded).toBe(true)
    expect(conversionResult.pointsAwarded).toBe(50)
    expect(conversionResult.referrerId).toBe(referrerId)
    expect(mockAwardPoints).toHaveBeenCalledWith(referrerId, "referral")

    // 9. Idempotência da conversão: novo agendamento do mesmo cliente não premia novamente
    const secondBookingResult = await processReferralFirstBookingConversion(
      "booking_pay_1000",
      newInviteeId,
    )
    expect(secondBookingResult.rewarded).toBe(false)
    expect(mockAwardPoints).toHaveBeenCalledTimes(1)

    // 10. Estatísticas atualizadas mostram 1 amigo ativo e 50 pontos
    const statsAfterConversion = await getReferralStats(referrerId)
    expect(statsAfterConversion.activeFriends).toBe(1)
    expect(statsAfterConversion.pointsEarned).toBe(50)

    // 11. Leaderboard público exibe dados com proteção de PII (LGPD) e userId anonimizado
    const leaderboard = await getReferralLeaderboard(10)
    expect(leaderboard.length).toBe(1)
    expect(leaderboard[0].rank).toBe(1)
    expect(leaderboard[0].convertedCount).toBe(1)
    expect(leaderboard[0].pointsEarned).toBe(50)

    // PII Guard: nome completo ("Lucas Ferreira Mendes") mascarado como "Lucas M."
    expect(leaderboard[0].name).toBe("Lucas M.")

    // LGPD Guard: ID interno do banco ("usr_referrer_001") não é exposto
    expect(leaderboard[0].userId).not.toBe(referrerId)
    expect(leaderboard[0].userId).toMatch(/^ref_[a-f0-9]{10}$/)

    // 12. Teste de promoção de nível para Embaixador (>= 3 amigos ativos)
    expect(await isAmbassador(referrerId)).toBe(false)
    memoryCache.set(`referral:converted_count:${referrerId}`, 3)
    expect(await isAmbassador(referrerId)).toBe(true)
  })
})
