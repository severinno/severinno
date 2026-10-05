import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { getSession } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/users/me/data-export — LGPD art. 18 (II): portabilidade.
 *
 * Os dados do PRÓPRIO titular, por allowlist EXPLÍCITA de campos — o guard de
 * PII reprova o idioma "spread menos passwordHash", e a portabilidade não
 * precisa de segredos: `passwordHash`, `sessionVersion`, `twoFactor*` e
 * `lytexRecipientId` não entram (o que entra é o dado que o titular forneceu
 * e o que a plataforma derivou sobre ele).
 *
 * Resposta: attachment JSON (download direto), `Cache-Control: no-store`.
 */

export const GET = withRoute("api.users.me.data-export.GET", async () => {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
  const userId = session.userId

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      cpfCnpj: true,
      whatsapp: true,
      phone: true,
      bio: true,
      avatarUrl: true,
      cep: true,
      street: true,
      number: true,
      complement: true,
      district: true,
      city: true,
      cityId: true,
      state: true,
      lat: true,
      lng: true,
      radiusKm: true,
      gpsAccuracyM: true,
      verified: true,
      active: true,
      soundEnabled: true,
      vibrateEnabled: true,
      createdAt: true,
      updatedAt: true,
      // KYC: o ESTADO é do titular; as URLs dos artefatos não (já podem ter
      // sido removidas pela retenção — e a biometria não viaja em export).
      identityStatus: true,
      identityVerifiedAt: true,
    },
  })
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  // Agregados do titular, com cap — a exportação não é consulta analítica.
  const bookings = await db.booking.findMany({
    where: { OR: [{ clientId: userId }, { providerId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      serviceId: true,
      scheduledAt: true,
      status: true,
      address: true,
      cep: true,
      amount: true,
      paymentMethod: true,
      paymentStatus: true,
      notes: true,
      clientId: true,
      providerId: true,
    },
  })

  const reviews = await db.review.findMany({
    where: { OR: [{ clientId: userId }, { providerId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      bookingId: true,
      rating: true,
      comment: true,
      providerRating: true,
      providerComment: true,
      createdAt: true,
      clientId: true,
      providerId: true,
    },
  })

  const favorites = await db.favorite.findMany({
    where: { clientId: userId },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, providerId: true, createdAt: true },
  })

  const payload = {
    geradoEm: new Date().toISOString(),
    base: "Severinno — exportação de dados pessoais (LGPD art. 18, II)",
    usuario: { ...user, papelEmCadaBooking: undefined },
    bookings: bookings.map((b) => ({
      ...b,
      papel: b.clientId === userId ? "cliente" : "prestador",
    })),
    reviews: reviews.map((r) => ({
      ...r,
      papel: r.clientId === userId ? "autor" : "recebida",
    })),
    favorites,
    observacoes:
      "Campos de autenticação (hash de senha, 2FA, versão de sessão) e identificadores de pagamento de terceiros não são exportados. Artefatos de biometria do KYC não viajam por este arquivo — a política de retenção os remove na decisão (ver docs/SECURITY.md).",
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="severinno-dados-${userId}.json"`,
      "Cache-Control": "no-store",
    },
  })
})
