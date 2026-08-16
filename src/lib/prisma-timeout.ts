/**
 * Prisma connection-string timeouts (classic engine).
 *
 * Prisma 6.x REMOVEU `query_timeout` / `connection_limit` das options do
 * construtor do PrismaClient (verificado no PrismaClientOptions gerado).
 * O mecanismo suportado para limitar o cliente de dados é via parâmetros na
 * connection string (PostgreSQL provider, engine clássico):
 *
 *   - `connection_limit`  — tamanho do pool de conexões (default: cores*2+1)
 *   - `connect_timeout`   — segundos para estabelecer a conexão (engine: 5; aqui: 10)
 *   - `pool_timeout`      — segundos para obter conexão do pool (default 10)
 *   - `statement_timeout` — ms por query — DEFAULT 0 = DESABILITADO: sem ele,
 *     um Postgres que aceita o TCP mas trava a query pendura o request
 *     INDEFINIDAMENTE (o gap que este módulo fecha).
 *
 * O helper monta uma URL de datasource com esses params aplicados (sem
 * duplicar os que já existem), para uso no construtor via `datasourceUrl` —
 * garante o limite independente de como o DATABASE_URL está configurado
 * (.env / compose).
 */

import { resolveTimeoutMs } from "./fetch-timeout"

export const PRISMA_CONNECTION_DEFAULTS = {
  connectionLimit: 10,
  connectTimeoutSec: 10,
  poolTimeoutSec: 10,
  statementTimeoutMs: 10_000,
} as const

/**
 * Retorna a connection string com os parâmetros de timeout/limite aplicados
 * (apenas os ausentes — nunca sobrescreve configuração explícita).
 * Guarda de valores inválidos reutiliza o resolveTimeoutMs de fetch-timeout
 * (NaN/vazio/0 → fallback; negativo → clamp 1).
 */
export function buildPrismaDatasourceUrl(rawUrl: string): string {
  const [base, existingQuery = ""] = rawUrl.split("?")
  const params = new URLSearchParams(existingQuery)

  const setIfMissing = (key: string, value: string) => {
    if (!params.has(key)) params.set(key, value)
  }

  setIfMissing(
    "connection_limit",
    String(resolveTimeoutMs("PRISMA_CONNECTION_LIMIT", PRISMA_CONNECTION_DEFAULTS.connectionLimit)),
  )
  setIfMissing(
    "connect_timeout",
    String(
      resolveTimeoutMs("PRISMA_CONNECT_TIMEOUT_SEC", PRISMA_CONNECTION_DEFAULTS.connectTimeoutSec),
    ),
  )
  setIfMissing(
    "pool_timeout",
    String(resolveTimeoutMs("PRISMA_POOL_TIMEOUT_SEC", PRISMA_CONNECTION_DEFAULTS.poolTimeoutSec)),
  )
  setIfMissing(
    "statement_timeout",
    String(
      resolveTimeoutMs(
        "PRISMA_STATEMENT_TIMEOUT_MS",
        PRISMA_CONNECTION_DEFAULTS.statementTimeoutMs,
      ),
    ),
  )

  const query = params.toString()
  return query ? `${base}?${query}` : base
}
