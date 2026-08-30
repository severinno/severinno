/**
 * In-App Chat — messaging between client and provider.
 *
 * Uses the existing Message model (fromId/toId, no Conversation model).
 * Messages are direct between two users, optionally linked to a booking.
 *
 * Features:
 *   - Direct messaging between users
 *   - Booking context (messages linked to a booking)
 *   - Read receipts (read boolean)
 *   - Typing indicators (via Redis)
 *   - Spam detection (keyword filtering)
 */
import { db } from "./db"
import { cacheGet, cacheSet, getClient } from "./redis"
import logger from "./logger"

// ── Types ─────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  fromId: string
  toId: string
  content: string
  read: boolean
  bookingId?: string
  createdAt: string
}

export type ChatConversation = {
  partnerId: string
  partnerName: string
  partnerAvatar?: string
  lastMessage?: ChatMessage
  unreadCount: number
  bookingId?: string
}

// ── Send Message ──────────────────────────────────────────────────────────

/**
 * Send a message between two users.
 */
export async function sendMessage(
  fromId: string,
  toId: string,
  content: string,
  bookingId?: string,
): Promise<ChatMessage> {
  // Verify users exist
  const [sender, receiver] = await Promise.all([
    db.user.findUnique({ where: { id: fromId }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { id: toId }, select: { id: true, name: true } }),
  ])

  if (!sender || !receiver) throw new Error("Usuário não encontrado")

  // Spam check
  const isSpam = await checkSpam(content)
  if (isSpam) {
    logger.warn({ fromId, toId }, "chat: spam detected")
  }

  const message = await db.message.create({
    data: {
      fromId,
      toId,
      content,
      bookingId: bookingId ?? null,
    },
  })

  // Broadcast via Redis Pub/Sub
  try {
    const client = getClient()
    if (client) {
      await client.publish("chat:messages", JSON.stringify({
        type: "new_message",
        message: {
          id: message.id,
          fromId,
          toId,
          content,
          read: false,
          bookingId: message.bookingId ?? undefined,
          createdAt: message.createdAt.toISOString(),
        },
      }))
    }
  } catch {
    // Redis unavailable
  }

  return {
    id: message.id,
    fromId: message.fromId,
    toId: message.toId,
    content: message.content,
    read: message.read,
    bookingId: message.bookingId ?? undefined,
    createdAt: message.createdAt.toISOString(),
  }
}

// ── Get Conversations ─────────────────────────────────────────────────────

/**
 * Get all conversations for a user (grouped by partner).
 */
export async function getUserConversations(userId: string): Promise<ChatConversation[]> {
  // Get all messages involving this user
  const messages = await db.message.findMany({
    where: {
      OR: [{ fromId: userId }, { toId: userId }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  // Group by partner
  const partnerMap = new Map<string, typeof messages>()
  for (const msg of messages) {
    const partnerId = msg.fromId === userId ? msg.toId : msg.fromId
    if (!partnerMap.has(partnerId)) {
      partnerMap.set(partnerId, [])
    }
    partnerMap.get(partnerId)!.push(msg)
  }

  // Get partner details
  const partnerIds = [...partnerMap.keys()]
  const partners = await db.user.findMany({
    where: { id: { in: partnerIds } },
    select: { id: true, name: true, avatarUrl: true },
  })
  const partnerLookup = new Map(partners.map((p) => [p.id, p]))

  // Build conversations
  const conversations: ChatConversation[] = []
  for (const [partnerId, msgs] of partnerMap) {
    const partner = partnerLookup.get(partnerId)
    if (!partner) continue

    const lastMsg = msgs[0]!
    const unreadCount = msgs.filter(
      (m) => m.toId === userId && !m.read,
    ).length

    conversations.push({
      partnerId,
      partnerName: partner.name,
      partnerAvatar: partner.avatarUrl ?? undefined,
      lastMessage: {
        id: lastMsg.id,
        fromId: lastMsg.fromId,
        toId: lastMsg.toId,
        content: lastMsg.content,
        read: lastMsg.read,
        bookingId: lastMsg.bookingId ?? undefined,
        createdAt: lastMsg.createdAt.toISOString(),
      },
      unreadCount,
      bookingId: lastMsg.bookingId ?? undefined,
    })
  }

  // Sort by last message time
  conversations.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ?? ""
    const bTime = b.lastMessage?.createdAt ?? ""
    return bTime.localeCompare(aTime)
  })

  return conversations
}

// ── Get Messages ──────────────────────────────────────────────────────────

/**
 * Get messages between two users (paginated).
 */
export async function getMessages(
  userId: string,
  partnerId: string,
  limit: number = 50,
  cursor?: string,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const messages = await db.message.findMany({
    where: {
      OR: [
        { fromId: userId, toId: partnerId },
        { fromId: partnerId, toId: userId },
      ],
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  })

  const hasMore = messages.length > limit
  const sliced = messages.slice(0, limit)

  // Mark partner's messages as read
  const unreadIds = sliced
    .filter((m) => m.fromId === partnerId && m.toId === userId && !m.read)
    .map((m) => m.id)

  if (unreadIds.length > 0) {
    await db.message.updateMany({
      where: { id: { in: unreadIds } },
      data: { read: true },
    })
  }

  return {
    messages: sliced.map((m) => ({
      id: m.id,
      fromId: m.fromId,
      toId: m.toId,
      content: m.content,
      read: m.read,
      bookingId: m.bookingId ?? undefined,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
  }
}

// ── Mark as Read ──────────────────────────────────────────────────────────

export async function markAsRead(userId: string, partnerId: string): Promise<void> {
  await db.message.updateMany({
    where: {
      fromId: partnerId,
      toId: userId,
      read: false,
    },
    data: { read: true },
  })
}

// ── Typing Indicator ──────────────────────────────────────────────────────

export async function setTyping(fromId: string, toId: string): Promise<void> {
  try {
    await cacheSet(`chat:typing:${toId}:${fromId}`, true, 5) // 5s TTL
  } catch {
    // Best-effort
  }
}

export async function isTyping(userId: string, partnerId: string): Promise<boolean> {
  try {
    const typing = await cacheGet<boolean>(`chat:typing:${userId}:${partnerId}`)
    return typing === true
  } catch {
    return false
  }
}

// ── Spam Detection ────────────────────────────────────────────────────────

const SPAM_KEYWORDS = [
  "compre agora", "clique aqui", "oferta imperdível", "grátis",
  "ganhe dinheiro", "trabalhe de casa", "renda extra",
  "whatsapp", "telegram", "instagram", "link na bio",
]

async function checkSpam(content: string): Promise<boolean> {
  const lower = content.toLowerCase()
  return SPAM_KEYWORDS.some((kw) => lower.includes(kw))
}
