export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { checkAndNotifyBookingSlotFit } from "@/lib/slot-fit-notifications"

const slotFitCheckSchema = z.object({
  bookingId: z.string().min(1, "ID do agendamento é obrigatório"),
})

export const POST = withRoute("api.provider.routes.slot-fit-check.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  await requireRole("PROVIDER")

  const body = await request.json()
  const parsed = slotFitCheckSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await checkAndNotifyBookingSlotFit(parsed.data.bookingId)

  return NextResponse.json(result)
})
