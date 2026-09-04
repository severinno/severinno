export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword } from "@/lib/crypto"
import { createSession } from "@/lib/auth"
import { registerSchema } from "@/lib/validators"
import { parseBody } from "@/lib/api-middleware"
import { handleError, conflict } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { fireEvent } from "@/lib/event-hub"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.register)
    const data = await parseBody(request, registerSchema)

    // 🛡️ Emails demo são reservados (dev/staging only). Em produção, impedir
    // que alguém registre uma conta com email demo (ex.: sequestrar
    // admin@severinno.com como CLIENT para phishing ou confusão).
    if (!isDemoAccountsEnabled() && isDemoAccountEmail(data.email)) {
      throw conflict("E-mail já cadastrado")
    }

    // Email must be unique
    const existing = await db.user.findUnique({
      where: { email: data.email.toLowerCase() },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 })
    }

    const passwordHash = hashPassword(data.password)
    const isProvider = data.role === "PROVIDER"

    const user = await db.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name,
        role: data.role,
        cpfCnpj: data.cpfCnpj || null,
        whatsapp: data.whatsapp || null,
        phone: data.phone || null,
        cep: data.cep || null,
        street: data.street || null,
        number: data.number || null,
        complement: data.complement || null,
        district: data.district || null,
        city: data.city || null,
        state: data.state || null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        bio: isProvider ? data.bio || null : null,
        radiusKm: isProvider ? (data.radiusKm ?? null) : null,
        verified: false, // providers require admin verification
        active: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
      },
    })

    await createSession(user.id, user.role as "CLIENT" | "PROVIDER" | "ADMIN")

    // 🔔 Fire provider.registered event — admin webhooks can trigger auto push
    if (user.role === "PROVIDER") {
      fireEvent("provider.registered", {
        providerName: user.name,
        city: (data.city || "") as string,
        state: (data.state || "") as string,
      }).catch((err) => logger.warn({ err }, "push notification failed (fire-and-forget)"))
    }

    return NextResponse.json({ user }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
