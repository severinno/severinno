export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { providerProfileSchema } from "@/lib/validators"
import { forbidden, USER_FULL_SELECT, USER_PUBLIC_SELECT, syncEntitySearch } from "@/lib/api-server"
import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"

// GET: current authenticated user (full public profile)
export const GET = withRoute("api.users.me.GET", async (_request) => {
  const session = await requireUser()
  const user = await db.user.findUnique({
    where: { id: session.userId },
    // Perfil PRÓPRIO: USER_FULL_SELECT traz o endereço completo (rua, número,
    // bairro, complemento, cidade/estado — o form de perfil hidrata dele) e as
    // preferências de UI (som/vibração). É superconjunto do select público e
    // só sai para o dono da sessão.
    select: { ...USER_FULL_SELECT },
  })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
  return NextResponse.json({ user })
})

// PATCH: update current user's profile
export const PATCH = withRoute("api.users.me.PATCH", async (request) => {
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
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl || null } : {}),
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
      ...(data.gpsAccuracyM !== undefined ? { gpsAccuracyM: data.gpsAccuracyM } : {}),
      ...(data.soundEnabled !== undefined ? { soundEnabled: data.soundEnabled } : {}),
      ...(data.vibrateEnabled !== undefined ? { vibrateEnabled: data.vibrateEnabled } : {}),
    },
    select: {
      ...USER_PUBLIC_SELECT,
      city: true,
      state: true,
      soundEnabled: true,
      vibrateEnabled: true,
    },
  })

  if (existing.role === "PROVIDER") {
    syncEntitySearch("provider", { id: updated.id }).catch((err) =>
      logger.warn({ err }, "provider search reindex failed"),
    )
  }

  return NextResponse.json({ user: updated })
})
