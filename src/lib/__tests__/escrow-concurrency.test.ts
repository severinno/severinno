import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) }),
}))

const mockRequireUser = vi.fn()
vi.mock("@/lib/auth", () => ({
  requireUser: () => mockRequireUser(),
}))

const mockNotifyPaymentConfirmed = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/notifications", () => ({
  notifyPaymentConfirmed: (...args: any[]) => mockNotifyPaymentConfirmed(...args),
}))

const mockProcessReferralFirstBookingConversion = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/referral", () => ({
  processReferralFirstBookingConversion: (...args: any[]) =>
    mockProcessReferralFirstBookingConversion(...args),
}))

const mockAwardPoints = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/loyalty", () => ({
  awardPoints: (...args: any[]) => mockAwardPoints(...args),
}))

// Stateful Mock DB for realistic Postgres Row-Level Lock & Concurrency Simulation
const { mockDb, getBookingState, setBookingState } = vi.hoisted(() => {
  let state: any = null

  const db = {
    booking: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (state && where.id === state.id) {
          return { ...state }
        }
        return null
      }),
      updateMany: vi
        .fn()
        .mockImplementation(
          async ({ where, data }: { where: { id: string; escrowReleasedAt: null }; data: any }) => {
            // Atomic conditional update simulation: only succeeds if escrowReleasedAt is currently null
            if (state && where.id === state.id && state.escrowReleasedAt === null) {
              state.escrowReleasedAt = data.escrowReleasedAt ?? new Date()
              state.status = data.status ?? state.status
              state.paymentStatus = data.paymentStatus ?? state.paymentStatus
              return { count: 1 }
            }
            return { count: 0 }
          },
        ),
    },
    payment: {
      updateMany: vi.fn().mockImplementation(async () => ({ count: 1 })),
    },
    $transaction: vi.fn().mockImplementation(async (promises: any[]) => {
      return Promise.all(promises)
    }),
  }

  return {
    mockDb: db,
    getBookingState: () => state,
    setBookingState: (s: any) => {
      state = s
    },
  }
})

vi.mock("@/lib/db", () => ({
  db: mockDb,
}))

import { POST } from "@/app/api/bookings/[id]/confirm-completion/route"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Escrow Concurrency & Atomic Protection Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRequireUser.mockResolvedValue({
      userId: "client-123",
      role: "CLIENT",
    })

    setBookingState({
      id: "booking-concurrent-test-1",
      clientId: "client-123",
      providerId: "provider-456",
      status: "IN_PROGRESS",
      paymentStatus: "HELD",
      amount: 250.0,
      escrowReleasedAt: null,
      service: { title: "Instalação Elétrica Residencial" },
      provider: { id: "provider-456", name: "Carlos Silva Eletricista" },
      client: { id: "client-123", name: "Ana Maria Cliente" },
    })
  })

  it("prova que 10 requisições simultâneas em Promise.all liberam escrow exatamente 1 vez", async () => {
    const CONCURRENT_REQUESTS = 10
    const promises: Promise<Response>[] = []

    // Dispara 10 requisições concorrentes idênticas no mesmo instante
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      const req = createMockRequest({ method: "POST" }) as any
      const params = Promise.resolve({ id: "booking-concurrent-test-1" })
      promises.push(POST(req, { params }))
    }

    const responses = await Promise.all(promises)
    const results = await Promise.all(responses.map((res) => parseResponse(res)))

    // Conta quantos sucessos e quantas rejeições ocorreram
    const successes = results.filter((r) => r.status === 200)
    const conflicts = results.filter((r) => r.status === 400)

    // PROVA DE ATOMICIDADE: Exatamente 1 vitória, exatamente 9 contenções concorrentes
    expect(successes).toHaveLength(1)
    expect(conflicts).toHaveLength(CONCURRENT_REQUESTS - 1)

    // A resposta vencedora deve conter os dados de sucesso e pontos
    const winnerBody = successes[0].body as any
    expect(winnerBody.ok).toBe(true)
    expect(winnerBody.pointsAwarded).toBe(10)
    expect(winnerBody.message).toContain("pagamento liberado ao prestador com sucesso")

    // Todas as outras 9 devem acusar liberação concorrente ou já liberada com fail-safe
    conflicts.forEach((conflict) => {
      const conflictBody = conflict.body as any
      expect(conflictBody.error).toMatch(/já foi liberada/i)
    })

    // PROVA DE INTEGRIDADE FINANCEIRA: Notificação ao prestador enviada EXATAMENTE 1 vez
    expect(mockNotifyPaymentConfirmed).toHaveBeenCalledTimes(1)
    expect(mockNotifyPaymentConfirmed).toHaveBeenCalledWith(
      "provider-456",
      "booking-concurrent-test-1",
      250,
    )

    // PROVA DO MANDATO ANTI-CASH & FIDELIDADE: Bônus concedido EXATAMENTE 1 vez (zero duplicidade)
    expect(mockAwardPoints).toHaveBeenCalledTimes(2) // 1 para client, 1 para provider
    expect(mockAwardPoints).toHaveBeenCalledWith("client-123", "booking_completed")
    expect(mockAwardPoints).toHaveBeenCalledWith("provider-456", "booking_completed")

    // PROVA DE INDICAÇÃO: Conversão avaliada EXATAMENTE 1 vez
    expect(mockProcessReferralFirstBookingConversion).toHaveBeenCalledTimes(1)
    expect(mockProcessReferralFirstBookingConversion).toHaveBeenCalledWith(
      "booking-concurrent-test-1",
      "client-123",
      "provider-456",
    )

    // Estado final do banco: custódia consolidada em PAID com data de liberação
    const finalState = getBookingState()
    expect(finalState.status).toBe("COMPLETED")
    expect(finalState.paymentStatus).toBe("PAID")
    expect(finalState.escrowReleasedAt).toBeInstanceOf(Date)
  })

  it("rejeita fail-safe se um usuário tentar liberar custódia de um booking que já foi pago anteriormente", async () => {
    // Configura booking já previamente liberado
    const current = getBookingState()
    setBookingState({
      ...current,
      escrowReleasedAt: new Date("2026-10-19T14:00:00Z"),
      paymentStatus: "PAID",
      status: "COMPLETED",
    })

    const req = createMockRequest({ method: "POST" }) as any
    const params = Promise.resolve({ id: "booking-concurrent-test-1" })
    const res = await POST(req, { params })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe(
      "A custódia deste agendamento já foi liberada anteriormente",
    )

    // Nenhuma operação financeira ou de pontos disparada
    expect(mockNotifyPaymentConfirmed).not.toHaveBeenCalled()
    expect(mockAwardPoints).not.toHaveBeenCalled()
  })

  it("bloqueia tentativa de liberação por terceiros (IDOR / controle de posse rigoroso)", async () => {
    // Usuário logado não é o contratante nem ADMIN
    mockRequireUser.mockResolvedValue({
      userId: "intruder-user-999",
      role: "CLIENT",
    })

    const req = createMockRequest({ method: "POST" }) as any
    const params = Promise.resolve({ id: "booking-concurrent-test-1" })
    const res = await POST(req, { params })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(403)
    expect((parsed.body as any).error).toContain(
      "Apenas o cliente contratante pode confirmar a conclusão",
    )

    // Nenhuma alteração no escrow
    expect(getBookingState().escrowReleasedAt).toBeNull()
    expect(mockAwardPoints).not.toHaveBeenCalled()
  })

  it("permite liberação por administrador com perfil ADMIN", async () => {
    mockRequireUser.mockResolvedValue({
      userId: "admin-master",
      role: "ADMIN",
    })

    const req = createMockRequest({ method: "POST" }) as any
    const params = Promise.resolve({ id: "booking-concurrent-test-1" })
    const res = await POST(req, { params })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    const finalState = getBookingState()
    expect(finalState.status).toBe("COMPLETED")
    expect(finalState.paymentStatus).toBe("PAID")
    expect(finalState.escrowReleasedAt).not.toBeNull()
  })
})
