import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

// ADMIN: list all settings
export async function GET() {
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
  try {
    const session = await requireRole("ADMIN")
    const body = await request.json()
    const pairs: Array<{ key: string; value: string }> = Array.isArray(body)
      ? body
      : (body?.items ?? body?.settings ?? [])
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return NextResponse.json({ error: "Envie um array de { key, value }" }, { status: 400 })
    }

    const ops = pairs.map((p) =>
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
    )
    const updated = await Promise.all(ops)
    return NextResponse.json({ items: updated })
  } catch (e) {
    return handleError(e)
  }
}
