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
import { cacheGet, cacheSet } from "@/lib/redis"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { checkGeofences } from "@/lib/geofencing"
import { indexProviderLocation } from "@/lib/redis-geo"

import { withParams } from "@/lib/api-route"
import { sendTrackingPosition } from "@/lib/realtime-client"
import { publishTrackingEvent, subscribeTrackingEvents } from "@/lib/tracking-pubsub"

// ── SSE connection registry ───────────────────────────────────────────────

type SSEClient = {
  controller: ReadableStreamDefaultController
  bookingId: string
  connectedAt: number
  lastEventId: number
}

// In-memory SSE client registry (per-instance, not shared)
const sseClients = new Map<string, SSEClient[]>()

// Position broadcast buffer (latest position per booking)
const positionBuffer = new Map<
  string,
  {
    lat: number
    lng: number
    speed: number | null
    heading: number | null
    accuracy: number | null
    timestamp: string
    providerId: string
  }
>()

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
    async start(controller) {
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

      // Register client
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

      // Send current position if available (from local buffer or Redis)
      const cachedInitialPos = await cacheGet<{
        lat: number
        lng: number
        speed: number | null
        heading: number | null
        accuracy: number | null
        timestamp: string
        providerId: string
      }>(`tracking:position:${bookingId}`)
      const currentPos = positionBuffer.get(bookingId) ?? cachedInitialPos
      if (currentPos) {
        sendEvent("position", currentPos)
      }

      // Inicializa status no Redis para propagação rápida
      await cacheSet(`tracking:status:${bookingId}`, booking.status, 3600).catch(() => {})

      // ── Event-Driven Reactive Dispatch (Redis Pub/Sub + In-Memory Bus) ───────
      const unsubscribePubSub = subscribeTrackingEvents(bookingId, (event) => {
        try {
          sendEvent(event.type, event.data)

          if (
            event.type === "status" &&
            event.data &&
            typeof event.data === "object" &&
            "status" in event.data
          ) {
            const nextStatus = String((event.data as Record<string, unknown>).status)
            booking.status = nextStatus
            if (["COMPLETED", "CANCELLED", "DISPUTED"].includes(nextStatus)) {
              sendEvent("end", { reason: nextStatus })
              cleanupAndClose()
            }
          } else if (event.type === "end") {
            cleanupAndClose()
          }
        } catch {
          // Client disconnected
        }
      })

      // Heartbeat periódico (mantém conexões SSE vivas em proxies reversos sem polling de banco/Redis)
      const heartbeatInterval = setInterval(() => {
        try {
          sendEvent("heartbeat", { ts: new Date().toISOString() })
        } catch {
          // Best-effort
        }
      }, 25_000)

      const cleanupAndClose = () => {
        clearInterval(heartbeatInterval)
        unsubscribePubSub()
        const clients = sseClients.get(bookingId) ?? []
        sseClients.set(
          bookingId,
          clients.filter((c) => c !== client),
        )
        if (sseClients.get(bookingId)?.length === 0) {
          sseClients.delete(bookingId)
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Cleanup on disconnect
      request.signal.addEventListener("abort", cleanupAndClose)

      // Send connection established
      sendEvent("connected", {
        bookingId,
        message: "Conectado ao tracking reativo em tempo real",
        mode: "pubsub-reactive",
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

export const POST = withParams<{ id: string }>(
  "api.tracking.:id.stream.POST",
  async (request, { params }) => {
    const { requireUser } = await import("@/lib/auth")
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.general)

    const { id: bookingId } = await params
    const body = await request.json()

    const lat = Number(body?.lat)
    const lng = Number(body?.lng)
    if (!lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat e lng são obrigatórios" }, { status: 400 })
    }

    // Verify the caller is the assigned provider for this booking
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { providerId: true, clientId: true, status: true },
    })
    if (!booking) {
      return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 })
    }
    if (booking.providerId !== session.userId && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
    }

    // Store position with GNSS accuracy
    const accuracy =
      typeof body.accuracy === "number" && Number.isFinite(body.accuracy)
        ? Math.round(body.accuracy * 10) / 10
        : null

    const position = {
      lat,
      lng,
      speed: typeof body.speed === "number" ? body.speed : null,
      heading: typeof body.heading === "number" ? body.heading : null,
      accuracy,
      timestamp: new Date().toISOString(),
      providerId: session.userId,
    }

    positionBuffer.set(bookingId, position)

    // Update provider's gpsAccuracyM for uncertainty visualization
    if (accuracy !== null) {
      db.user
        .update({
          where: { id: session.userId },
          data: { gpsAccuracyM: accuracy },
        })
        .catch(() => {})
    }

    // Cache in Redis for cross-instance broadcast
    try {
      await cacheSet(`tracking:position:${bookingId}`, position, 300)
    } catch {
      // Redis unavailable — non-critical
    }

    // Update spatial index so nearby-provider searches stay fresh during tracking
    indexProviderLocation(session.userId, lat, lng).catch(() => {})

    // Broadcast to realtime WebSocket for client room (best-effort)
    if (booking.clientId) {
      sendTrackingPosition({
        bookingId,
        clientId: booking.clientId,
        lat,
        lng,
      }).catch(() => {})
    }

    // ── Dispatch via Reactive Pub/Sub (cross-replica broadcast + local multiplex) ──
    publishTrackingEvent(bookingId, { type: "position", data: position }).catch(() => {})

    // Geofence check — uses geofencing engine with distributed lock, debounce, and audit trail
    const geofenceEvent = await checkGeofences(session.userId, lat, lng)
    if (geofenceEvent) {
      publishTrackingEvent(bookingId, { type: "geofence", data: geofenceEvent }).catch(() => {})
    }

    const clientCount = sseClients.get(bookingId)?.length ?? 0
    return NextResponse.json({ ok: true, clients: clientCount })
  },
)

// ── Broadcast helper (exported for other modules) ─────────────────────────

/**
 * Broadcast a geofence event to all SSE clients for a booking across all replicas.
 */
export function broadcastGeofenceEvent(
  bookingId: string,
  event: { type: string; distanceMeters: number },
): void {
  publishTrackingEvent(bookingId, { type: "geofence", data: event }).catch(() => {})

  const clients = sseClients.get(bookingId) ?? []
  for (const client of clients) {
    try {
      const encoder = new TextEncoder()
      client.controller.enqueue(
        encoder.encode(`event: geofence\ndata: ${JSON.stringify(event)}\n\n`),
      )
    } catch {
      // Client disconnected
    }
  }
}

/**
 * Notifica o stream de tracking sobre uma alteração no status do agendamento
 * atualizando o cache compartilhado no Redis e publicando via Pub/Sub reativo.
 */
export async function setTrackingStatus(bookingId: string, status: string): Promise<void> {
  try {
    await cacheSet(`tracking:status:${bookingId}`, status, 3600)
    await publishTrackingEvent(bookingId, { type: "status", data: { status } })
  } catch {
    // Best-effort
  }
}
