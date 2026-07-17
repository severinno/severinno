import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

/**
 * POST /api/newsletter
 *
 * Subscribe an email to the newsletter.
 * Uses the Setting model with key "newsletter:{email}" to store subscriptions.
 * Simple dedup: if already subscribed, returns 200 with a friendly message.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = (body.email as string | undefined)?.trim().toLowerCase()

    if (!email) {
      return NextResponse.json(
        { error: "E-mail é obrigatório." },
        { status: 400 },
      )
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "E-mail inválido." },
        { status: 400 },
      )
    }

    // Check if already subscribed (using Setting as a KV store)
    const key = `newsletter:${email}`
    const existing = await db.setting.findUnique({ where: { key } })

    if (existing) {
      return NextResponse.json({
        ok: true,
        message: "Este e-mail já está inscrito!",
        alreadySubscribed: true,
      })
    }

    // Save subscription
    await db.setting.create({
      data: {
        key,
        value: JSON.stringify({
          email,
          subscribedAt: new Date().toISOString(),
          source: "footer",
        }),
      },
    })

    return NextResponse.json({
      ok: true,
      message: "Inscrição confirmada!",
    })
  } catch (err) {
    console.error("[newsletter] POST error:", err)
    return NextResponse.json(
      { error: "Erro interno. Tente novamente." },
      { status: 500 },
    )
  }
}
