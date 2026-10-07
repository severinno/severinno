export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  PUBLIC_PROVIDER_SELECT,
  exactShape,
  forbidden,
  toPublicProvider,
  type PublicProviderPayload,
} from "@/lib/api-server"
import { haversineKm } from "@/lib/geo-server"

import { withRoute } from "@/lib/api-route"
import { toMoneyNumber } from "@/lib/money"

/**
 * ⚠️ NUNCA troque o `select` por `include`: descreve TERCEIROS para o cliente
 * logado, e `include` devolveria toda coluna escalar de User (cpfCnpj, email,
 * twoFactorSecret, URLs de KYC). Ver SENSITIVE_USER_FIELDS em @/lib/api-server.
 */
async function findFavoritesForClient(clientId: string) {
  return db.favorite.findMany({
    where: { clientId },
    take: 100,
    select: {
      provider: {
        select: {
          ...PUBLIC_PROVIDER_SELECT,
          services: {
            where: { active: true },
            select: { id: true, title: true, basePrice: true },
            take: 3,
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

/** ProviderCard (src/lib/api.ts) — allowlist + derivados. */
type FavoriteProviderBody = PublicProviderPayload & {
  // money_decimal: basePrice sai como number (fronteira toMoneyNumber),
  // não o Decimal cru da linha do Prisma
  services: Array<{ id: string; title: string; basePrice: number }>
  rating: number
  reviewCount: number
  distanceKm: number | null
}

// CLIENT: list favorited providers (with optional distance computation).
// Returns `ProviderCard[]` directly (UI: `apiGet<ProviderCard[]>("/api/favorites")`).
export const GET = withRoute("api.favorites.GET", async (request) => {
  const session = await requireUser()
  if (session.role !== "CLIENT") {
    throw forbidden("Apenas clientes têm favoritos")
  }
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get("lat")
  const lng = searchParams.get("lng")
  const latNum = lat ? Number(lat) : null
  const lngNum = lng ? Number(lng) : null
  const hasGeo =
    latNum !== null && lngNum !== null && Number.isFinite(latNum) && Number.isFinite(lngNum)

  const favorites = await findFavoritesForClient(session.userId)

  const providers = favorites.map((f) => {
    const rating = f.provider.avgRating ?? 0
    const reviewCount = f.provider.reviewCount ?? 0
    const distanceKm =
      hasGeo && f.provider.lat !== null && f.provider.lng !== null
        ? Math.round(haversineKm(latNum!, lngNum!, f.provider.lat, f.provider.lng) * 10) / 10
        : null
    // Duas barreiras com a mesma allowlist: o select acima não busca colunas
    // sensíveis e `toPublicProvider` descarta qualquer coisa fora dela. A
    // `exactShape` fecha a terceira: espalhar a linha larga não compila.
    const { services, ...providerScalars } = f.provider
    // money_decimal: basePrice é Decimal — converte na fronteira (number,
    // contrato JSON do frontend; cru serializaria string)
    const pricedServices = services.map((s) => ({ ...s, basePrice: toMoneyNumber(s.basePrice, 0) }))
    return exactShape<FavoriteProviderBody>()({
      ...toPublicProvider(providerScalars),
      services: pricedServices,
      rating: Math.round(rating * 10) / 10,
      reviewCount,
      distanceKm,
    })
  })

  return NextResponse.json(providers)
})
