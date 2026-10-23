export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { createSocketTicket } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"

/**
 * POST /api/realtime/ticket
 *
 * Ticket de socket SINGLE-USE para o handshake do realtime. A identidade
 * (userId/role) que o mini-service estampa no socket vem da SESSÃO do app
 * (cookie HMAC + sessionVersion no banco) — NUNCA do corpo do request. Este
 * endpoint fecha a lacuna do join auto-declarado (qualquer socket podia
 * entrar em user:{id} de terceiros).
 *
 * O ticket vive 60s no Redis (TTL) e é consumido com GETDEL no handshake —
 * single-use: replay não funciona. O papel NÃO vai na URL: o endpoint emite
 * pelo role REAL da sessão (um endpoint só, zero superfície de spoofing).
 * Rate limit de auth + fingerprint progressivo: emissão de credencial é
 * operação sensível.
 */
export const POST = withRoute("api.realtime.ticket.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.login)
  const result = await createSocketTicket()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 })
  }
  return NextResponse.json(result)
})
