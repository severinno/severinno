export const dynamic = "force-dynamic"

/**
 * GET /api/tracking/[id]/stream — SSE streaming for real-time tracking.
 *
 * Replaces polling with Server-Sent Events for sub-50ms latency.
 * Client receives position updates as they happen (no polling overhead).
 *
 * Protocol:
 *   - Connect: GET /api/tracking/{bookingId}/stream
 *   - Events: position, status, geofence, heartbeat
 *   - Auto-reconnect: client should reconnect after 3s on disconnect
 *
 * Reduces requests from ~30/min (polling @ 2s) to 1 (SSE connection).
 */
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getClient } from "@/lib/redis"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { checkGeofences } from "@/lib/geofencing"
import logger from "@/lib/logger"

// ── SSE connection registry ───────────────────────────────────────────────

type SSEClient = {
  controller: ReadableStreamDefaultController
  bookingId: string
  connectedAt: number
  lastEventId: number
}

// In-memory SSE client registry (per-instance, not shared)
const sseClients = new Map<string, SSEClient[]>()

/** Global cap on total tracked bookings to prevent unbounded memory growth. */
const MAX_TOTAL_SSE_BOOKINGS = 2_000

/** Shared DB poller per booking — one interval fans out to all SSE clients. */
const bookingPollers = new Map<
  string,
  { interval: ReturnType<typeof setInterval>; refCount: number; lastStatus: string }
>()

// Position broadcast buffer (latest position per booking, with TTL)
const positionBuffer = new Map<
  string,
  {
    lat: number
    lng: number
    speed: number | null
    heading: number | null
    timestamp: string
    providerId: string
    expiresAt: number
  }
>()

const POSITION_BUFFER_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Evict stale entries from positionBuffer. */
function evictStalePositions() {
  const now = Date.now()
  for (const [key, entry] of positionBuffer) {
    if (entry.expiresAt <= now) {
      positionBuffer.delete(key)
    }
  }
}

// Run eviction every 5 minutes
const positionEvictionInterval = setInterval(evictStalePositions, 5 * 60 * 1000)
if (positionEvictionInterval.unref) positionEvictionInterval.unref()

// ── Redis Pub/Sub for cross-instance broadcast ──────────────────────────

const CHANNEL_PREFIX = "tracking:pos:"
let redisSubscriber: ReturnType<typeof import("@/lib/redis/client").createClient> | null = null
let redisPublisher: ReturnType<typeof import("@/lib/redis/client").createClient> | null = null
const subscribedChannels = new Set<string>()
/** Track handlers per channel so we can remove the exact handler on unsubscribe. */
const channelHandlers = new Map<string, (ch: string, raw: string) => void>()

async function getRedisSubscriber() {
  if (redisSubscriber) return redisSubscriber
  try {
    const { createClient } = await import("@/lib/redis/client")
    const client = createClient("standalone")
    client.on("error", (err: Error) => {
      logger.warn({ err }, "[tracking-stream] redis subscriber error")
      // Reset so next call to getRedisSubscriber() creates a new connection
      redisSubscriber = null
    })
    client.connect().catch((err: Error) => {
      logger.warn({ err }, "[tracking-stream] redis subscriber connect failed")
      redisSubscriber = null
    })
    redisSubscriber = client
  } catch (err) {
    logger.warn({ err }, "[tracking-stream] redis subscriber creation failed")
  }
  return redisSubscriber
}

async function getRedisPublisher() {
  if (redisPublisher) return redisPublisher
  try {
    const { createClient } = await import("@/lib/redis/client")
    const client = createClient("standalone")
    client.on("error", (err: Error) => {
      logger.warn({ err }, "[tracking-stream] redis publisher error")
      redisPublisher = null
    })
    client.connect().catch((err: Error) => {
      logger.warn({ err }, "[tracking-stream] redis publisher connect failed")
      redisPublisher = null
    })
    redisPublisher = client
  } catch (err) {
    logger.warn({ err }, "[tracking-stream] redis publisher creation failed")
  }
  return redisPublisher
}

async function subscribeToBooking(bookingId: string) {
  const channel = `${CHANNEL_PREFIX}${bookingId}`
  if (subscribedChannels.has(channel)) return
  const sub = await getRedisSubscriber()
  if (!sub) return
  try {
    const handler = (_ch: string, raw: string) => {
      if (_ch !== channel) return
      try {
        const pos = JSON.parse(raw)
        const clients = sseClients.get(bookingId) ?? []
        const encoder = new TextEncoder()
        for (const client of clients) {
          try {
            client.controller.enqueue(
              encoder.encode(`event: position\ndata: ${JSON.stringify(pos)}\n\n`),
            )
          } catch {
            // Client disconnected
          }
        }
      } catch {
        // Malformed message
      }
    }
    channelHandlers.set(channel, handler)
    sub.subscribe(channel)
    subscribedChannels.add(channel)
    sub.on("message", handler)
  } catch (err) {
    // Clean up if subscribe failed — don't leave stale state
    channelHandlers.delete(channel)
    subscribedChannels.delete(channel)
    logger.warn({ err, bookingId }, "[tracking-stream] subscribe failed")
  }
}

async function unsubscribeFromBooking(bookingId: string) {
  const channel = `${CHANNEL_PREFIX}${bookingId}`
  if (!subscribedChannels.has(channel)) return
  subscribedChannels.delete(channel)
  const sub = await getRedisSubscriber()
  if (!sub) return
  try {
    const handler = channelHandlers.get(channel)
    if (handler) {
      sub.removeListener("message", handler)
      channelHandlers.delete(channel)
    }
    sub.unsubscribe(channel)
  } catch (err) {
    logger.warn({ err, bookingId }, "[tracking-stream] unsubscribe failed")
  }
}

async function publishPosition(bookingId: string, position: unknown): Promise<void> {
  const channel = `${CHANNEL_PREFIX}${bookingId}`
  const pub = await getRedisPublisher()
  if (!pub) return
  try {
    pub.publish(channel, JSON.stringify(position))
  } catch {
    // Publish failure — non-critical
  }
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { requireUser } = await import("@/lib/auth")

  // Auth + ownership check
  let bookingId: string
  let booking: { id: string; clientId: string; providerId: string; status: string }
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.general)
    const { id } = await params
    bookingId = id

    // Validate booking exists
    const found = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clientId: true, providerId: true, status: true },
    })

    if (!found) {
      return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 })
    }

    if (
      session.userId !== found.clientId &&
      session.userId !== found.providerId &&
      session.role !== "ADMIN"
    ) {
      return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
    }
    booking = found
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Send initial connection event
      const sendEvent = (event: string, data: unknown, _id?: number) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(payload))
        } catch {
          // Client disconnected
        }
      }

      // Send heartbeat every 30s to keep connection alive
      const heartbeatInterval = setInterval(() => {
        sendEvent("heartbeat", { ts: new Date().toISOString() })
      }, 30_000)

      // Register client (limit per booking to prevent abuse)
      const MAX_SSE_PER_BOOKING = 5

      // Global cap: evict oldest booking if at capacity
      if (sseClients.size >= MAX_TOTAL_SSE_BOOKINGS && !sseClients.has(bookingId)) {
        const oldest = [...sseClients.entries()].sort(
          (a, b) => (a[1][0]?.connectedAt ?? 0) - (b[1][0]?.connectedAt ?? 0),
        )[0]
        if (oldest) {
          for (const c of oldest[1]) {
            try {
              c.controller.close()
            } catch {
              /* already closed */
            }
          }
          sseClients.delete(oldest[0])
          // Also clean up its poller
          const oldPoller = bookingPollers.get(oldest[0])
          if (oldPoller) {
            clearInterval(oldPoller.interval)
            bookingPollers.delete(oldest[0])
          }
        }
      }

      const existingClients = sseClients.get(bookingId) ?? []
      if (existingClients.length >= MAX_SSE_PER_BOOKING) {
        sendEvent("error", { error: "Limite de conexões atingido" })
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }

      const client: SSEClient = {
        controller,
        bookingId,
        connectedAt: Date.now(),
        lastEventId: 0,
      }

      if (!sseClients.has(bookingId)) {
        sseClients.set(bookingId, [])
      }
      sseClients.get(bookingId)!.push(client)

      // Send current position if available
      const currentPos = positionBuffer.get(bookingId)
      if (currentPos) {
        sendEvent("position", currentPos)
      }

      // Subscribe to position updates via Redis Pub/Sub for cross-instance broadcast
      subscribeToBooking(bookingId).catch(() => {})

      // Shared booking status poller — one interval per booking, fans out to all SSE clients
      let poller = bookingPollers.get(bookingId)
      if (!poller) {
        const interval = setInterval(async () => {
          try {
            // Verify poller still exists (may have been cleaned up by disconnect)
            const currentPoller = bookingPollers.get(bookingId)
            if (!currentPoller) return

            const updatedBooking = await db.booking.findUnique({
              where: { id: bookingId },
              select: { status: true },
            })
            if (updatedBooking && updatedBooking.status !== currentPoller.lastStatus) {
              currentPoller.lastStatus = updatedBooking.status
              // Fan out to all connected clients
              const clients = sseClients.get(bookingId) ?? []
              const encoder = new TextEncoder()
              for (const c of clients) {
                try {
                  c.controller.enqueue(
                    encoder.encode(
                      `event: status\ndata: ${JSON.stringify({ status: updatedBooking.status })}\n\n`,
                    ),
                  )
                } catch {
                  /* client disconnected */
                }
              }
              if (["COMPLETED", "CANCELLED", "DISPUTED"].includes(updatedBooking.status)) {
                const endPayload = encoder.encode(
                  `event: end\ndata: ${JSON.stringify({ reason: updatedBooking.status })}\n\n`,
                )
                for (const c of clients) {
                  try {
                    c.controller.enqueue(endPayload)
                  } catch {
                    /* client disconnected */
                  }
                }
                // Clean up poller when booking ends
                clearInterval(poller!.interval)
                bookingPollers.delete(bookingId)
                unsubscribeFromBooking(bookingId).catch(() => {})
                for (const c of clients) {
                  try {
                    c.controller.close()
                  } catch {
                    /* already closed */
                  }
                }
                sseClients.delete(bookingId)
              }
            }
          } catch (err) {
            logger.debug({ err, bookingId }, "[tracking-stream] status poll failed")
          }
        }, 5_000)
        poller = { interval, refCount: 0, lastStatus: booking.status }
        bookingPollers.set(bookingId, poller)
      }
      poller.refCount++

      // Cleanup on disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeatInterval)
        unsubscribeFromBooking(bookingId).catch(() => {})
        const clients = sseClients.get(bookingId) ?? []
        sseClients.set(
          bookingId,
          clients.filter((c) => c !== client),
        )
        if (sseClients.get(bookingId)?.length === 0) {
          sseClients.delete(bookingId)
          // Last client disconnected — clean up shared poller
          const p = bookingPollers.get(bookingId)
          if (p) {
            clearInterval(p.interval)
            bookingPollers.delete(bookingId)
          }
        } else {
          // Decrement refCount on shared poller
          const p = bookingPollers.get(bookingId)
          if (p) p.refCount--
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })

      // Send connection established
      sendEvent("connected", {
        bookingId,
        message: "Conectado ao tracking em tempo real",
      })
    },
  })

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering
    },
  })
}

// ── Position update endpoint (called by provider app) ─────────────────────

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { requireUser } = await import("@/lib/auth")
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.general)

    const { id: bookingId } = await params
    const body = await request.json()

    const lat = Number(body?.lat)
    const lng = Number(body?.lng)
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return NextResponse.json({ error: "Coordenadas inválidas ou fora do range" }, { status: 400 })
    }

    // Verify the caller is the assigned provider for this booking
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { providerId: true, status: true },
    })
    if (!booking) {
      return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 })
    }
    if (booking.providerId !== session.userId && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
    }

    // Store position
    const position = {
      lat,
      lng,
      speed: typeof body.speed === "number" && Number.isFinite(body.speed) ? body.speed : null,
      heading:
        typeof body.heading === "number" &&
        Number.isFinite(body.heading) &&
        body.heading >= 0 &&
        body.heading < 360
          ? body.heading
          : null,
      timestamp: new Date().toISOString(),
      providerId: session.userId,
      expiresAt: Date.now() + POSITION_BUFFER_TTL_MS,
    }

    positionBuffer.set(bookingId, position)

    // Pipeline independent Redis writes: cache position + update spatial index
    try {
      const redis = getClient()
      if (redis) {
        const pipeline = redis.pipeline()
        pipeline.setex(`tracking:position:${bookingId}`, 300, JSON.stringify(position))
        pipeline.geoadd("geo:providers", lng, lat, session.userId)
        await pipeline.exec().catch(() => {})
      }
    } catch (err) {
      logger.debug({ err, bookingId }, "[tracking-stream] redis pipeline failed")
    }

    // PUBLISH is independent — fire and forget for cross-instance broadcast
    publishPosition(bookingId, position).catch(() => {})

    // Geofence check — uses geofencing engine with distributed lock, debounce, and audit trail
    const geofenceEvents = await checkGeofences(session.userId, lat, lng)
    for (const evt of geofenceEvents) {
      broadcastGeofenceEvent(bookingId, evt)
    }

    const totalClients = sseClients.get(bookingId)?.length ?? 0
    return NextResponse.json({ ok: true, clients: totalClients })
  } catch (e) {
    return handleError(e)
  }
}

// ── Broadcast helper (exported for other modules) ─────────────────────────

/**
 * Broadcast a geofence event to all SSE clients for a booking.
 * Called by the geofencing engine.
 */
export function broadcastGeofenceEvent(
  bookingId: string,
  event: { type: string; distanceMeters: number },
): void {
  const clients = sseClients.get(bookingId) ?? []
  if (clients.length === 0) return
  const encoder = new TextEncoder()
  const payload = encoder.encode(`event: geofence\ndata: ${JSON.stringify(event)}\n\n`)
  const alive: SSEClient[] = []
  for (const client of clients) {
    try {
      client.controller.enqueue(payload)
      alive.push(client)
    } catch {
      // Client disconnected — don't add to alive list
    }
  }
  // Clean up disconnected clients
  if (alive.length !== clients.length) {
    sseClients.set(bookingId, alive)
  }
}
