export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { forbidden } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import {
  applyOfflineEvidenceBatch,
  offlineEvidenceBatchSchema,
  type OfflineSyncBatchResult,
} from "@/lib/offline-evidence-sync"

/**
 * POST /api/sync/offline-batch
 *
 * Sincroniza o lote de evidências que o prestador acumulou no PWA sem sinal
 * (check-in, fotos antes/depois, assinatura). Grava em `OfflineEvidence` com
 * idempotência por `externalId`.
 *
 * Contrato de resposta (consumido por `useOfflineSync`):
 *   { processed, succeeded, failed, remainingPending, syncedIds, errors[] }
 *
 * Antes: a rota devolvia `{ success, processed, synced }` sem persistir nada.
 * O hook lia `syncedIds` (inexistente) e a fila local nunca era limpa — o
 * prestador perdia a prova de campo sem mensagem de erro.
 *
 * Requer sessão de PROVIDER (ou ADMIN). O `providerId` NUNCA vem do body.
 */
export const POST = withRoute("api.sync.offline-batch.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    throw forbidden("Apenas prestadores podem sincronizar evidências offline")
  }

  const body = await request.json()
  // ZodError → 400 pelo withRoute (handleError).
  const { items } = offlineEvidenceBatchSchema.parse(body)

  const result: OfflineSyncBatchResult = await applyOfflineEvidenceBatch({
    providerId: session.userId,
    items,
  })

  return NextResponse.json(result)
})
