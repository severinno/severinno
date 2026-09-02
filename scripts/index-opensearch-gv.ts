/**
 * Severinno — OpenSearch Indexer (Standalone)
 *
 * Reads all providers, services, and categories from PostgreSQL
 * and indexes them into OpenSearch for full-text search.
 *
 * Bypasses the `server-only` import in search.ts by importing
 * the OpenSearch client directly.
 *
 * Usage:
 *   bun scripts/index-opensearch-gv.ts              # Full reindex
 *   bun scripts/index-opensearch-gv.ts --refresh    # Only new/updated docs
 *
 * Environment:
 *   DATABASE_URL      — PostgreSQL connection string
 *   OPENSEARCH_URL    — OpenSearch endpoint (default: http://localhost:9200)
 */

import { PrismaClient } from "@prisma/client"
import { Client } from "@opensearch-project/opensearch"

const db = new PrismaClient()

const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? "http://localhost:9200"
const INDEX_PREFIX = "severinno"

const INDICES = {
  PROVIDERS: `${INDEX_PREFIX}-providers`,
  SERVICES: `${INDEX_PREFIX}-services`,
  CATEGORIES: `${INDEX_PREFIX}-categories`,
} as const

// ── OpenSearch client ──────────────────────────────────────────────────────

function createOSClient(): Client {
  return new Client({
    node: OPENSEARCH_URL,
    requestTimeout: 30_000,
  })
}

const os = createOSClient()

// ── Analysis settings (must match search.ts) ───────────────────────────────

const SHARED_ANALYSIS = {
  analyzer: {
    severinno_search: {
      type: "custom",
      tokenizer: "standard",
      filter: ["lowercase", "asciifolding", "brazilian_stop", "brazilian_stemmer", "severinno_synonyms"],
    },
    severinno_index: {
      type: "custom",
      tokenizer: "standard",
      filter: ["lowercase", "asciifolding", "brazilian_stop", "brazilian_stemmer", "severinno_synonyms"],
    },
  },
  filter: {
    brazilian_stop: { type: "stop", stopwords: "_brazilian_" },
    brazilian_stemmer: { type: "stemmer", language: "brazilian" },
    severinno_synonyms: {
      type: "synonym",
      synonyms: [
        "encanador, plumber",
        "eletricista, eletriciano",
        "pintor, painter",
        "diarista, faxineira, cleaner",
        "pedreiro, mason",
        "motorista, chauffeur",
        "jardineiro, paisagista",
        "técnico, manutencão",
        "limpeza, higienização",
        "reforma, remodelação",
        "instalação, instalar",
        "conserto, reparo, manutenção",
        "emergência, urgente",
        "orçamento, cotação, preço",
      ],
    },
  },
  normalizer: {
    severinno_sort: { type: "custom", filter: ["lowercase", "asciifolding"] },
  },
}

// ── Index mappings ─────────────────────────────────────────────────────────

const PROVIDER_MAPPINGS = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    name: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search", fields: { keyword: { type: "keyword" }, sort: { type: "keyword", normalizer: "severinno_sort" } } },
    email: { type: "keyword" },
    bio: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search" },
    city: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search", fields: { keyword: { type: "keyword" } } },
    state: { type: "keyword" },
    district: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search" },
    role: { type: "keyword" },
    verified: { type: "boolean" },
    active: { type: "boolean" },
    location: { type: "geo_point" },
    rating: { type: "float" },
    reviewCount: { type: "integer" },
    completedBookings: { type: "integer" },
    serviceTitles: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search", boost: 2.0 },
    serviceCategories: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search" },
    createdAt: { type: "date" },
  },
}

const SERVICE_MAPPINGS = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    providerId: { type: "keyword" },
    providerName: { type: "keyword" },
    title: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search", fields: { keyword: { type: "keyword" } }, boost: 3.0 },
    description: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search" },
    categoryName: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search" },
    basePrice: { type: "float" },
    unit: { type: "keyword" },
    active: { type: "boolean" },
    createdAt: { type: "date" },
  },
}

const CATEGORY_MAPPINGS = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    name: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search", fields: { keyword: { type: "keyword" }, sort: { type: "keyword", normalizer: "severinno_sort" } } },
    slug: { type: "keyword" },
    description: { type: "text", analyzer: "severinno_index", search_analyzer: "severinno_search" },
    level: { type: "byte" },
    parentId: { type: "keyword" },
    icon: { type: "keyword" },
    order: { type: "byte" },
    active: { type: "boolean" },
  },
}

// ── Index management ──────────────────────────────────────────────────────

async function ensureIndices(): Promise<void> {
  const configs = [
    { name: INDICES.PROVIDERS, mappings: PROVIDER_MAPPINGS },
    { name: INDICES.SERVICES, mappings: SERVICE_MAPPINGS },
    { name: INDICES.CATEGORIES, mappings: CATEGORY_MAPPINGS },
  ]

  for (const { name, mappings } of configs) {
    const exists = await os.indices.exists({ index: name })
    if (!exists.body) {
      await os.indices.create({
        index: name,
        body: {
          settings: {
            index: {
              number_of_shards: 1,
              number_of_replicas: 0,
              analysis: SHARED_ANALYSIS,
            },
          },
          mappings,
        },
      })
      console.log(`  📦 Created index: ${name}`)
    } else {
      console.log(`  ✅ Index exists: ${name}`)
    }
  }
}

async function deleteIndices(): Promise<void> {
  for (const name of Object.values(INDICES)) {
    const exists = await os.indices.exists({ index: name })
    if (exists.body) {
      await os.indices.delete({ index: name })
      console.log(`  🗑️  Deleted index: ${name}`)
    }
  }
}

// ── Bulk indexing ──────────────────────────────────────────────────────────

async function bulkIndex(
  index: string,
  docs: Array<{ id: string; body: Record<string, unknown> }>,
): Promise<number> {
  if (docs.length === 0) return 0

  const body = docs.flatMap((doc) => [{ index: { _index: index, _id: doc.id } }, doc.body])

  const response = await os.bulk({ body, refresh: "true" })
  if (response.body.errors) {
    const errorItems = response.body.items.filter(
      (i: { index?: { error?: unknown } }) => i.index?.error,
    )
    console.error(`  ⚠️  ${errorItems.length} errors in ${index}`)
    for (const item of errorItems.slice(0, 3)) {
      console.error("    ", JSON.stringify(item.index?.error))
    }
  }
  return docs.length
}

// ── Index functions ────────────────────────────────────────────────────────

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

  return bulkIndex(INDICES.PROVIDERS, docs)
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

  return bulkIndex(INDICES.SERVICES, docs)
}

async function indexCategories(): Promise<number> {
  const categories = await db.category.findMany({ where: { active: true } })

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

  return bulkIndex(INDICES.CATEGORIES, docs)
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const shouldDelete = args.includes("--delete")
  const shouldRefresh = args.includes("--refresh")

  // Validate OpenSearch connection
  try {
    await os.ping()
    console.log("✅ OpenSearch is reachable at", OPENSEARCH_URL)
  } catch {
    console.error("❌ Cannot connect to OpenSearch at", OPENSEARCH_URL)
    process.exit(1)
  }

  // Delete if requested or full reindex
  if (shouldDelete || !shouldRefresh) {
    console.log("\n🗑️  Deleting existing indices...")
    await deleteIndices()
  }

  console.log("\n📦 Ensuring indices exist...")
  await ensureIndices()

  // Index data
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

  // Verify with a test search
  console.log("\n🔍 Test search: 'encanador'...")
  const testResult = await os.search({
    index: INDICES.SERVICES,
    body: {
      query: {
        multi_match: {
          query: "encanador",
          fields: ["title^3", "description", "categoryName"],
          fuzziness: "AUTO",
        },
      },
      size: 3,
    },
  })

  const hits = testResult.body.hits.hits
  console.log(`   Found ${testResult.body.hits.total.value} results:`)
  for (const hit of hits) {
    console.log(`   - ${hit._source.title} (${hit._source.categoryName}) — R$ ${hit._source.basePrice}`)
  }
}

main()
  .catch((e) => {
    console.error("❌ Indexing failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
