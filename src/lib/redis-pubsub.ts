import { getClient, isRedisAvailable } from "./redis"
import logger from "./logger"

type MessageHandler = (channel: string, message: string) => void

const subscribers = new Map<string, Set<MessageHandler>>()

export async function publish(channel: string, message: string): Promise<void> {
  if (!isRedisAvailable()) return
  const client = getClient()
  if (!client) return
  try {
    await client.publish(channel, message)
  } catch (err) {
    logger.warn({ err, channel }, "redis-pubsub: publish failed")
  }
}

export function subscribe(channel: string, handler: MessageHandler): () => void {
  if (!subscribers.has(channel)) {
    subscribers.set(channel, new Set())
    // Subscribe via Redis client when available
    const client = getClient()
    if (client && typeof client.subscribe === "function") {
      // ioredis subscribe() signature doesn't match the callback pattern we need,
      // so we use the low-level subscribe that accepts a callback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (client as any).subscribe(channel, (msg: string) => {
        subscribers.get(channel)?.forEach((h) => h(channel, msg))
      })
    }
  }
  subscribers.get(channel)!.add(handler)
  return () => {
    subscribers.get(channel)?.delete(handler)
    if (subscribers.get(channel)?.size === 0) {
      subscribers.delete(channel)
    }
  }
}
