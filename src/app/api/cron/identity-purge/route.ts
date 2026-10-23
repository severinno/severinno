export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/cron/identity-purge — o gatilho DIÁRIO do ato 2 da retenção LGPD
 * (pendências de KYC: quem enviou há mais de 30 dias e nunca recebeu decisão).
 *
 * Chama `purgeStalePendingIdentities(30)` (src/lib/identity-retention.ts):
 * pendências expiradas perdem a biometria do MinIO, têm as URLs nuladas e
 * viram `rejected` com motivo gravado no Redis (reenvio é um clique).
 * Idempotente: uma segunda rodada no mesmo dia devolve `purged: 0` — o
 * estado saudável do cron diário é purged baixo ou zero, não erro.
 *
 * Segmento do cron de drift de segurança (docs/SECURITY.md § 14). O gatilho
 * MANUAL (com sessão ADMIN) é `POST /api/admin/identity/purge`; este endpoint
 * existe para o cron do host, que não tem cookie de sessão.
 *
 * Autenticação: CRON_SECRET fail-closed (Bearer; sem query param — evita
 * vazamento em logs), igual aos demais crons.
 *
 * Agendamento: diário, 03:15 (depois do settlements 03:00, antes do censo
 * semanal de domingo 03:30) — scripts/setup-cron-push.sh.
 *
 * Imports lazy: o módulo de retenção puxa o Prisma/@aws-sdk — carregar só
 * na execução autorizada (mesma razão do lazy import do svg-legacy-census).
 *
 * Response:
 *   200: { ok, purged, política }
 *   401: sem/inválido CRON_SECRET
 *
 * Uso manual (VPS, credenciais locais):
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     https://severinno.com.br/api/cron/identity-purge | jq
 */

import { NextResponse } from "next/server"
import logger from "@/lib/logger"

export const GET = async (request: Request) => {
  const auth = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  // Fail-closed: sem CRON_SECRET configurado ou sem Bearer válido → 401.
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { purgeStalePendingIdentities } = await import("@/lib/identity-retention")
  const { purged } = await purgeStalePendingIdentities(30)

  logger.info({ purged }, "cron lgpd: varredura diária de retenção concluída")
  return NextResponse.json({
    ok: true,
    purged,
    política: "retenção LGPD — pendências expiradas perdem a biometria e viram rejected",
  })
}
