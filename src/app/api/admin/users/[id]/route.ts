export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole, invalidateUserCache } from "@/lib/auth"
import { badRequest, handleError, notFound, USER_PUBLIC_SELECT } from "@/lib/api-server"
import { z } from "zod"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

const ALLOWED_ROLES = ["CLIENT", "PROVIDER", "ADMIN"]

const adminUserUpdateSchema = z.object({
  verified: z.boolean().optional(),
  active: z.boolean().optional(),
  role: z.enum(["CLIENT", "PROVIDER", "ADMIN"]).optional(),
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
})

// ADMIN: update user (toggle verified/active, change role, basic profile fields)
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!user) throw notFound("Usuário não encontrado")

    const raw = (await request.json()) as unknown
    const body = adminUserUpdateSchema.parse(raw)

    const data: Record<string, unknown> = {}
    if (body.verified !== undefined) data.verified = body.verified
    if (body.active !== undefined) data.active = body.active
    if (body.role !== undefined) data.role = body.role
    if (body.name !== undefined) data.name = body.name
    if (body.email !== undefined) data.email = body.email.toLowerCase()
    if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl
    if (body.bio !== undefined) data.bio = body.bio
    if (body.city !== undefined) data.city = body.city
    if (body.state !== undefined) data.state = body.state

    const updated = await db.user.update({
      where: { id },
      data,
      select: USER_PUBLIC_SELECT,
    })
    await invalidateUserCache(id)
    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}

// ADMIN: delete user (cascade per schema)
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(_request, RATE_LIMITS.admin)
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!user) throw notFound("Usuário não encontrado")

    await db.user.update({ where: { id }, data: { deletedAt: new Date() } })
    await invalidateUserCache(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
