export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { checkRedisMemoryGuard } from "@/lib/redis-memory-guard"

/**
 * GET /api/admin/system/redis-health
 *
 * Retorna diagnóstico de memória e sentinela de chaves do Redis:
 * - Uso de memória (used, peak, maxmemory)
 * - Política de descarte (allkeys-lru, etc.) e ratio de fragmentação
 * - Contagem de chaves despejadas (evicted_keys)
 * - Amostragem via SCAN de chaves sem TTL e risco em allkeys-lru
 * - Recomendações de infraestrutura
 *
 * Requer permissão ADMIN.
 */
export const GET = withRoute("api.admin.system.redis-health.GET", async (_request) => {
  await requireRole("ADMIN")

  const report = await checkRedisMemoryGuard()

  return NextResponse.json(report)
})
