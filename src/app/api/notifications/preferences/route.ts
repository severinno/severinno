import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError, badRequest, unauthorized } from "@/lib/api-server"

// ── GET — list all preferences for the current user ─────────────────────────

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id")
    if (!userId) throw unauthorized()

    const result = await db.$queryRawUnsafe<
      Array<{ type: string; pushEnabled: boolean; emailEnabled: boolean; whatsappEnabled: boolean; soundEnabled: boolean }>
    >(
      `SELECT type, "pushEnabled", "emailEnabled", "whatsappEnabled", "soundEnabled"
       FROM "NotificationPreference"
       WHERE "userId" = $1`,
      [userId],
    )

    return NextResponse.json({ preferences: result })
  } catch (e) {
    return handleError(e)
  }
}

// ── PATCH — upsert preferences for a notification type ──────────────────────

export async function PATCH(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id")
    if (!userId) throw unauthorized()

    const body = await request.json()
    const { type, pushEnabled, emailEnabled, whatsappEnabled, soundEnabled } = body

    if (!type || typeof type !== "string") throw badRequest("type is required")

    await db.$executeRawUnsafe(
      `INSERT INTO "NotificationPreference" ("id", "userId", "type", "pushEnabled", "emailEnabled", "whatsappEnabled", "soundEnabled")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
       ON CONFLICT ("userId", "type")
       DO UPDATE SET
         "pushEnabled" = COALESCE($3, "NotificationPreference"."pushEnabled"),
         "emailEnabled" = COALESCE($4, "NotificationPreference"."emailEnabled"),
         "whatsappEnabled" = COALESCE($5, "NotificationPreference"."whatsappEnabled"),
         "soundEnabled" = COALESCE($6, "NotificationPreference"."soundEnabled")`,
      [userId, type, pushEnabled, emailEnabled, whatsappEnabled, soundEnabled],
    )

    return NextResponse.json({ success: true })
  } catch (e) {
    return handleError(e)
  }
}
