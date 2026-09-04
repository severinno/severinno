export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { settingSchema } from "@/lib/validators"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { resetGeoSettingsCache } from "@/lib/geo-settings"
import { resetHealthCache } from "@/app/api/health/route"

const MAX_SETTINGS_PER_REQUEST = 50

// ADMIN: list all settings
export async function GET(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.admin)
  try {
    await requireRole("ADMIN")
    const settings = await db.setting.findMany({
      orderBy: { key: "asc" },
    })
    return NextResponse.json({ items: settings, total: settings.length })
  } catch (e) {
    return handleError(e)
  }
}

// ADMIN: upsert many { key, value } pairs
export async function POST(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.admin)
  try {
    const session = await requireRole("ADMIN")
    const raw = (await request.json()) as unknown
    const pairs: Array<{ key: string; value: string }> = Array.isArray(raw)
      ? (raw as Array<{ key: string; value: string }>)
      : (((raw as Record<string, unknown>)?.items as Array<{ key: string; value: string }>) ??
        ((raw as Record<string, unknown>)?.settings as Array<{ key: string; value: string }>) ??
        [])
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return NextResponse.json({ error: "Envie um array de { key, value }" }, { status: 400 })
    }
    if (pairs.length > MAX_SETTINGS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Máximo de ${MAX_SETTINGS_PER_REQUEST} configurações por requisição` },
        { status: 400 },
      )
    }

    // Validate each pair
    for (const p of pairs) {
      settingSchema.parse(p)
    }

    const updated = await db.$transaction(
      pairs.map((p) =>
        db.setting.upsert({
          where: { key: String(p.key) },
          create: {
            key: String(p.key),
            value: String(p.value ?? ""),
            updatedBy: session.userId,
          },
          update: {
            value: String(p.value ?? ""),
            updatedBy: session.userId,
          },
          select: { key: true, value: true, updatedAt: true },
        }),
      ),
    )
    // Settings de geolocalização (kill-switches, base URLs) mudaram — invalida
    // o cache in-memory de 30s do geo-settings E o de 15s do /api/health para
    // valer na próxima chamada (kill-switch desligado aparece imediatamente).
    resetGeoSettingsCache()
    resetHealthCache()
    return NextResponse.json({ items: updated })
  } catch (e) {
    return handleError(e)
  }
}
