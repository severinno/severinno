import { NextResponse } from "next/server"
import { getPayload } from "@/lib/push-store"
import { handleError } from "@/lib/api-server"
import logger from "@/lib/logger"

/**
 * GET /api/push/payload/:id
 *
 * Endpoint chamado pelo service worker (public/sw.js) quando recebe
 * um push signal (payload pequeno com _signal=true).
 * Retorna o payload completo (que pode ser > 4KB) armazenado no
 * push-store (Redis + in-memory fallback).
 *
 * O payload é deletado após a leitura (one-time access).
 * Expira automaticamente após 5 minutos se não for lido.
 *
 * Resposta:
 *   200 — { title, body, url, icon, badge, actions, data, ... }
 *   404 — { error: "Payload not found or expired" }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    logger.debug({ payloadId: id }, "push payload fetch requested")

    const payload = await getPayload(id)

    if (!payload) {
      return NextResponse.json({ error: "Payload não encontrado ou expirado" }, { status: 404 })
    }

    return NextResponse.json(payload)
  } catch (e) {
    logger.error({ err: e }, "push payload fetch failed")
    return handleError(e)
  }
}
