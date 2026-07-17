import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import {
  badRequest,
  handleError,
  notFound,
  USER_PUBLIC_SELECT,
} from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

const ALLOWED_ROLES = ["CLIENT", "PROVIDER", "ADMIN"]

// ADMIN: update user (toggle verified/active, change role, basic profile fields)
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!user) throw notFound("Usuário não encontrado")

    const body = await request.json()

    if (body.role !== undefined && !ALLOWED_ROLES.includes(body.role)) {
      throw badRequest("Role inválido")
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(body.verified !== undefined ? { verified: Boolean(body.verified) } : {}),
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.email !== undefined
          ? { email: String(body.email).toLowerCase() }
          : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.verified !== undefined && body.verified === true
          ? { verified: true }
          : {}),
      },
      select: USER_PUBLIC_SELECT,
    })
    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}

// ADMIN: delete user (cascade per schema)
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!user) throw notFound("Usuário não encontrado")

    await db.user.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
