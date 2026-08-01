/**
 * Severinno — OpenSearch Indexer
 *
 * Reads all providers, services, and categories from the database and
 * indexes them into OpenSearch for full-text search.
 *
 * Usage:
 *   bun scripts/search-index.ts              # Full reindex (delete + create + index)
 *   bun scripts/search-index.ts --refresh    # Incremental update (only index new/updated)
 *   bun scripts/search-index.ts --delete     # Delete all indices
 *
 * Environment:
 *   DATABASE_URL      — PostgreSQL connection string
 *   OPENSEARCH_URL    — OpenSearch endpoint (default: http://localhost:9200)
 */

import { PrismaClient } from "@prisma/client"
import { getClient, ensureIndices, deleteIndices, bulkIndex, INDICES } from "../src/lib/search"

const db = new PrismaClient()

// ============================================================================
// Helpers
// ============================================================================

async function indexProviders(): Promise<number> {
  const providers = await db.user.findMany({
    where: { role: "PROVIDER", active: true },
    include: {
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

  const docs = providers.map((p) => {
    const ratings = p.reviewsReceived.map((r) => r.rating)
    const rating = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : 0

    return {
      id: p.id,
      body: {
        id: p.id,
        name: p.name,
        email: p.email,
        bio: p.bio ?? "",
        city: p.city ?? "",
        state: p.state ?? "",
        district: p.district ?? "",
        role: p.role,
        verified: p.verified,
        active: p.active,
        location: p.lat && p.lng ? { lat: p.lat, lon: p.lng } : null,
        rating,
        reviewCount: ratings.length,
        completedBookings: p.bookingsAsProvider.length,
        serviceTitles: p.services.map((s) => s.title),
        serviceCategories: p.services.map((s) => s.category?.id ?? "").filter(Boolean),
        createdAt: p.createdAt.toISOString(),
      },
    }
  })

  if (docs.length > 0) {
    await bulkIndex(INDICES.PROVIDERS, docs)
  }
  return docs.length
}

async function indexServices(): Promise<number> {
  const services = await db.service.findMany({
    where: { active: true },
    include: {
      provider: { select: { name: true } },
      category: { select: { name: true } },
    },
  })

  const docs = services.map((s) => ({
    id: s.id,
    body: {
      id: s.id,
      providerId: s.providerId,
      providerName: s.provider.name,
      title: s.title,
      description: s.description ?? "",
      categoryName: s.category?.name ?? "",
      basePrice: s.basePrice,
      unit: s.unit,
      active: s.active,
      createdAt: s.createdAt.toISOString(),
    },
  }))

  if (docs.length > 0) {
    await bulkIndex(INDICES.SERVICES, docs)
  }
  return docs.length
}

async function indexCategories(): Promise<number> {
  const categories = await db.category.findMany({
    where: { active: true },
  })

  const docs = categories.map((c) => ({
    id: c.id,
    body: {
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? "",
      level: c.level,
      parentId: c.parentId ?? "",
      icon: c.icon ?? "",
      order: c.order,
      active: c.active,
    },
  }))

  if (docs.length > 0) {
    await bulkIndex(INDICES.CATEGORIES, docs)
  }
  return docs.length
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const _shouldDelete = args.includes("--delete")
  const shouldRefresh = args.includes("--refresh")

  // Validate OpenSearch connection
  const client = getClient()
  if (!client) {
    console.error("❌ OpenSearch client unavailable. Is OPENSEARCH_URL set?")
    process.exit(1)
  }

  try {
    await client.ping()
    console.log("✅ OpenSearch is reachable.")
  } catch {
    console.error(
      "❌ Cannot connect to OpenSearch at",
      process.env.OPENSEARCH_URL ?? "http://localhost:9200",
    )
    process.exit(1)
  }

  // ── Full reindex: delete + recreate ──
  if (!shouldRefresh) {
    console.log("🗑️  Deleting existing indices...")
    await deleteIndices()
    console.log("✅ Indices deleted.")
  }

  console.log("📦 Ensuring indices exist...")
  await ensureIndices()
  console.log("✅ Indices ready.")

  // ── Index data ──
  console.log("\n📤 Indexing providers...")
  const providerCount = await indexProviders()
  console.log(`   ✅ ${providerCount} providers indexed.`)

  console.log("📤 Indexing services...")
  const serviceCount = await indexServices()
  console.log(`   ✅ ${serviceCount} services indexed.`)

  console.log("📤 Indexing categories...")
  const categoryCount = await indexCategories()
  console.log(`   ✅ ${categoryCount} categories indexed.`)

  const total = providerCount + serviceCount + categoryCount
  console.log(`\n🎉 Indexing complete! ${total} total documents indexed.`)
}

main()
  .catch((e) => {
    console.error("❌ Indexing failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
