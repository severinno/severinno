export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo-server"
import {
  PUBLIC_PROVIDER_SELECT,
  cacheControlPrivate,
  exactShape,
  handleError,
  notFound,
  toPublicProvider,
  type PublicProviderPayload,
} from "@/lib/api-server"
import { getOptionalSession } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

/**
 * Busca do detalhe público. O `select` ABAIXO é a fonte do tipo da resposta
 * (via `ProviderDetailRow`), então trocá-lo por `include` deixa de ser um bug
 * silencioso: o corpo dobra de largura e passa a não compilar na `exactShape`.
 *
 * ⚠️ NUNCA troque por `include`: ele devolve TODA coluna escalar de User
 * (cpfCnpj, email, twoFactorSecret, URLs de KYC) e esta rota é pública.
 */
async function findProviderForDetail(id: string) {
  return db.user.findFirst({
    where: { id, role: "PROVIDER" },
    select: {
      ...PUBLIC_PROVIDER_SELECT,
      services: {
        where: { active: true },
        include: { category: true },
        orderBy: { createdAt: "desc" },
      },
      availability: {
        where: { active: true },
        orderBy: { dayOfWeek: "asc" },
      },
      reviewsReceived: {
        take: 20,
        orderBy: { createdAt: "desc" },
        // A avaliação em si é pública, mas nem tudo dela: `providerRating` e
        // `providerComment` são a avaliação que o PRESTADOR faz do CLIENTE —
        // a opinião de um terceiro sobre outra pessoa, exposta aqui para
        // qualquer visitante anônimo. Nenhum componente consome esses campos
        // neste payload (o tipo público `ProviderReview` não os declara); se o
        // cliente precisar ver "como os prestadores te avaliam", isso pertence
        // à rota autenticada dele. O mesmo vale para ids internos
        // (`bookingId`/`clientId`/`serviceId`), que só ampliam a superfície
        // de enumeração de recursos de terceiros.
        select: {
          id: true,
          rating: true,
          comment: true,
          photos: true,
          providerReply: true,
          providerReplyAt: true,
          createdAt: true,
          client: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      },
      // Use denormalized counts instead of _count to avoid extra subqueries
    },
  })
}

type ProviderDetailRow = NonNullable<Awaited<ReturnType<typeof findProviderForDetail>>>
type ProviderReviewRow = ProviderDetailRow["reviewsReceived"][number]

/** Revisão no shape da UI: `client` é aliasado para `author`. */
type ProviderReviewPublic = Omit<ProviderReviewRow, "client"> & {
  author: ProviderReviewRow["client"]
}

/**
 * Corpo do `ProviderDetail` (src/lib/api.ts) — allowlist + derivações.
 * Ancorado em `PublicProviderPayload`: acrescentar campo que descreva o usuário
 * fora da allowlist não compila na `exactShape` abaixo.
 */
type ProviderDetailBody = PublicProviderPayload & {
  services: ProviderDetailRow["services"]
  availability: ProviderDetailRow["availability"]
  reviews: ProviderReviewPublic[]
  rating: number
  reviewCount: number
  favoriteCount: number
  distanceKm: number | null
  favorited: boolean
}

/**
 * Public provider detail: profile, services, availability (ordered),
 * recent reviews (with client name/avatar), favoriteCount.
 * If logged-in client, include `favorited` flag.
 */
export async function GET(request: Request, { params }: Params) {
  await assertRateLimit(request, RATE_LIMITS.providers)
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get("lat")
    const lng = searchParams.get("lng")

    const provider = await findProviderForDetail(id)
    if (!provider) throw notFound("Prestador não encontrado")

    const session = await getOptionalSession()
    let favorited = false
    if (session && session.role === "CLIENT") {
      const fav = await db.favorite.findUnique({
        where: {
          clientId_providerId: { clientId: session.userId, providerId: id },
        },
        select: { id: true },
      })
      favorited = Boolean(fav)
    }

    // Use denormalized avgRating + reviewCount (already computed via trigger)
    const rating = provider.avgRating
    const reviewCount = provider.reviewCount
    const favoriteCount = provider.favoriteCount

    const latNum = lat ? Number(lat) : null
    const lngNum = lng ? Number(lng) : null
    const distanceKm =
      latNum !== null &&
      lngNum !== null &&
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum) &&
      provider.lat !== null &&
      provider.lng !== null
        ? Math.round(haversineKm(latNum, lngNum, provider.lat, provider.lng) * 10) / 10
        : null

    const {
      avgRating: _r,
      reviewCount: _rc,
      favoriteCount: _fc,
      reviewsReceived,
      services,
      availability,
      ...scalars
    } = provider

    // Map reviews to the UI's `ProviderReview` shape: each review has an
    // `author: { id, name, avatarUrl }` field (alias for `client`).
    const reviews = reviewsReceived.map((r) => {
      const { client, ...rest } = r
      return { ...rest, author: client }
    })

    // Return the provider object directly (the typed fetch wrapper expects
    // a `ProviderDetail`, not `{ provider: ProviderDetail }`).
    //
    // `exactShape` é a trava de compilação: espalhar aqui qualquer coisa que
    // carregue campo fora da allowlist (ex.: `...provider` vindo de um `include`)
    // deixa de compilar — o TypeScript não barra isso sozinho, só barra o que
    // passa por aqui. `toPublicProvider` é a barreira de runtime equivalente.
    const body = exactShape<ProviderDetailBody>()({
      ...toPublicProvider(scalars),
      services,
      availability,
      reviews,
      rating: Math.round(rating * 10) / 10,
      reviewCount,
      favoriteCount,
      distanceKm,
      favorited,
    })

    return cacheControlPrivate(NextResponse.json(body), 60)
  } catch (e) {
    return handleError(e)
  }
}
