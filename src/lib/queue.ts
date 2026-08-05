import "server-only"
import amqp from "amqplib"

// amqplib type aliases — avoids TS2614 import issues with @types/amqplib
type Connection = Awaited<ReturnType<typeof amqp.connect>>
type Channel = Awaited<ReturnType<Connection["createChannel"]>>
type ConsumeMessage = NonNullable<Parameters<NonNullable<Parameters<Channel["consume"]>[1]>>[0]>
import logger from "./logger"

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://severinno:severinno@localhost:5672"
const EXCHANGE = "severinno.direct"
const DLX_EXCHANGE = "severinno.dlx"
const MAX_RETRIES = 3

declare const globalThis: { __rabbitConn?: Connection; __rabbitChan?: Channel }

let connPromise: Promise<Connection> | null = null
let chanPromise: Promise<Channel> | null = null

async function getConnection(): Promise<Connection> {
  if (connPromise) return connPromise
  connPromise = (async () => {
    const c = await amqp.connect(RABBITMQ_URL)
    c.on("error", (err: Error) => {
      logger.error({ err: err.message }, "rabbitmq connection error")
      connPromise = null
      chanPromise = null
    })
    c.on("close", () => {
      connPromise = null
      chanPromise = null
    })
    if (typeof globalThis !== "undefined") {
      globalThis.__rabbitConn = c
    }
    return c
  })()
  return connPromise
}

export async function getChannel(): Promise<Channel> {
  if (chanPromise) return chanPromise
  chanPromise = (async () => {
    const conn = await getConnection()
    const ch = await conn.createChannel()
    await ch.assertExchange(EXCHANGE, "direct", { durable: true })
    await ch.assertExchange(DLX_EXCHANGE, "direct", { durable: true })
    if (typeof globalThis !== "undefined") {
      globalThis.__rabbitChan = ch
    }
    return ch
  })()
  return chanPromise
}

export type PublishOptions = {
  routingKey: string
  payload: Record<string, unknown>
  persistent?: boolean
}

export async function publish(opts: PublishOptions): Promise<void> {
  try {
    const ch = await getChannel()
    ch.publish(EXCHANGE, opts.routingKey, Buffer.from(JSON.stringify(opts.payload)), {
      persistent: opts.persistent ?? true,
      contentType: "application/json",
    })
  } catch (err) {
    logger.error({ err: (err as Error).message }, "rabbitmq publish error")
  }
}

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
  const ch = await getChannel()
  const maxRetries = opts.maxRetries ?? MAX_RETRIES
  const dlqName = `${opts.queue}.dlq`

  // Dead-letter queue: collects messages that exceeded retry limit
  await ch.assertQueue(dlqName, { durable: true })
  await ch.bindQueue(dlqName, DLX_EXCHANGE, opts.routingKey)

  // Main queue: failed messages are routed to DLX for retry counting
  const q = await ch.assertQueue(opts.queue, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": DLX_EXCHANGE,
      "x-dead-letter-routing-key": opts.routingKey,
    },
  })
  await ch.bindQueue(q.queue, EXCHANGE, opts.routingKey)
  await ch.prefetch(opts.prefetch ?? 10)

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
        // Reject without requeue → goes to DLX → lands in .dlq queue
        ch.nack(raw, false, false)
      } else {
        logger.warn(
          { err: (err as Error).message, queue: opts.queue, retry: retries + 1, maxRetries },
          "consumer error — requeuing for retry",
        )
        // Requeue for another attempt
        ch.nack(raw, false, true)
      }
    }
  })

  // DLQ consumer: log dead-lettered messages for monitoring/alerting
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
}

export async function close(): Promise<void> {
  try {
    const ch = globalThis.__rabbitChan
    if (ch) await ch.close()
    const conn = globalThis.__rabbitConn
    if (conn) await conn.close()
  } finally {
    connPromise = null
    chanPromise = null
  }
}

export { EXCHANGE, DLX_EXCHANGE }
