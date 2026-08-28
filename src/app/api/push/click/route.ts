import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { handleError } from "@/lib/api-server"
import logger from "@/lib/logger"

/**
 * POST /api/push/click
 *
 * Endpoint chamado pelo Service Worker quando o usuario clica em uma
 * notificacao push. Atualiza o registro de analytics com o status
 * "clicked" e o timestamp do clique.
 *
 * Body:
 *   notificationId — ID do registro PushAnalytics (opcional)
 *   title          — titulo da notificacao (fallback se notificationId ausente)
 *
 * NOTA: Este endpoint NAO requer autenticacao porque e chamado pelo
 * Service Worker que nao tem acesso ao cookie de sessao.
 * O notificationId e um ID aleatorio nao adivinhavel, entao nao ha
 * risco de manipulacao.
 */
export async function POST(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.general)
  try {
    const body = await request.json()
    const { notificationId, title } = body

    if (!notificationId && !title) {
      return NextResponse.json(
        { ok: false, error: "notificationId ou title required" },
        { status: 400 },
      )
    }

    if (notificationId) {
      // Update the specific analytics record
      const updated = await db.pushAnalytics
        .update({
          where: { id: notificationId },
          data: {
            status: "clicked",
            clickedAt: new Date(),
          },
        })
        .catch(() => null)

      if (updated) {
        logger.debug({ notificationId }, "push notification clicked — analytics updated")
        return NextResponse.json({ ok: true })
      }
    }

    // Fallback: if notificationId not found or not provided, log the click
    logger.info(
      { title, notificationId: notificationId ?? "unknown" },
      "push notification clicked (no analytics record)",
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
