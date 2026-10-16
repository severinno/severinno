/**
 * pgbouncer-pool.ts — Governança e Otimização do Pool PgBouncer
 *
 * Configura e audita o uso do PgBouncer (porta 6432) em modo 'transaction pooling',
 * permitindo que centenas de requisições simultâneas compartilhem com segurança um pool
 * reduzido de conexões físicas no PostgreSQL, economizando RAM na VPS e evitando
 * estouro de `max_connections`.
 */

export interface PgBouncerConfigAudit {
  isConfigured: boolean
  port: number
  hasPgBouncerParam: boolean
  recommendedUrl: string
  poolingMode: "transaction" | "session"
  warnings: string[]
}

/**
 * Constrói a connection string compatível com o PgBouncer na porta 6432 com `pgbouncer=true`.
 */
export function buildPgBouncerDatabaseUrl(rawUrl: string, pgbouncerPort = 6432): string {
  if (!rawUrl) return ""

  try {
    const url = new URL(rawUrl)
    url.port = String(pgbouncerPort)

    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true")
    }
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "20")
    }

    return url.toString()
  } catch {
    // Se não for uma URL parseável por URL(), faz substituição por regex
    let modified = rawUrl.replace(/:5432\b/, `:${pgbouncerPort}`)
    if (!modified.includes("pgbouncer=true")) {
      const sep = modified.includes("?") ? "&" : "?"
      modified += `${sep}pgbouncer=true&connection_limit=20`
    }
    return modified
  }
}

/**
 * Audita a connection string do banco de dados para conformidade com o PgBouncer.
 */
export function auditDatabaseUrlForPgBouncer(databaseUrl: string): PgBouncerConfigAudit {
  const warnings: string[] = []

  if (!databaseUrl) {
    return {
      isConfigured: false,
      port: 0,
      hasPgBouncerParam: false,
      recommendedUrl: "",
      poolingMode: "session",
      warnings: ["DATABASE_URL não definida"],
    }
  }

  let port = 5432
  let hasPgBouncerParam = false

  try {
    const parsed = new URL(databaseUrl)
    port = parsed.port ? parseInt(parsed.port, 10) : 5432
    hasPgBouncerParam = parsed.searchParams.get("pgbouncer") === "true"
  } catch {
    const portMatch = databaseUrl.match(/:(\d+)\//)
    if (portMatch) port = parseInt(portMatch[1], 10)
    hasPgBouncerParam = databaseUrl.includes("pgbouncer=true")
  }

  if (port === 5432) {
    warnings.push("Conexão direta ao PostgreSQL (5432) em vez do pooler PgBouncer (6432).")
  }
  if (!hasPgBouncerParam) {
    warnings.push("Parâmetro 'pgbouncer=true' ausente na URL do Prisma.")
  }

  const isConfigured = port === 6432 && hasPgBouncerParam
  const recommendedUrl = buildPgBouncerDatabaseUrl(databaseUrl)

  return {
    isConfigured,
    port,
    hasPgBouncerParam,
    recommendedUrl,
    poolingMode: "transaction",
    warnings,
  }
}

/**
 * Verifica se um comando SQL é seguro para execução em modo Transaction Pooling do PgBouncer.
 * Comandos como LISTEN, PREPARE ou manipulação de sessão exigem DIRECT_URL.
 */
export function isQueryTransactionPoolingSafe(sqlQuery: string): {
  isSafe: boolean
  requiresDirectUrl: boolean
  reason?: string
} {
  const normalized = sqlQuery.trim().toUpperCase()

  if (normalized.startsWith("LISTEN") || normalized.startsWith("NOTIFY")) {
    return {
      isSafe: false,
      requiresDirectUrl: true,
      reason: "LISTEN/NOTIFY não é suportado em PgBouncer transaction pooling",
    }
  }

  if (normalized.includes("SET SESSION") || normalized.includes("DISCARD ALL")) {
    return {
      isSafe: false,
      requiresDirectUrl: true,
      reason: "SET SESSION vaza estado entre transações no PgBouncer",
    }
  }

  return {
    isSafe: true,
    requiresDirectUrl: false,
  }
}
