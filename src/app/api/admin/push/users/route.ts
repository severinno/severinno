export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/admin/push/users
 *
 * Lista usuarios com inscricoes push ativas, com paginacao e busca opcional.
 * Usado pelo dashboard admin para selecionar destinatarios de push manual.
 *
 * Query params:
 *   q         — busca por nome/email
 *   role      — filtrar por role (CLIENT|PROVIDER|ADMIN)
 *   page      — numero da pagina (default: 1)
 *   limit     — itens por pagina (default: 20, max: 100)
 */
export const GET = withRoute("api.admin.push.users.GET", async (request) => {
  await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim() || undefined
  const role = searchParams.get("role") || undefined
  const { page, limit, skip, take } = parsePagination(searchParams)

  // Construir filtro: apenas usuarios com push subscriptions ativas
  const where: Record<string, unknown> = {
    pushSubscriptions: { some: {} },
    ...(role ? { role } : {}),
    ...(q
      ? {
          OR: [{ name: { contains: q } }, { email: { contains: q } }],
        }
      : {}),
  }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        city: true,
        state: true,
        _count: { select: { pushSubscriptions: true } },
      },
      orderBy: { name: "asc" },
      skip,
      take,
    }),
    db.user.count({ where }),
  ])

  // Total de inscricoes ativas (para estatistica)
  const totalSubscriptions = await db.pushSubscription.count()

  return NextResponse.json({
    items: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatarUrl,
      city: u.city,
      state: u.state,
      subscriptionsCount: u._count.pushSubscriptions,
    })),
    total,
    page,
    limit,
    totalSubscriptions,
  })
})
