import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { getSession, requireRole } from "@/lib/auth"
import { purgeStalePendingIdentities } from "@/lib/identity-retention"

/**
 * POST /api/admin/identity/purge — o gatilho MANUAL do ato 2 da retenção
 * (pendências de KYC: quem enviou há mais de N dias e nunca recebeu decisão).
 *
 * Pendências expiradas: biometria removida do MinIO, URLs nuladas, status
 * vira `rejected` com motivo gravado no Redis (a reenvio é um clique).
 * Idempotente: uma segunda rodada devolve `purged: 0` e nada muda.
 * Segmento do cron de drift de segurança (docs/SECURITY.md § LGPD).
 */

export const POST = withRoute("api.admin.identity.purge.POST", async () => {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  // O guard de papel da plataforma (com requireUser de bônus).
  await requireRole("ADMIN")

  const { purged } = await purgeStalePendingIdentities(30)
  return NextResponse.json({
    ok: true,
    purged,
    política: "retenção LGPD — pendências expiradas perdem a biometria e viram rejected",
  })
})
