import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  requiresOtpForRelease,
  generateEscrowOtp,
  verifyEscrowOtp,
  formatEscrowOtpWhatsAppMessage,
  HIGH_VALUE_THRESHOLD,
} from "../escrow-otp-challenge"

const mockOtpStore = new Map<string, any>()

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => mockOtpStore.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    mockOtpStore.set(key, val)
  }),
  cacheInvalidate: vi.fn(async (key: string) => {
    mockOtpStore.delete(key)
  }),
}))

describe("escrow-otp-challenge — Desafio OTP Anti-Fraude e Anti-Acidente", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockOtpStore.clear()
    // Relógio congelado (só Date): o TTL do OTP é comparado com Date.now().
    // Sem isso o teste depende do relógio de parede (guard check:clock-bombs).
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("determina quando o agendamento exige desafio OTP baseado no limiar e risco", () => {
    // 1. Abaixo do limiar com geofence validado
    expect(requiresOtpForRelease({ amount: 120, geofenceVerified: true })).toBe(false)

    // 2. Acima ou igual ao limiar (>= R$ 250)
    expect(requiresOtpForRelease({ amount: HIGH_VALUE_THRESHOLD, geofenceVerified: true })).toBe(
      true,
    )
    expect(requiresOtpForRelease({ amount: 500, geofenceVerified: true })).toBe(true)

    // 3. Valor médio (ex: R$ 150) sem geofence presencial validado (risco operacional)
    expect(requiresOtpForRelease({ amount: 150, geofenceVerified: false })).toBe(true)
  })

  it("gera código OTP de 4 dígitos e armazena com prazo de validade", async () => {
    const { otp, expiresAt } = await generateEscrowOtp("book-101", "client-abc")

    expect(otp).toMatch(/^\d{4}$/)
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  it("valida com sucesso o OTP correto e bloqueia reuso subsequente", async () => {
    const bookingId = "book-202"
    const { otp } = await generateEscrowOtp(bookingId, "client-xyz")

    // Primeira validação com código correto
    const result1 = await verifyEscrowOtp(bookingId, otp, "client-xyz")
    expect(result1.success).toBe(true)
    expect(result1.error).toBeUndefined()

    // Segunda validação com o mesmo código (já consumido/invalidado)
    const result2 = await verifyEscrowOtp(bookingId, otp, "client-xyz")
    expect(result2.success).toBe(false)
    expect(result2.error).toContain("expirado ou não encontrado")
  })

  it("rejeita código incorreto decrementando tentativas e bloqueando após 3 falhas", async () => {
    const bookingId = "book-303"
    await generateEscrowOtp(bookingId, "client-abc")

    // Tentativa errada 1
    const res1 = await verifyEscrowOtp(bookingId, "0000", "client-abc")
    expect(res1.success).toBe(false)
    expect(res1.error).toContain("mais 2 tentativa(s)")

    // Tentativa errada 2
    const res2 = await verifyEscrowOtp(bookingId, "0000", "client-abc")
    expect(res2.success).toBe(false)
    expect(res2.error).toContain("mais 1 tentativa(s)")

    // Tentativa errada 3 -> bloqueio
    const res3 = await verifyEscrowOtp(bookingId, "0000", "client-abc")
    expect(res3.success).toBe(false)
    expect(res3.error).toContain("Limite de tentativas excedido")
  })

  it("formata mensagem de desafio WhatsApp com valor, ID e instruções claras", () => {
    const msg = formatEscrowOtpWhatsAppMessage({ id: "booking-998877", amount: 350.0 }, "8492")

    expect(msg).toContain("Confirmação de Liberação Segura — Severinno")
    expect(msg).toContain("#998877")
    expect(msg).toContain("R$ 350.00")
    expect(msg).toContain("👉 *8492*")
    expect(msg).toContain("Válido por 10 minutos")
  })
})
