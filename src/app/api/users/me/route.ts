import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { providerProfileSchema } from "@/lib/validators"
import { forbidden, handleError, USER_PUBLIC_SELECT, syncEntitySearch } from "@/lib/api-server"

// GET: current authenticated user (full public profile)
export async function GET() {
  try {
    const session = await requireUser()
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: USER_PUBLIC_SELECT,
    })
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    return NextResponse.json({ user })
  } catch (e) {
    return handleError(e)
  }
}

// PATCH: update current user's profile
export async function PATCH(request: Request) {
  try {
    const session = await requireUser()
    const body = await request.json()
    const data = providerProfileSchema.partial().parse(body)
    const { sanitizeText } = await import("@/lib/sanitize")

    const existing = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true },
    })
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // Providers can update their own profile; admins can update anyone
    if (existing.role === "PROVIDER" && session.userId !== existing.id) {
      throw forbidden("Providers can only update their own profile")
    }

    const updated = await db.user.update({
      where: { id: session.userId },
      data: {
        ...(data.name !== undefined ? { name: sanitizeText(data.name) } : {}),
        ...(data.whatsapp !== undefined ? { whatsapp: data.whatsapp } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.bio !== undefined ? { bio: data.bio ? sanitizeText(data.bio) : null } : {}),
        ...(data.lat !== undefined ? { lat: data.lat } : {}),
        ...(data.lng !== undefined ? { lng: data.lng } : {}),
        ...(data.cep !== undefined ? { cep: data.cep } : {}),
        ...(data.street !== undefined ? { street: data.street } : {}),
        ...(data.number !== undefined ? { number: data.number } : {}),
        ...(data.complement !== undefined ? { complement: data.complement } : {}),
        ...(data.district !== undefined ? { district: data.district } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.radiusKm !== undefined ? { radiusKm: data.radiusKm } : {}),
        ...(data.soundEnabled !== undefined ? { soundEnabled: data.soundEnabled } : {}),
        ...(data.vibrateEnabled !== undefined ? { vibrateEnabled: data.vibrateEnabled } : {}),
      },
      select: USER_PUBLIC_SELECT,
    })

    if (existing.role === "PROVIDER") {
      syncEntitySearch("provider", { id: updated.id }).catch(() => {})
    }

    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}
