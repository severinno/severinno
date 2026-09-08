/**
 * RabbitMQ connection manager for the Severinno Marketplace.
 *
 * Features:
 *   - Heartbeat (60s) to detect dead connections
 *   - Automatic reconnection with exponential backoff (up to 30s)
 *   - Connection and channel health tracking via exported status
 *   - Graceful close with drain
 *
 * Architecture:
 *   ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
 *   │   publish()  │────→│  Connection  │────→│    Exchange   │
 *   └─────────────┘     │  (heartbeat)  │     │  severinno.direct
 *                        └──────┬───────┘     └──────┬─────────┘
 *                               │                    │
 *                         reconnect (auto)      bind queues
 *                               │                    │
 *                        ┌──────▼───────┐     ┌──────▼─────────┐
 *                        │    Channel   │────→│     Queue      │
 *                        │  (prefetch)  │     │ notifications  │
 *                        └──────────────┘     └──────┬─────────┘
 *                                                     │ consume()
 *                                              ┌──────▼─────────┐
 *                                              │    Handler     │
 *                                              │  (fire event)  │
 *                                              └────────────────┘
 */

import "server-only"
import amqp from "amqplib"
import logger from "./logger"

// ── Configuration ──────────────────────────────────────────────────────────

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://severinno:severinno@localhost:5672"
const EXCHANGE = "severinno.direct"
const DLX_EXCHANGE = "severinno.dlx"
const MAX_RETRIES = 3

/** Heartbeat interval in seconds (recommended: 60s for production). */
const HEARTBEAT = parseInt(process.env.RABBITMQ_HEARTBEAT ?? "60", 10)

/** Maximum reconnect backoff in ms (~30s). */
const MAX_RECONNECT_DELAY = 30_000

// ── Types ──────────────────────────────────────────────────────────────────

type Connection = amqp.Connection
type Channel = amqp.Channel
type ConsumeMessage = amqp.ConsumeMessage

// ── Connection state ───────────────────────────────────────────────────────

let connection: Connection | null = null
let channel: Channel | null = null
let connPromise: Promise<void> | null = null
let chanPromise: Promise<void> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let isShuttingDown = false

/**
 * Current connection status — exported for health checks.
 * Possible values: "connecting" | "connected" | "disconnected" | "reconnecting"
 */
export let connectionStatus: "connecting" | "connected" | "disconnected" | "reconnecting" =
  "disconnected"

/**
 * Timestamp of last successful connection (ms since epoch).
 * Null if never connected.
 */
export let lastConnectedAt: number | null = null

/**
 * Total number of reconnection attempts since process start.
 */
export let totalReconnectAttempts = 0

// ── Connection factory ─────────────────────────────────────────────────────

async function connectWithRetry(url: string, attempt: number): Promise<Connection> {
  // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, capped at 30s
  const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY)
  const jitter = delay * (0.5 + Math.random() * 0.5)

  return new Promise<Connection>((resolve, reject) => {
    reconnectTimer = setTimeout(async () => {
      try {
        logger.info(
          { attempt: attempt + 1, url: sanitizeUrl(url) },
          "attempting rabbitmq connection",
        )
        const conn = await amqp.connect(url, {
          heartbeat: HEARTBEAT,
        })
        resolve(conn)
      } catch (err) {
        reject(err)
      }
    }, jitter)
  })
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = "***"
    return u.toString()
  } catch {
    return url.replace(/:\/\/.*@/, "://***@")
  }
}

// ── Wire connection events ─────────────────────────────────────────────────

function wireConnection(conn: Connection): void {
  conn.on("error", (err: Error) => {
    logger.error({ err: err.message }, "rabbitmq connection error")
    // Don't start reconnect here — the "close" event always follows "error".
  })

  conn.on("close", () => {
    connection = null
    channel = null
    connPromise = null
    chanPromise = null
    connectionStatus = "disconnected"

    logger.warn("rabbitmq connection closed")

    if (!isShuttingDown) {
      scheduleReconnect()
    }
  })

  conn.on("blocked", (reason: string) => {
    logger.warn({ reason }, "rabbitmq connection blocked (memory/disk alarm)")
    connectionStatus = "disconnected"
  })

  conn.on("unblocked", () => {
    logger.info("rabbitmq connection unblocked")
    if (connection) {
      connectionStatus = "connected"
    }
  })
}

// ── Reconnect loop ─────────────────────────────────────────────────────────

function scheduleReconnect(): void {
  if (isShuttingDown) return
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  reconnectAttempts++
  totalReconnectAttempts++
  connectionStatus = "reconnecting"

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY)
  const jitter = delay * (0.5 + Math.random() * 0.5)

  logger.info(
    { attempt: reconnectAttempts, delayMs: Math.round(jitter) },
    "scheduling rabbitmq reconnect",
  )

  reconnectTimer = setTimeout(async () => {
    try {
      await ensureConnection()
      reconnectAttempts = 0
    } catch {
      // ensureConnection already logs errors; schedule next retry
      scheduleReconnect()
    }
  }, jitter)
}

// ── Ensure connection ──────────────────────────────────────────────────────

async function ensureConnection(): Promise<Connection> {
  if (connection && connectionStatus === "connected") {
    return connection
  }

  if (connPromise) {
    await connPromise
    if (connection) return connection
  }

  connPromise = (async () => {
    try {
      connectionStatus = "connecting"
      const conn = await connectWithRetry(RABBITMQ_URL, reconnectAttempts)
      wireConnection(conn)
      connection = conn
      lastConnectedAt = Date.now()
      connectionStatus = "connected"
      reconnectAttempts = 0
      logger.info("rabbitmq connected (heartbeat: " + HEARTBEAT + "s)")
      return conn
    } catch (err) {
      connectionStatus = "disconnected"
      logger.error(
        { err: (err as Error).message, attempt: reconnectAttempts + 1 },
        "rabbitmq connection failed",
      )
      throw err
    }
  })()

  return connPromise
}

// ── Ensure channel ─────────────────────────────────────────────────────────

async function ensureChannel(): Promise<Channel> {
  if (channel && connectionStatus === "connected") {
    // Verify the channel is still open
    try {
      return channel
    } catch {
      // Channel is closed — create a new one
      channel = null
      chanPromise = null
    }
  }

  if (chanPromise) {
    await chanPromise
    if (channel) return channel
  }

  chanPromise = (async () => {
    const conn = await ensureConnection()
    const ch = await conn.createChannel()
    await ch.assertExchange(EXCHANGE, "direct", { durable: true })
    await ch.assertExchange(DLX_EXCHANGE, "direct", { durable: true })

    ch.on("error", (err: Error) => {
      logger.error({ err: err.message }, "rabbitmq channel error")
      channel = null
      chanPromise = null
    })

    ch.on("close", () => {
      logger.warn("rabbitmq channel closed")
      channel = null
      chanPromise = null
    })

    // Set prefetch for fair dispatch
    await ch.prefetch(10)

    channel = ch
    return ch
  })()

  return chanPromise
}

/**
 * Returns the shared singleton RabbitMQ channel (or initializes it if not yet open).
 * Exported for health checks and consumers that require direct channel access.
 */
export async function getChannel(): Promise<Channel> {
  return ensureChannel()
}

// ── Publish ────────────────────────────────────────────────────────────────

export type PublishOptions = {
  routingKey: string
  payload: Record<string, unknown>
  persistent?: boolean
}

export async function publish(opts: PublishOptions): Promise<void> {
  try {
    const ch = await ensureChannel()
    ch.publish(EXCHANGE, opts.routingKey, Buffer.from(JSON.stringify(opts.payload)), {
      persistent: opts.persistent ?? true,
      contentType: "application/json",
    })
  } catch (err) {
    logger.error(
      { err: (err as Error).message, routingKey: opts.routingKey },
      "rabbitmq publish error",
    )
    // Don't reconnect here — the connection/channel events handle that.
  }
}

// ── Consumer helpers ───────────────────────────────────────────────────────

function getDeathCount(msg: ConsumeMessage): number {
  const deaths = msg.properties.headers?.["x-death"] as Array<{ count: number }> | undefined
  if (!deaths?.length) return 0
  return deaths.reduce((sum, d) => sum + (d.count ?? 0), 0)
}

export type ConsumeOptions = {
  queue: string
  routingKey: string
  handler: (msg: Record<string, unknown>) => Promise<void>
  prefetch?: number
  maxRetries?: number
}

export async function consume(opts: ConsumeOptions): Promise<void> {
  const ch = await ensureChannel()
  const maxRetries = opts.maxRetries ?? MAX_RETRIES
  const prefetch = opts.prefetch ?? 10
  const dlqName = `${opts.queue}.dlq`

  await ch.prefetch(prefetch)

  // Dead-letter queue
  await ch.assertQueue(dlqName, { durable: true })
  await ch.bindQueue(dlqName, DLX_EXCHANGE, opts.routingKey)

  // Main queue with dead-letter exchange
  const q = await ch.assertQueue(opts.queue, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": DLX_EXCHANGE,
      "x-dead-letter-routing-key": opts.routingKey,
    },
  })
  await ch.bindQueue(q.queue, EXCHANGE, opts.routingKey)

  // Main consumer
  await ch.consume(q.queue, async (raw: ConsumeMessage | null) => {
    if (!raw) return
    try {
      const msg = JSON.parse(raw.content.toString()) as Record<string, unknown>
      await opts.handler(msg)
      ch.ack(raw)
    } catch (err) {
      const retries = getDeathCount(raw)
      if (retries >= maxRetries) {
        logger.error(
          { err: (err as Error).message, queue: opts.queue, retries },
          "message exceeded max retries — sending to DLQ",
        )
        ch.nack(raw, false, false)
      } else {
        logger.warn(
          { err: (err as Error).message, queue: opts.queue, retry: retries + 1, maxRetries },
          "consumer error — requeuing for retry",
        )
        ch.nack(raw, false, true)
      }
    }
  })

  // DLQ consumer (logs dead-lettered messages)
  await ch.consume(dlqName, (raw: ConsumeMessage | null) => {
    if (!raw) return
    try {
      const body = raw.content.toString()
      logger.error(
        { queue: dlqName, body: body.slice(0, 500) },
        "dead-lettered message received — requires manual review",
      )
    } finally {
      ch.ack(raw)
    }
  })

  logger.info(
    { queue: opts.queue, routingKey: opts.routingKey, prefetch, heartbeat: HEARTBEAT },
    "rabbitmq consumer started",
  )
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

export async function close(): Promise<void> {
  isShuttingDown = true

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  try {
    if (channel) {
      await channel.close()
      channel = null
    }
    if (connection) {
      await connection.close()
      connection = null
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "rabbitmq close error (ignored)")
  } finally {
    connPromise = null
    chanPromise = null
    connectionStatus = "disconnected"
  }
}

// ── Health check ──────────────────────────────────────────────────────────

export type RabbitMQHealth = {
  status: "ok" | "error" | "disconnected" | "reconnecting"
  connected: boolean
  connectionStatus: string
  lastConnectedAt: number | null
  reconnectAttempts: number
  totalReconnectAttempts: number
  heartbeat: number
  uptimeSeconds: number | null
}

/**
 * Get current RabbitMQ health status.
 * Safe to call at any time — does not perform any I/O.
 */
export function getHealth(): RabbitMQHealth {
  return {
    status:
      connectionStatus === "connected"
        ? "ok"
        : connectionStatus === "connecting"
          ? // Tentativa de conexão em andamento: sem histórico é lazy (disconnected);
            // com histórico a reconexão está ativa (reconnecting), não é erro.
            lastConnectedAt === null
            ? "disconnected"
            : "reconnecting"
          : connectionStatus === "reconnecting"
            ? "reconnecting"
            : lastConnectedAt === null
              ? "disconnected" // Nunca conectou (lazy init) — estado normal, não é erro
              : "error", // Esteve conectado e caiu sem reconexão ativa (ex: shutdown)
    connected: connectionStatus === "connected",
    connectionStatus,
    lastConnectedAt,
    reconnectAttempts,
    totalReconnectAttempts,
    heartbeat: HEARTBEAT,
    uptimeSeconds:
      lastConnectedAt !== null ? Math.floor((Date.now() - lastConnectedAt) / 1000) : null,
  }
}

export { EXCHANGE, DLX_EXCHANGE }
