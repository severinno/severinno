export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest } from "@/lib/api-server"
import { assertRateLimit } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import { sendPushNotification } from "@/lib/push"

export const POST = withRoute("api.push.send-test.POST", async (request) => {
  await assertRateLimit(request, { prefix: "push-send-test", max: 5, windowMs: 60_000 })
  const session = await requireUser()

  const subs = await db.pushSubscription.findMany({
    where: { userId: session.userId },
  })

  if (subs.length === 0) {
    throw badRequest(
      "Nenhum dispositivo registrado para notificações push. Ative as notificações no navegador primeiro.",
    )
  }

  await sendPushNotification(
    session.userId,
    "🔔 Severinno — Notificação de Teste",
    "As notificações push nativas estão ativas e funcionando no seu dispositivo!",
    "/dashboard",
    {
      notificationType: "TEST",
      tag: "test-notification",
      source: "manual-test",
    },
  )

  return NextResponse.json({
    ok: true,
    message: "Notificação de teste enviada com sucesso!",
    deviceCount: subs.length,
  })
})
