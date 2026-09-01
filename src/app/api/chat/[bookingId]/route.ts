import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { sanitizeText } from "@/lib/sanitize"
import { analyzeMessageForLeakage } from "@/lib/leak-detector"
import { badRequest, forbidden, notFound, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

const chatMessageSchema = z.object({
  content: z.string().min(1, "Conteúdo da mensagem é obrigatório").max(2000),
})

export type ChatMessage = {
  id: string
  bookingId: string
  senderId: string
  senderName: string
  senderRole: "CLIENT" | "PROVIDER"
  content: string
  safetyWarning: string | null
  createdAt: string
}

async function verifyBookingParticipant(bookingId: string, userId: string, role: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      clientId: true,
      providerId: true,
      client: { select: { name: true } },
      provider: { select: { name: true } },
    },
  })
  if (!booking) throw notFound("Agendamento não encontrado")
  if (userId !== booking.clientId && userId !== booking.providerId && role !== "ADMIN") {
    throw forbidden("Acesso restrito aos participantes deste agendamento")
  }
  return booking
}

/**
 * GET /api/chat/[bookingId]
 * Returns conversation messages for a specific booking from DB.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const { bookingId } = await params
    const booking = await verifyBookingParticipant(bookingId, session.userId, session.role)

    const messages = await db.message.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fromId: true,
        content: true,
        createdAt: true,
        fromUser: { select: { name: true, role: true } },
      },
    })

    const formatted: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      bookingId,
      senderId: m.fromId,
      senderName: m.fromUser.name,
      senderRole: m.fromUser.role as "CLIENT" | "PROVIDER",
      content: m.content,
      safetyWarning: null,
      createdAt: m.createdAt.toISOString(),
    }))

    return NextResponse.json({
      ok: true,
      bookingId,
      counterpart:
        session.userId === booking.clientId ? booking.provider.name : booking.client.name,
      messages: formatted,
    })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * POST /api/chat/[bookingId]
 * body: { content }
 * Sends a new in-app message with automatic anti-fraud leakage analysis.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const { bookingId } = await params

    const raw = (await request.json()) as unknown
    const { content } = chatMessageSchema.parse(raw)
    const sanitized = sanitizeText(content.trim())

    const booking = await verifyBookingParticipant(bookingId, session.userId, session.role)

    const isClient = session.userId === booking.clientId
    const senderName = isClient ? booking.client.name : booking.provider.name

    // Run Anti-Fraud Leakage Detection
    const leakAnalysis = analyzeMessageForLeakage(sanitized)

    const saved = await db.message.create({
      data: {
        fromId: session.userId,
        toId: isClient ? booking.providerId : booking.clientId,
        content: sanitized,
        bookingId,
      },
      select: {
        id: true,
        fromId: true,
        content: true,
        createdAt: true,
      },
    })

    const newMessage: ChatMessage = {
      id: saved.id,
      bookingId,
      senderId: saved.fromId,
      senderName,
      senderRole: isClient ? "CLIENT" : "PROVIDER",
      content: saved.content,
      safetyWarning: leakAnalysis.warning,
      createdAt: saved.createdAt.toISOString(),
    }

    return NextResponse.json({
      ok: true,
      message: newMessage,
      leakAnalysis,
    })
  } catch (e) {
    return handleError(e)
  }
}
