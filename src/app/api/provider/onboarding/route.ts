import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

export async function GET() {
  try {
    const user = await requireUser()
    const setting = await db.setting.findUnique({
      where: { key: `onboarding:${user.userId}` },
    })
    if (!setting) {
      return NextResponse.json({ step: 0, done: false })
    }
    const data = JSON.parse(setting.value) as { step?: number; done?: boolean }
    return NextResponse.json({
      step: data.step ?? 0,
      done: data.done ?? false,
    })
  } catch (e) {
    return handleError(e)
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser()
    const { step, done } = await req.json()

    const data = JSON.stringify({ step: step ?? 0, done: done ?? false })

    await db.setting.upsert({
      where: { key: `onboarding:${user.userId}` },
      update: { value: data },
      create: { key: `onboarding:${user.userId}`, value: data },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
