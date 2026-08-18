import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export type ComparedQuote = {
  id: string
  status: string
  createdAt: string
  expiresAt: string
  total: number
  itemsCount: number
  provider: {
    id: string
    name: string
    avatarUrl?: string | null
    verified: boolean
    avgRating: number
    reviewCount: number
    whatsapp?: string | null
  }
  items: Array<{
    id: string
    serviceTitle: string
    quantity: number
    unit: string
    price: number | null
    status: string
  }>
  score: number
  isBestValue: boolean
}

/**
 * GET /api/quotes/compare?ids=id1,id2,id3
 * Compare up to 3 quote requests side-by-side.
 */
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.quotes)
    const session = await requireUser()
    const { searchParams } = new URL(request.url)
    const idsParam = searchParams.get("ids")

    if (!idsParam) {
      throw badRequest("Parâmetro 'ids' é obrigatório (ex: ?ids=id1,id2,id3)")
    }

    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
    if (ids.length < 2) {
      throw badRequest("Selecione pelo menos 2 orçamentos para comparar")
    }

    const quotes = await db.quoteRequest.findMany({
      where: { id: { in: ids } },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            verified: true,
            avgRating: true,
            reviewCount: true,
            whatsapp: true,
          },
        },
        client: { select: { id: true, name: true } },
        items: {
          include: {
            service: { select: { title: true, unit: true } },
          },
        },
      },
    })

    // Authorization: User must be client on all requested quotes, or ADMIN
    for (const q of quotes) {
      if (q.clientId !== session.userId && session.role !== "ADMIN") {
        throw forbidden("Você não tem acesso a todos os orçamentos solicitados")
      }
    }

    // Transform and calculate scores
    const compared: ComparedQuote[] = quotes.map((q) => {
      const total = q.items.reduce((acc, item) => acc + (item.price ?? 0) * item.quantity, 0)
      const rating = q.provider.avgRating || 4.0
      // Score algorithm: rating weight (40%) + price competitiveness (60%)
      const priceFactor = total > 0 ? 1000 / total : 1
      const rawScore = rating * 10 + priceFactor * 20

      return {
        id: q.id,
        status: q.status,
        createdAt: q.createdAt.toISOString(),
        expiresAt: q.expiresAt.toISOString(),
        total: Math.round(total * 100) / 100,
        itemsCount: q.items.length,
        provider: {
          id: q.provider.id,
          name: q.provider.name,
          avatarUrl: q.provider.avatarUrl,
          verified: q.provider.verified,
          avgRating: q.provider.avgRating,
          reviewCount: q.provider.reviewCount,
          whatsapp: q.provider.whatsapp,
        },
        items: q.items.map((it) => ({
          id: it.id,
          serviceTitle: it.service.title,
          quantity: it.quantity,
          unit: it.unit,
          price: it.price,
          status: it.status,
        })),
        score: Math.round(rawScore * 10) / 10,
        isBestValue: false,
      }
    })

    // Determine best value
    if (compared.length > 0) {
      let maxScoreIdx = 0
      for (let i = 1; i < compared.length; i++) {
        if (compared[i].score > compared[maxScoreIdx].score) {
          maxScoreIdx = i
        }
      }
      compared[maxScoreIdx].isBestValue = true
    }

    return NextResponse.json({ quotes: compared })
  } catch (e) {
    return handleError(e)
  }
}
