import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole, revokeUserSessions } from "@/lib/auth"
import { handleError, notFound } from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

// ADMIN: revoke the user's realtime sessions WITHOUT deactivating the
// account. Same mechanism as logout/deactivation (emitRealtime
// session:revoke → the mini-service force-closes the user's sockets) but
// the user stays active — useful before an admin deactivates an account
// to check who would be affected, or to force a re-login.
//
// This is the endpoint the admin UI "Revogar sessões" button calls
// (POST /api/admin/users/{id}/revoke-sessions). The user's session cookie
// stays valid; only the realtime sockets die (the client receives
// session:revoked, resets the socket singleton and does not rejoin).
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
