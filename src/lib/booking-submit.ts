import { bookingValidationRules, paymentValidationRules } from "@/lib/validators"

export interface BookingSubmitValidationInput {
  amount: number
  scheduledAt: Date
  notes?: string
  quantity?: number
  paymentMethod: string
}

export type BookingSubmitValidation =
  { ok: true } | { ok: false; scope: "booking" | "payment"; message: string }

/**
 * Validação cliente do submit de agendamento (usada pelo BookingModal antes
 * do apiPost). Retorna a primeira mensagem em PT para toast + banner inline.
 * O contrato de bloqueio é simples: `!ok` ⇒ não chamar `apiPost`.
 */
export function validateBookingSubmit(
  input: BookingSubmitValidationInput,
): BookingSubmitValidation {
  const bookingParsed = bookingValidationRules.safeParse({
    amount: input.amount,
    scheduledAt: input.scheduledAt,
    notes: input.notes,
    quantity: input.quantity,
  })
  if (!bookingParsed.success) {
    return {
      ok: false,
      scope: "booking",
      message: bookingParsed.error.issues[0]?.message ?? "Dados do agendamento inválidos.",
    }
  }

  const paymentParsed = paymentValidationRules.safeParse({
    amount: input.amount,
    method: input.paymentMethod,
  })
  if (!paymentParsed.success) {
    return {
      ok: false,
      scope: "payment",
      message: paymentParsed.error.issues[0]?.message ?? "Dados de pagamento inválidos.",
    }
  }

  return { ok: true }
}
