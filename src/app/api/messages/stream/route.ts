import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { getClient } from "@/lib/redis"

// =============================================================================
// GET /api/messages/stream — Server-Sent Events for real-time messaging
// =============================================================================
// Client connects with ?since=<timestamp> to receive new messages.
// Uses Redis pub/sub for cross-instance broadcasting.
//
// Events:
//   - message: { id, fromId, toId, content, createdAt, bookingId }
//   - read:    { peerId } — messages marked as read
//   - typing:  { peerId, isTyping }
//   - heartbeat: { ts } — keep-alive every 15s
// =============================================================================

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await requireUser().catch(() => null)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.userId
  const channel = `messages:${userId}`
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connected event
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch {
          // Controller closed
        }
      }

      // Subscribe to Redis pub/sub
      const parent = getClient()
      const subscriber = parent?.duplicate?.()
      if (subscriber) {
        subscriber.subscribe(channel)
        subscriber.on("message", (_ch: string, message: string) => {
          try {
            const parsed = JSON.parse(message)
            send(parsed.type ?? "message", parsed)
          } catch {
            // Ignore malformed messages
          }
        })
      }

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        send("heartbeat", { ts: Date.now() })
      }, 15_000)

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat)
        subscriber?.unsubscribe(channel)
        subscriber?.disconnect()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
