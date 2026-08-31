import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { messageSchema } from "@/lib/validators"
import { badRequest, handleError, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { sanitizeText } from "@/lib/sanitize"

// Authenticated: list messages
// - If `with` is provided → return conversation between current user and that user
// - Otherwise → return list of conversations (last message per peer)
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.messages)
    const session = await requireUser()
    const { searchParams } = new URL(request.url)
    const withUserId = searchParams.get("with") || undefined

    if (withUserId) {
      // Validate peer exists
      const peer = await db.user.findUnique({
        where: { id: withUserId },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          role: true,
        },
      })
      if (!peer) throw notFound("Usuário não encontrado")

      const messages = await db.message.findMany({
        where: {
          OR: [
            { fromId: session.userId, toId: withUserId },
            { fromId: withUserId, toId: session.userId },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      })

      // Mark unread inbound messages as read
      await db.message.updateMany({
        where: { fromId: withUserId, toId: session.userId, read: false },
        data: { read: true },
      })

      return NextResponse.json({ peer, items: messages })
    }

    // Conversations list — use DISTINCT ON to get the last message per peer
    // in a single query instead of loading ALL messages into memory.
    const LIMIT = 100

    const lastMessages = await db.$queryRawUnsafe<
      { peer_id: string; content: string; created_at: Date; unread: boolean }[]
    >(
      `SELECT DISTINCT ON (peer_id) peer_id, content, created_at, unread
       FROM (
         SELECT "toId" AS peer_id, content, "createdAt" AS created_at, read AS unread, 0 AS ord
         FROM "Message" WHERE "fromId" = $1
         UNION ALL
         SELECT "fromId" AS peer_id, content, "createdAt" AS created_at, false AS unread, 1 AS ord
         FROM "Message" WHERE "toId" = $1
       ) sub
       ORDER BY peer_id, created_at DESC
       LIMIT $2`,
      session.userId,
      LIMIT,
    )

    const peerIds = lastMessages.map((m) => m.peer_id)
    const peers = await db.user.findMany({
      where: { id: { in: peerIds } },
      select: { id: true, name: true, avatarUrl: true, role: true },
    })

    // Count unread received messages per peer
    const unreadRows = await db.$queryRawUnsafe<{ peer_id: string; count: bigint }[]>(
      `SELECT "fromId" AS peer_id, COUNT(*)::int AS count
       FROM "Message" WHERE "toId" = $1 AND read = false
       GROUP BY "fromId"`,
      session.userId,
    )
    const unreadByPeer = new Map<string, number>()
    for (const row of unreadRows) {
      unreadByPeer.set(row.peer_id, Number(row.count))
    }

    const items = lastMessages.map((m) => ({
      peerId: m.peer_id,
      lastMessage: m.content,
      lastAt: m.created_at,
      unreadCount: unreadByPeer.get(m.peer_id) ?? 0,
      peer: peers.find((p) => p.id === m.peer_id) ?? null,
    }))

    return NextResponse.json({ items })
  } catch (e) {
    return handleError(e)
  }
}

// Authenticated: send a message
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.messages)
    const session = await requireUser()
    const body = await request.json()
    const data = messageSchema.parse(body)

    if (data.toId === session.userId) {
      throw badRequest("Você não pode enviar mensagens para si mesmo")
    }
    const recipient = await db.user.findUnique({
      where: { id: data.toId },
      select: { id: true, active: true },
    })
    if (!recipient || !recipient.active) {
      throw notFound("Destinatário não encontrado")
    }

    const message = await db.message.create({
      data: {
        fromId: session.userId,
        toId: data.toId,
        content: sanitizeText(data.content),
        bookingId: data.bookingId || null,
        read: false,
      },
    })

    // Best-effort in-app notification to recipient
    await db.notification
      .create({
        data: {
          userId: data.toId,
          type: "MESSAGE",
          title: "Nova mensagem",
          body:
            data.content.length > 80
              ? sanitizeText(data.content.slice(0, 80)) + "…"
              : sanitizeText(data.content),
          read: false,
        },
      })
      .catch(() => {
        /* ignore notification errors */
      })

    return NextResponse.json({ message }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
