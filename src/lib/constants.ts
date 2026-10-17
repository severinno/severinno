/**
 * Constants & labels for the Severinno Marketplace (pt-BR).
 * Centralized so the UI doesn't hardcode Portuguese strings everywhere.
 */

// ---------------------------------------------------------------------------
// ROLES
// ---------------------------------------------------------------------------
export type UserRole = "CLIENT" | "PROVIDER" | "ADMIN"

export const ROLE_LABELS: Record<UserRole, string> = {
  CLIENT: "Cliente",
  PROVIDER: "Prestador",
  ADMIN: "Administrador",
}

// ---------------------------------------------------------------------------
// SERVICE UNITS
// ---------------------------------------------------------------------------
// Fonte canônica das unidades de serviço — espelha o enum ServiceUnit do
// Prisma (UNIDADE, METRO_LINEAR, METRO_QUADRADO, METRO_CUBICO, HORA).
// Não duplicar: importe daqui (tipos em @/lib/api re-exportam este).
export const SERVICE_UNITS = [
  "UNIDADE",
  "METRO_LINEAR",
  "METRO_QUADRADO",
  "METRO_CUBICO",
  "HORA",
] as const

export type ServiceUnit = (typeof SERVICE_UNITS)[number]

export const SERVICE_UNIT_LABELS: Record<ServiceUnit, string> = {
  UNIDADE: "Unidade",
  METRO_LINEAR: "Metro linear",
  METRO_QUADRADO: "Metro quadrado (m²)",
  METRO_CUBICO: "Metro cúbico (m³)",
  HORA: "Hora",
}

export const SERVICE_UNIT_SHORT: Record<ServiceUnit, string> = {
  UNIDADE: "un",
  METRO_LINEAR: "m",
  METRO_QUADRADO: "m²",
  METRO_CUBICO: "m³",
  HORA: "h",
}

// ---------------------------------------------------------------------------
// QUOTE STATUS
// ---------------------------------------------------------------------------
export type QuoteStatus = "PENDING" | "RESPONDED" | "APPROVED" | "REJECTED" | "EXPIRED"

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  PENDING: "Aguardando resposta",
  RESPONDED: "Respondido",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
  EXPIRED: "Expirado",
}

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  // Tailwind classes — bg-amber-100 text-amber-700 etc.
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  RESPONDED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  EXPIRED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
}

export type QuoteItemStatus = "PENDING" | "QUOTED" | "ACCEPTED" | "REJECTED"

export const QUOTE_ITEM_STATUS_LABELS: Record<QuoteItemStatus, string> = {
  PENDING: "Aguardando orçamento",
  QUOTED: "Orçado",
  ACCEPTED: "Aceito",
  REJECTED: "Recusado",
}

// ---------------------------------------------------------------------------
// BOOKING STATUS
// ---------------------------------------------------------------------------
export type BookingStatus = "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
}

export const BOOKING_STATUS_COLORS: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  IN_PROGRESS: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  COMPLETED: "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
}

// ---------------------------------------------------------------------------
// PAYMENT
// ---------------------------------------------------------------------------
export type PaymentMethod = "CARD" | "PIX"
export type PaymentStatus = "PENDING" | "AUTHORIZED" | "HELD" | "PAID" | "REFUNDED" | "FAILED"

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CARD: "Cartão",
  PIX: "PIX",
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Pagamento pendente",
  AUTHORIZED: "Autorizado",
  HELD: "Em custódia protegida",
  PAID: "Pago",
  REFUNDED: "Estornado",
  FAILED: "Falhou",
}

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  AUTHORIZED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  HELD: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REFUNDED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
}

// ---------------------------------------------------------------------------
// WEEKDAYS
// ---------------------------------------------------------------------------
export const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const

export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const

// ---------------------------------------------------------------------------
// NOTIFICATION TYPES (examples — UI may render with icon mapping)
// ---------------------------------------------------------------------------
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  BOOKING_CONFIRMED: "Agendamento confirmado",
  BOOKING_CANCELLED: "Agendamento cancelado",
  BOOKING_COMPLETED: "Serviço concluído",
  QUOTE_RECEIVED: "Você recebeu um orçamento",
  QUOTE_APPROVED: "Orçamento aprovado",
  MESSAGE: "Nova mensagem",
  REVIEW_RECEIVED: "Nova avaliação",
  WELCOME: "Bem-vindo ao Severinno",
}

// ---------------------------------------------------------------------------
// APP META
// ---------------------------------------------------------------------------
export const APP_NAME = "Severinno"
export const APP_TAGLINE = "Marketplace de serviços com geolocalização"

// Default search radius when none provided (km)
export const DEFAULT_SEARCH_RADIUS_KM = 15

// ---------------------------------------------------------------------------
// FINANCE / COMMISSION
// ---------------------------------------------------------------------------
// Platform commission rate (15% of each booking)
export const FEE_RATE = 0.15
