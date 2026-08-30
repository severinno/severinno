/**
 * API Security Utilities — centralized security helpers for route handlers.
 *
 * - Error sanitization (prevent internal details from leaking)
 * - Request body size limits
 * - Safe error response builder
 */
import logger from "./logger"

// ── Error Sanitization ────────────────────────────────────────────────────

/** Patterns that should NEVER appear in API error responses */
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /credentials/i,
  /prisma/i,
  /postgresql/i,
  /pg_/i,
  /sql/i,
  /database/i,
  /connection string/i,
  /redis/i,
  /stack trace/i,
  /node_modules/i,
  /\/home\/.*?\//i,
  /\/usr\/.*?\//i,
  /\/var\/.*?\//i,
]

/** Sanitize an error message for safe API response */
export function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Erro interno do servidor"

  const msg = error.message

  // Check if the message contains sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(msg)) {
      return "Erro interno do servidor"
    }
  }

  // Known safe error messages (can be passed through)
  const SAFE_MESSAGES = [
    "Dados inválidos",
    "Não autorizado",
    "Sessão inválida",
    "Acesso proibido",
    "Não encontrado",
    "Rate limit exceeded",
    "Muitas requisições",
    "Muitas tentativas",
    "Email já cadastrado",
    "CPF já cadastrado",
    "Senha incorreta",
    "Email não encontrado",
    "Token expirado",
    "Token inválido",
    "Código inválido",
    "Código expirado",
    "Serviço não encontrado",
    "Serviço inativo",
    "Booking não encontrado",
    "Pagamento não encontrado",
    "Saldo insuficiente",
    "Withdrawal pendente",
    "Provider não verificado",
    "Offline",
  ]

  for (const safe of SAFE_MESSAGES) {
    if (msg.toLowerCase().includes(safe.toLowerCase())) {
      return msg
    }
  }

  // For development, return the original message
  if (process.env.NODE_ENV !== "production") {
    return msg
  }

  // Production: generic message
  return "Erro interno do servidor"
}

/** Safe error response builder */
export function safeErrorResponse(
  error: unknown,
  fallbackStatus = 500,
): { message: string; status: number; details?: string[] } {
  const message = sanitizeErrorMessage(error)

  let status = fallbackStatus
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("não autorizado") || msg.includes("unauthorized")) status = 401
    else if (msg.includes("proibido") || msg.includes("forbidden")) status = 403
    else if (msg.includes("não encontrado") || msg.includes("not found")) status = 404
    else if (msg.includes("inválido") || msg.includes("invalid")) status = 400
    else if (msg.includes("rate limit") || msg.includes("muitas requisições")) status = 429
    else if (msg.includes("conflito") || msg.includes("conflict")) status = 409
  }

  // Log the full error internally (never expose to client)
  logger.error({ err: error, sanitizedMessage: message }, "API error")

  return { message, status }
}

// ── Request Body Size Limits ──────────────────────────────────────────────

/** Maximum request body sizes by route type (in bytes) */
export const BODY_SIZE_LIMITS = {
  /** Standard API endpoints */
  default: 1024 * 1024, // 1MB
  /** File upload endpoints */
  upload: 10 * 1024 * 1024, // 10MB
  /** Webhook endpoints (Lytex sends large payloads) */
  webhook: 2 * 1024 * 1024, // 2MB
  /** Auth endpoints (small payloads) */
  auth: 1024 * 16, // 16KB
  /** Health check (no body) */
  health: 0,
} as const

/**
 * Check if request body exceeds the limit for its route type.
 * Returns null if OK, or an error response if exceeded.
 */
export function checkBodySize(
  request: Request,
  routeType: keyof typeof BODY_SIZE_LIMITS = "default",
): { ok: true } | { ok: false; error: Response } {
  const limit = BODY_SIZE_LIMITS[routeType]
  if (limit === 0) return { ok: true }

  const contentLength = request.headers.get("content-length")
  if (contentLength && Number(contentLength) > limit) {
    return {
      ok: false,
      error: new Response(
        JSON.stringify({
          error: `Payload excede o limite de ${Math.round(limit / 1024)}KB`,
        }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        },
      ),
    }
  }

  return { ok: true }
}

// ── Connection Pool Config ────────────────────────────────────────────────

/**
 * Prisma connection pool configuration for production.
 *
 * Add to DATABASE_URL as query params:
 *   postgresql://...?connection_limit=20&pool_timeout=10
 *
 * Or set via environment variables.
 */
export const DB_POOL_CONFIG = {
  /** Max connections in the pool */
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 20,
  /** Timeout (seconds) waiting for a connection from the pool */
  poolTimeout: Number(process.env.DB_POOL_TIMEOUT) || 10,
  /** Max query execution time before Prisma logs a warning (ms) */
  slowQueryThreshold: Number(process.env.DB_SLOW_QUERY_MS) || 200,
} as const
