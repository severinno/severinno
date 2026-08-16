import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getOptionalSession } from "@/lib/auth"
import { handleError, USER_PUBLIC_SELECT } from "@/lib/api-server"

export async function GET() {
  try {
    const session = await getOptionalSession()
    if (!session) {
      return NextResponse.json({ user: null, expiresAt: null })
    }
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: USER_PUBLIC_SELECT,
    })
    if (!user) {
      return NextResponse.json({ user: null, expiresAt: null })
    }
    // expiresAt = expiry EFETIVO do cookie (unix seconds) — o client mostra
    // "sua sessão expira em X dias" no dashboard e renova proativamente
    // (qualquer request já reemite o cookie na janela <15d).
    return NextResponse.json({ user, expiresAt: session.expiresAt ?? null })
  } catch (e) {
    return handleError(e)
  }
}
