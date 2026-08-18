/**
 * Domain-specific typed error classes for Severinno Marketplace.
 *
 * Each error class defines standard machine-readable codes, default
 * human-readable messages (pt-BR), and corresponding HTTP status codes.
 */

// ---------------------------------------------------------------------------
// Booking Errors
// ---------------------------------------------------------------------------

export type BookingErrorCode =
  | "BOOKING_NOT_FOUND"
  | "SLOT_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_STATUS_TRANSITION"
  | "BOOKING_ALREADY_CANCELLED"
  | "BOOKING_ALREADY_COMPLETED"
  | "UNAUTHORIZED_ACTION"
  | "INVALID_PIN"

const BOOKING_ERROR_STATUS: Record<BookingErrorCode, number> = {
  BOOKING_NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  PROVIDER_UNAVAILABLE: 409,
  INVALID_STATUS_TRANSITION: 400,
  BOOKING_ALREADY_CANCELLED: 400,
  BOOKING_ALREADY_COMPLETED: 400,
  UNAUTHORIZED_ACTION: 403,
  INVALID_PIN: 400,
}

const BOOKING_ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  BOOKING_NOT_FOUND: "Agendamento não encontrado",
  SLOT_UNAVAILABLE: "Horário indisponível para agendamento",
  PROVIDER_UNAVAILABLE: "Prestador indisponível no momento selecionado",
  INVALID_STATUS_TRANSITION: "Transição de status do agendamento inválida",
  BOOKING_ALREADY_CANCELLED: "Este agendamento já foi cancelado",
  BOOKING_ALREADY_COMPLETED: "Este agendamento já foi concluído",
  UNAUTHORIZED_ACTION: "Você não tem permissão para alterar este agendamento",
  INVALID_PIN: "Código PIN de confirmação incorreto",
}

export class BookingError extends Error {
  readonly code: BookingErrorCode
  readonly status: number

  constructor(code: BookingErrorCode, message?: string) {
    super(message ?? BOOKING_ERROR_MESSAGES[code])
    this.name = "BookingError"
    this.code = code
    this.status = BOOKING_ERROR_STATUS[code] ?? 400
    Object.setPrototypeOf(this, BookingError.prototype)
  }
}

// ---------------------------------------------------------------------------
// Payment Errors
// ---------------------------------------------------------------------------

export type PaymentErrorCode =
  | "PAYMENT_NOT_FOUND"
  | "ALREADY_PAID"
  | "PAYMENT_FAILED"
  | "INSUFFICIENT_FUNDS"
  | "GATEWAY_TIMEOUT"
  | "INVALID_SPLIT"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "INVALID_PAYMENT_METHOD"
  | "RECIPIENT_NOT_CONFIGURED"

const PAYMENT_ERROR_STATUS: Record<PaymentErrorCode, number> = {
  PAYMENT_NOT_FOUND: 404,
  ALREADY_PAID: 409,
  PAYMENT_FAILED: 402,
  INSUFFICIENT_FUNDS: 402,
  GATEWAY_TIMEOUT: 504,
  INVALID_SPLIT: 400,
  WEBHOOK_VERIFICATION_FAILED: 401,
  INVALID_PAYMENT_METHOD: 400,
  RECIPIENT_NOT_CONFIGURED: 422,
}

const PAYMENT_ERROR_MESSAGES: Record<PaymentErrorCode, string> = {
  PAYMENT_NOT_FOUND: "Pagamento não encontrado",
  ALREADY_PAID: "Este agendamento já foi pago",
  PAYMENT_FAILED: "Falha no processamento do pagamento",
  INSUFFICIENT_FUNDS: "Saldo ou limite insuficiente",
  GATEWAY_TIMEOUT: "Tempo limite excedido na comunicação com o gateway",
  INVALID_SPLIT: "Configuração de split de pagamento inválida",
  WEBHOOK_VERIFICATION_FAILED: "Assinatura do webhook inválida",
  INVALID_PAYMENT_METHOD: "Método de pagamento não suportado",
  RECIPIENT_NOT_CONFIGURED: "Conta recebedora do prestador não configurada no gateway",
}

export class PaymentError extends Error {
  readonly code: PaymentErrorCode
  readonly status: number

  constructor(code: PaymentErrorCode, message?: string) {
    super(message ?? PAYMENT_ERROR_MESSAGES[code])
    this.name = "PaymentError"
    this.code = code
    this.status = PAYMENT_ERROR_STATUS[code] ?? 400
    Object.setPrototypeOf(this, PaymentError.prototype)
  }
}
