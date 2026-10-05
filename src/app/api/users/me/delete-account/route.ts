import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withRoute } from "@/lib/api-route"
import { getSession, invalidateSessionCache, requireUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { deleteIdentityArtifacts } from "@/lib/identity-retention"

/**
 * POST /api/users/me/delete-account — LGPD art. 18 (VI): exclusão.
 *
 * A exclusão é SOFT e reversível em janela curta, com anonimização IMEDIATA
 * dos atributos de identificação — o titular sai da plataforma no ato:
 *
 *   - email/cpf/telefone/whatsapp/endereço/bio ganham placeholder
 *     determinístico (`anon+<cuid10>@deleted.severinno`) — não reidentifica
 *     (LGPD art. 16, anonimização) e não colide (email é @unique);
 *   - `deletedAt` marcado, `active` false, `sessionVersion` BUMPADA — a
 *     sessão atual e todas as outras morrem no próximo request
 *     (getSession confere a versão contra o banco);
 *   - biometria do KYC removida do MinIO + URLs nuladas (retenção);
 *   - o conteúdo com efeito de TERCEIROS (bookings, reviews, mensagens,
 *     transações) é PRESERVADO — integridade de registros financeiros e de
 *     histórico que pertencem também ao outro lado da relação;
 *   - cookie de sessão apagado na resposta.
 *
 * O body pede `confirm: "EXCLUIR MINHA CONTA"` — exclusão não é clique.
 */

export const POST = withRoute("api.users.me.delete-account.POST", async (request) => {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  const userId = session.userId

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const confirm = (body as { confirm?: string } | null)?.confirm
  if (confirm !== "EXCLUIR MINHA CONTA") {
    return NextResponse.json(
      {
        error:
          'Confirmação obrigatória: envie { "confirm": "EXCLUIR MINHA CONTA" } — esta ação marca a conta para exclusão e encerra todas as sessões.',
      },
      { status: 400 },
    )
  }

  // requireUser também cobre (revalida active no banco com cache próprio).
  await requireUser()

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  // ADMIN não exclui a própria conta por este caminho — é operador da
  // plataforma; a remoção de operador é procedimento fora do produto.
  if (user.role === "ADMIN") {
    return NextResponse.json(
      { error: "Conta de administrador não pode ser excluída por este endpoint." },
      { status: 403 },
    )
  }

  // Biometria primeiro (MinIO + URLs), depois a anonimização.
  await deleteIdentityArtifacts(userId)

  const anonEmail = `anon+${userId.slice(-10)}@deleted.severinno`
  await db.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      active: false,
      verified: false,
      // sessão atual + todas as outras morrem (getSession compara com o banco)
      sessionVersion: { increment: 1 },
      // anonimização determinística, sem reidentificação e sem colisão
      email: anonEmail,
      name: "Usuário removido",
      cpfCnpj: null,
      whatsapp: null,
      phone: null,
      bio: null,
      avatarUrl: null,
      coverUrl: null,
      cep: null,
      street: null,
      number: null,
      complement: null,
      district: null,
      city: null,
      cityId: null,
      state: null,
      lat: null,
      lng: null,
      radiusKm: null,
      gpsAccuracyM: null,
      servicePolygon: Prisma.JsonNull,
      travelFeePolicy: Prisma.JsonNull,
      // 2FA morre com a conta
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    },
  })

  // As caches de auth morrem: active (requireUser) e sessionVersion (getSession).
  await invalidateSessionCache(userId)
  const { invalidateUserCache } = await import("@/lib/auth")
  await invalidateUserCache(userId)

  // O cookie da sessão atual sai da resposta.
  const { destroySession } = await import("@/lib/auth")
  await destroySession()

  return NextResponse.json({
    ok: true,
    mensagem:
      "Conta marcada para exclusão, dados de identificação anonimizados e todas as sessões encerradas. Histórico com efeito sobre terceiros (reservas, avaliações, mensagens) é preservado por integridade dos registros.",
  })
})
