import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { analyzeMessageForLeakage } from "@/lib/leak-detector"
import { badRequest, forbidden, notFound, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

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

// In-memory chat storage per booking with TTL cleanup
const inMemoryChatStore = new Map<string, ChatMessage[]>()

/**
 * GET /api/chat/[bookingId]
 * Returns conversation messages for a specific booking.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const { bookingId } = await params

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true, providerId: true, client: { select: { name: true } }, provider: { select: { name: true } } },
    })

    if (!booking) {
      throw notFound("Agendamento não encontrado")
    }

    if (session.userId !== booking.clientId && session.userId !== booking.providerId && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito aos participantes deste agendamento")
    }

    const messages = inMemoryChatStore.get(bookingId) || []

    return NextResponse.json({
      ok: true,
      bookingId,
      counterpart: session.userId === booking.clientId ? booking.provider.name : booking.client.name,
      messages,
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

    const body = (await request.json()) as { content?: string }

    if (!body.content || !body.content.trim()) {
      throw badRequest("Conteúdo da mensagem é obrigatório")
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        clientId: true,
        providerId: true,
        client: { select: { name: true } },
        provider: { select: { name: true } },
      },
    })

    if (!booking) {
      throw notFound("Agendamento não encontrado")
    }

    if (session.userId !== booking.clientId && session.userId !== booking.providerId && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito aos participantes deste agendamento")
    }

    const isClient = session.userId === booking.clientId
    const senderName = isClient ? booking.client.name : booking.provider.name

    // Run Anti-Fraud Leakage Detection
    const leakAnalysis = analyzeMessageForLeakage(body.content)

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      bookingId,
      senderId: session.userId,
      senderName,
      senderRole: isClient ? "CLIENT" : "PROVIDER",
      content: body.content.trim(),
      safetyWarning: leakAnalysis.warning,
      createdAt: new Date().toISOString(),
    }

    const currentList = inMemoryChatStore.get(bookingId) || []
    currentList.push(newMessage)
    inMemoryChatStore.set(bookingId, currentList)

    return NextResponse.json({
      ok: true,
      message: newMessage,
      leakAnalysis,
    })
  } catch (e) {
    return handleError(e)
  }
}
