import { describe, it, expect } from "vitest"
import { validateBookingSubmit } from "@/lib/booking-submit"

const future = new Date(Date.now() + 86_400_000)

describe("validateBookingSubmit (contrato de bloqueio do handleSubmit)", () => {
  it("aceita payload válido — !ok nunca bloqueia o apiPost", () => {
    expect(
      validateBookingSubmit({
        amount: 200,
        scheduledAt: future,
        notes: "Portão azul",
        quantity: 2,
        paymentMethod: "PIX",
      }),
    ).toEqual({ ok: true })
  })

  it("bloqueia amount negativo com scope=booking", () => {
    const result = validateBookingSubmit({
      amount: -5,
      scheduledAt: future,
      paymentMethod: "PIX",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.scope).toBe("booking")
      expect(result.message).toContain("entre 0 e 1.000.000")
    }
  })

  it("bloqueia data no passado com scope=booking", () => {
    const result = validateBookingSubmit({
      amount: 100,
      scheduledAt: new Date(Date.now() - 1000),
      paymentMethod: "PIX",
    })
    expect(result).toEqual({
      ok: false,
      scope: "booking",
      message: "A data de agendamento deve ser no futuro",
    })
  })

  it("bloqueia notes > 1000 com scope=booking", () => {
    const result = validateBookingSubmit({
      amount: 100,
      scheduledAt: future,
      notes: "a".repeat(1001),
      paymentMethod: "PIX",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.scope).toBe("booking")
  })

  it("bloqueia quantity fora de 1..1000 com scope=booking", () => {
    for (const quantity of [0, 1001]) {
      const result = validateBookingSubmit({
        amount: 100,
        scheduledAt: future,
        quantity,
        paymentMethod: "PIX",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.scope).toBe("booking")
    }
  })

  it("valida booking ANTES de payment (ordem do handleSubmit)", () => {
    // amount inválido + método inválido ⇒ erro de booking prevalece
    const result = validateBookingSubmit({
      amount: -1,
      scheduledAt: future,
      paymentMethod: "BOLETO",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.scope).toBe("booking")
  })

  it("bloqueia método inválido com scope=payment", () => {
    const result = validateBookingSubmit({
      amount: 100,
      scheduledAt: future,
      paymentMethod: "BOLETO",
    })
    expect(result).toEqual({
      ok: false,
      scope: "payment",
      message: "Método de pagamento deve ser CARD ou PIX",
    })
  })

  it("documenta precedência: teto do booking (1M) é menor que o do payment (10M)", () => {
    // Qualquer amount que passe no booking passa no amount do payment;
    // scope=payment no helper atual só ocorre por método inválido.
    const result = validateBookingSubmit({
      amount: 11_000_000,
      scheduledAt: future,
      paymentMethod: "PIX",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.scope).toBe("booking")
  })
})
