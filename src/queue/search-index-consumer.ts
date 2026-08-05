/**
 * Search Index Consumer — polls search_reindex_queue and reindexes
 * affected documents in OpenSearch.
 *
 * Usage:
 *   WORKER_TYPE=search-index bun src/queue/search-index-consumer.ts
 *
 * Environment:
 *   DATABASE_URL     — PostgreSQL connection string
 *   OPENSEARCH_URL   — OpenSearch endpoint (default: http://localhost:9200)
 *   POLL_INTERVAL_MS — How often to poll (default: 5_000)
 *   BATCH_SIZE       — Rows per batch (default: 50)
 */

import { PrismaClient } from "@prisma/client"
import { getClient, indexDocument, deleteDocument, INDICES } from "../lib/search"
import logger from "../lib/logger"

const db = new PrismaClient()
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS) || 5_000
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 50

// ── Reindex helpers ──────────────────────────────────────────────────────────

async function reindexProvider(id: string, action: string): Promise<void> {
  if (action === "delete") {
    await deleteDocument(INDICES.PROVIDERS, id)
    logger.info({ id }, "Deleted provider from search index")
    return
  }

  const provider = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      bio: true,
      city: true,
      state: true,
      district: true,
      lat: true,
      lng: true,
      verified: true,
      active: true,
      role: true,
      createdAt: true,
      services: {
        where: { active: true },
        select: { title: true, category: { select: { id: true, name: true } } },
      },
      reviewsReceived: { select: { rating: true } },
      bookingsAsProvider: {
        where: { status: "COMPLETED" },
        select: { id: true },
      },
    },
  })

  if (!provider || !provider.active || provider.role !== "PROVIDER") {
    await deleteDocument(INDICES.PROVIDERS, id)
    logger.info({ id }, "Provider not found/inactive — removed from index")
    return
  }

  const ratings = provider.reviewsReceived.map((r: { rating: number }) => r.rating)
  const rating = ratings.length
    ? Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length) * 10) / 10
    : 0

  await indexDocument(INDICES.PROVIDERS, id, {
    id: provider.id,
    name: provider.name,
    email: provider.email,
    bio: provider.bio ?? "",
    city: provider.city ?? "",
    state: provider.state ?? "",
    district: provider.district ?? "",
    role: provider.role,
    verified: provider.verified,
    active: provider.active,
    location: provider.lat && provider.lng ? { lat: provider.lat, lon: provider.lng } : null,
    rating,
    reviewCount: ratings.length,
    completedBookings: provider.bookingsAsProvider.length,
    serviceTitles: provider.services.map((s: { title: string }) => s.title),
    serviceCategories: provider.services
      .map((s: { category?: { id: string } | null }) => s.category?.id ?? "")
      .filter(Boolean),
    createdAt: provider.createdAt.toISOString(),
  })
}

async function reindexService(id: string, action: string): Promise<void> {
  if (action === "delete") {
    await deleteDocument(INDICES.SERVICES, id)
    return
  }

  const service = await db.service.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      basePrice: true,
      unit: true,
      active: true,
      createdAt: true,
      providerId: true,
      provider: { select: { name: true } },
      category: { select: { name: true } },
    },
  })

  if (!service) {
    await deleteDocument(INDICES.SERVICES, id)
    return
  }

  await indexDocument(INDICES.SERVICES, id, {
    id: service.id,
    providerId: service.providerId,
    providerName: service.provider.name,
    title: service.title,
    description: service.description ?? "",
    categoryName: service.category?.name ?? "",
    basePrice: service.basePrice,
    unit: service.unit,
    active: service.active,
    createdAt: service.createdAt.toISOString(),
  })
}

async function reindexCategory(id: string, action: string): Promise<void> {
  if (action === "delete") {
    await deleteDocument(INDICES.CATEGORIES, id)
    return
  }

  const category = await db.category.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      level: true,
      parentId: true,
      icon: true,
      order: true,
      active: true,
    },
  })

  if (!category) {
    await deleteDocument(INDICES.CATEGORIES, id)
    return
  }

  await indexDocument(INDICES.CATEGORIES, id, {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description ?? "",
    level: category.level,
    parentId: category.parentId ?? "",
    icon: category.icon ?? "",
    order: category.order,
    active: category.active,
  })
}

// ── Polling loop ─────────────────────────────────────────────────────────────

async function processQueue(): Promise<number> {
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: bigint
      entityType: string
      entityId: string
      action: string
    }>
  >(
    `SELECT id, "entityType", "entityId", action
     FROM "search_reindex_queue"
     ORDER BY "createdAt" ASC
     LIMIT ${BATCH_SIZE}
     FOR UPDATE SKIP LOCKED`,
  )

  if (rows.length === 0) return 0

  // Process in parallel by entity type
  const results = await Promise.allSettled(
    rows.map((row: { entityType: string; entityId: string; action: string }) => {
      switch (row.entityType) {
        case "provider":
          return reindexProvider(row.entityId, row.action)
        case "service":
          return reindexService(row.entityId, row.action)
        case "category":
          return reindexCategory(row.entityId, row.action)
        default:
          logger.warn({ entityType: row.entityType }, "Unknown entity type in reindex queue")
          return Promise.resolve()
      }
    }),
  )

  // Log failures
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === "rejected") {
      logger.error({ err: r.reason, row: rows[i] }, "Reindex failed")
    }
  }

  // Delete processed rows
  const ids = rows.map((r: { id: bigint }) => r.id)
  await db.$executeRawUnsafe(`DELETE FROM "search_reindex_queue" WHERE id = ANY($1::bigint[])`, ids)

  const failed = results.filter(
    (r: PromiseSettledResult<unknown>) => r.status === "rejected",
  ).length
  logger.info({ processed: rows.length, failed }, "Reindex batch processed")
  return rows.length - failed
}

async function main() {
  const client = getClient()
  if (!client) {
    logger.error("OpenSearch client unavailable — OPENSEARCH_URL must be set")
    process.exit(1)
  }

  logger.info(
    {
      pollInterval: POLL_INTERVAL,
      batchSize: BATCH_SIZE,
    },
    "Search index consumer started",
  )

  process.on("SIGINT", () => {
    logger.info("shutting down")
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    logger.info("shutting down")
    process.exit(0)
  })

  while (true) {
    try {
      await processQueue()
    } catch (err) {
      logger.error({ err }, "Queue poll error")
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }
}

main().catch((err) => {
  logger.error({ err }, "Fatal error in search-index consumer")
  process.exit(1)
})
