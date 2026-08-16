import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole, invalidateUserCache, revokeUserSessions } from "@/lib/auth"
import { badRequest, handleError, notFound, USER_PUBLIC_SELECT } from "@/lib/api-server"

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
        ...(body.email !== undefined ? { email: String(body.email).toLowerCase() } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.verified !== undefined && body.verified === true ? { verified: true } : {}),
      },
      select: USER_PUBLIC_SELECT,
    })
    await invalidateUserCache(id)
    // Desativação imediata: além de invalidar o cache (bloqueia novas requests),
    // revoga os sockets realtime AGORA — o usuário não fica conectado até o
    // próximo logout. O check espelha a coerção do write (Boolean(body.active)):
    // qualquer payload que o DB trate como desativação (false, 0, null) revoga.
    if (body.active !== undefined && Boolean(body.active) === false) {
      await revokeUserSessions(id)
    }
    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}

// ADMIN: revoke the user's realtime sessions WITHOUT deactivating the
// account. Same mechanism as logout/deactivation (emitRealtime
// session:revoke → the mini-service force-closes the user's sockets) but
// the user stays active — useful before an admin deactivates an account
// to check who would be affected, or to force a re-login.
export async function POST(_request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!user) throw notFound("Usuário não encontrado")

    await revokeUserSessions(id)
    return NextResponse.json({ ok: true, revoked: true })
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

    await db.user.update({ where: { id }, data: { deletedAt: new Date() } })
    await invalidateUserCache(id)
    // Usuário deletado também é desconectado dos sockets imediatamente.
    await revokeUserSessions(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
