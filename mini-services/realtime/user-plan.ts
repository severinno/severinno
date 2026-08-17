/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: user plan loader
 *
 * Lê o PLANO/tenant do usuário (coluna `plan` da tabela "User": FREE |
 * PREMIUM, default FREE) no JOIN, para que o limite de sessões simultâneas
 * possa ser configurado por plano (REALTIME_MAX_SESSIONS_PER_PLAN) com
 * fallback ao per-role atual.
 *
 * O DB pool é DUCK-TYPED (`PoolLike`) e injetado — o realtime service wiring
 * o lazy pg pool loader em index.ts, enquanto os unit tests injetam um pool
 * fake. Este módulo nunca importa `pg` (keeps it typecheckable sem @types/pg
 * e testable in isolation). Fail-open: pool ausente, query com erro OU
 * coluna `plan` inexistente (banco que ainda não recebeu a migration) →
 * devolve null — o caller cai no per-role atual, nunca quebra o join.
 */

import type { PoolLike, PoolLoader } from "./booking-participant"

/**
 * Plano do usuário — tabela "User" (Prisma model sem @@map). `deletedAt IS
 * NULL` exclui contas soft-deletadas (mesmo critério do revoke-orphans).
 */
export const USER_PLAN_SQL = `
  SELECT "plan" FROM "User"
  WHERE id = $1 AND "deletedAt" IS NULL
  LIMIT 1
`

/**
 * Cria o resolver `(userId) => Promise<string | null>` do plano do usuário,
 * backed pelo pool loader injetado. Fail-open: sem pool / erro de query /
 * coluna ausente → null (o limite cai no per-role atual — o plano só vence
 * quando o env per-plan tem override E o banco conseguiu informar o plano).
 */
export function createUserPlanLoader(
  loadPool: PoolLoader,
): (userId: string) => Promise<string | null> {
  return async (userId) => {
    let pool: PoolLike | null = null
    try {
      pool = await loadPool()
    } catch {
      pool = null
    }
    if (!pool) return null // fail-open: sem DB não dá para saber o plano

    try {
      const res = await pool.query(USER_PLAN_SQL, [userId])
      const plan = res.rows?.[0]?.plan
      return typeof plan === "string" && plan.trim() ? plan.trim() : null
    } catch {
      return null // fail-open: coluna inexistente (pré-migration) → per-role
    }
  }
}
