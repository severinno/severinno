import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { dateBlockSchema } from "@/lib/validators"
import { badRequest, forbidden, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

// GET: list date blocks (any authenticated user can read)
export async function GET(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.general)
  try {
    const session = await requireUser()

    const { searchParams } = new URL(request.url)
    const from = searchParams.get("from")
    const to = searchParams.get("to")
    const providerId = searchParams.get("providerId")

    // Determine which provider's blocks to fetch
    let targetProviderId: string
    if (providerId) {
      // Explicit providerId passed (client reading provider's blocks, or admin)
      targetProviderId = providerId
    } else {
      // Default to own blocks (provider managing own blocks)
      if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
        throw forbidden("Informe o prestador para consultar bloqueios")
      }
      targetProviderId = session.userId
    }

    const where: Prisma.DateBlockWhereInput = {
      providerId: targetProviderId,
    }

    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(to)
    }

    const items = await db.dateBlock.findMany({
      where,
      orderBy: { date: "asc" },
    })

    return NextResponse.json({ items })
  } catch (e) {
    return handleError(e)
  }
}

// POST: create a new date block
export async function POST(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.general)
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Apenas prestadores podem bloquear datas")
    }

    const body = await request.json()
    const data = dateBlockSchema.parse(body)
    const { sanitizeText } = await import("@/lib/sanitize")

    // Validate time fields
    if (!data.allDay) {
      if (!data.startTime || !data.endTime) {
        throw badRequest("Informe horário de início e fim para bloqueio parcial")
      }
      if (data.startTime >= data.endTime) {
        throw badRequest("Horário de início deve ser anterior ao horário de fim")
      }
    }

    // Build the date (start of day in local time)
    const blockDate = new Date(data.date)
    blockDate.setHours(0, 0, 0, 0)

    const block = await db.dateBlock.create({
      data: {
        providerId: session.userId,
        date: blockDate,
        allDay: data.allDay,
        startTime: data.allDay ? null : data.startTime,
        endTime: data.allDay ? null : data.endTime,
        reason: data.reason ? sanitizeText(data.reason) : null,
      },
    })

    logger.info(
      { blockId: block.id, providerId: session.userId, date: blockDate },
      "date block created",
    )

    return NextResponse.json({ block }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
