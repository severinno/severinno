import "server-only"
import { Client } from "@opensearch-project/opensearch"
import logger from "./logger"

// ============================================================================
// Configuration
// ============================================================================

const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? "http://localhost:9200"
const INDEX_PREFIX = "severinno"

export const INDICES = {
  PROVIDERS: `${INDEX_PREFIX}-providers`,
  SERVICES: `${INDEX_PREFIX}-services`,
  CATEGORIES: `${INDEX_PREFIX}-categories`,
} as const

// ============================================================================
// Client singleton (server-only)
// ============================================================================

declare const globalThis: { __opensearch?: Client }

function createClient(): Client {
  return new Client({
    node: OPENSEARCH_URL,
    requestTimeout: 10_000,
    // Single-node dev mode — no auth by default
    ...(process.env.OPENSEARCH_USERNAME
      ? {
          auth: {
            username: process.env.OPENSEARCH_USERNAME,
            password: process.env.OPENSEARCH_PASSWORD!,
          },
        }
      : {}),
  })
}

export function getClient(): Client | null {
  if (typeof window !== "undefined" && !process.env.VITEST) return null
  // Singleton in all environments (production included) to avoid creating new connections per request
  if (!globalThis.__opensearch) {
    globalThis.__opensearch = createClient()
  }
  return globalThis.__opensearch
}

// ============================================================================
// Index mappings & settings
// ============================================================================

/**
 * Brazilian Portuguese + synonym analyzer for full-text search.
 * Uses the synonym file at scripts/synonyms.txt mounted at /etc/opensearch/synonyms.txt.
 */
const SHARED_ANALYSIS = {
  analyzer: {
    severinno_search: {
      type: "custom",
      tokenizer: "standard",
      filter: [
        "lowercase",
        "asciifolding", // são paulo → sao paulo, ótimo → otimo
        "brazilian_stop",
        "brazilian_stemmer",
        "severinno_synonyms",
      ],
    },
    severinno_index: {
      type: "custom",
      tokenizer: "standard",
      filter: [
        "lowercase",
        "asciifolding",
        "brazilian_stop",
        "brazilian_stemmer",
        "severinno_synonyms",
      ],
    },
  },
  filter: {
    brazilian_stop: {
      type: "stop",
      stopwords: "_brazilian_",
    },
    brazilian_stemmer: {
      type: "stemmer",
      language: "brazilian",
    },
    severinno_synonyms: {
      type: "synonym",
      // Path relative to OpenSearch config dir (/usr/share/opensearch/config/).
      // The file is mounted at config/analysis/synonyms.txt in docker-compose.
      synonyms_path: "analysis/synonyms.txt",
      updateable: true,
    },
  },
  normalizer: {
    severinno_sort: {
      type: "custom",
      filter: ["lowercase", "asciifolding"],
    },
  },
} as const

const PROVIDER_MAPPINGS = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    name: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
      fields: {
        keyword: { type: "keyword" },
        sort: { type: "keyword", normalizer: "severinno_sort" },
      },
    },
    email: { type: "keyword" },
    bio: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
    },
    city: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
      fields: {
        keyword: { type: "keyword" },
      },
    },
    state: { type: "keyword" },
    district: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
    },
    role: { type: "keyword" },
    verified: { type: "boolean" },
    active: { type: "boolean" },
    // Geo-point for distance queries
    location: { type: "geo_point" },
    rating: { type: "float" },
    reviewCount: { type: "integer" },
    completedBookings: { type: "integer" },
    serviceTitles: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
      // Boosts: service titles are more relevant than bio/name
      boost: 2.0,
    },
    serviceCategories: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
    },
    createdAt: { type: "date" },
  },
} as const

const SERVICE_MAPPINGS = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    providerId: { type: "keyword" },
    providerName: { type: "keyword" },
    title: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
      fields: {
        keyword: { type: "keyword" },
      },
      boost: 3.0,
    },
    description: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
    },
    categoryName: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
    },
    basePrice: { type: "float" },
    unit: { type: "keyword" },
    active: { type: "boolean" },
    createdAt: { type: "date" },
  },
} as const

const CATEGORY_MAPPINGS = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    name: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
      fields: {
        keyword: { type: "keyword" },
        sort: { type: "keyword", normalizer: "severinno_sort" },
      },
    },
    slug: { type: "keyword" },
    description: {
      type: "text",
      analyzer: "severinno_index",
      search_analyzer: "severinno_search",
    },
    level: { type: "byte" },
    parentId: { type: "keyword" },
    icon: { type: "keyword" },
    order: { type: "byte" },
    active: { type: "boolean" },
  },
} as const

// ============================================================================
// Index management
// ============================================================================

export async function ensureIndices(): Promise<void> {
  const client = getClient()
  if (!client) {
    logger.warn("OpenSearch client unavailable — skipping index creation")
    return
  }

  const indexConfigs = [
    { name: INDICES.PROVIDERS, mappings: PROVIDER_MAPPINGS },
    { name: INDICES.SERVICES, mappings: SERVICE_MAPPINGS },
    { name: INDICES.CATEGORIES, mappings: CATEGORY_MAPPINGS },
  ]

  for (const { name, mappings } of indexConfigs) {
    const exists = await client.indices.exists({ index: name })
    if (!exists.body) {
      await client.indices.create({
        index: name,
        body: {
          settings: {
            index: {
              number_of_shards: 1,
              number_of_replicas: process.env.NODE_ENV === "production" ? 1 : 0,
              analysis: SHARED_ANALYSIS as unknown as Record<string, unknown>,
            },
          },
          mappings,
        },
      })
      logger.info({ index: name }, "Created OpenSearch index")
    }
  }
}

export async function deleteIndices(): Promise<void> {
  const client = getClient()
  if (!client) return
  for (const index of Object.values(INDICES)) {
    const exists = await client.indices.exists({ index })
    if (exists?.body) {
      await client.indices.delete({ index })
      logger.info({ index }, "Deleted OpenSearch index")
    }
  }
}

// ============================================================================
// Search helpers
// ============================================================================

export interface SearchProviderHit {
  id: string
  name: string
  email: string
  bio: string | null
  city: string | null
  state: string | null
  district: string | null
  verified: boolean
  location: { lat: number; lon: number } | null
  rating: number
  reviewCount: number
  completedBookings: number
  serviceTitles: string[]
  serviceCategories: string[]
  createdAt: string
  _score?: number
}

export interface SearchServiceHit {
  id: string
  providerId: string
  providerName: string
  title: string
  description: string
  categoryName: string
  basePrice: number
  unit: string
  active: boolean
  createdAt: string
  _score?: number
}

export interface SearchProviderParams {
  q?: string
  categoryId?: string
  lat?: number
  lng?: number
  radiusKm?: number
  sort?: "rating" | "distance" | "relevance"
  page?: number
  limit?: number
}

export interface SearchResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
  took: number
}

/**
 * Search providers by text query + optional filters.
 * Returns results sorted by relevance (BM25), distance, or rating.
 */
export async function searchProviders(
  params: SearchProviderParams,
): Promise<SearchResult<SearchProviderHit>> {
  const client = getClient()
  const page = params.page ?? 1
  const limit = Math.min(50, params.limit ?? 20)
  const from = (page - 1) * limit

  if (!client) {
    return { items: [], total: 0, page, limit, took: 0 }
  }

  const must: Record<string, unknown>[] = [
    { term: { role: "PROVIDER" } },
    { term: { active: true } },
  ]

  // ── Text query (multi-field with boosting) ──
  if (params.q) {
    must.push({
      multi_match: {
        query: params.q,
        fields: ["name^3", "serviceTitles^2", "bio", "city", "district", "serviceCategories"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    })
  }

  // ── Category filter ──
  if (params.categoryId) {
    must.push({ term: { serviceCategories: params.categoryId } })
  }

  // ── Geo filter ──
  const hasGeo =
    params.lat !== undefined && params.lng !== undefined && params.radiusKm !== undefined

  const filter: Record<string, unknown>[] = []

  if (hasGeo && params.radiusKm! > 0) {
    filter.push({
      geo_distance: {
        distance: `${params.radiusKm}km`,
        location: { lat: params.lat!, lon: params.lng! },
      },
    })
  }

  // ── Sort ──
  const sort: Record<string, unknown>[] = []

  if (params.sort === "distance" && hasGeo) {
    sort.push({
      _geo_distance: {
        location: { lat: params.lat!, lon: params.lng! },
        order: "asc",
        unit: "km",
      },
    })
    sort.push({ rating: { order: "desc" } })
  } else if (params.sort === "rating") {
    sort.push({ rating: { order: "desc" } })
    if (hasGeo) {
      sort.push({
        _geo_distance: {
          location: { lat: params.lat!, lon: params.lng! },
          order: "asc",
          unit: "km",
        },
      })
    }
  } else {
    // Relevance sort — add rating tiebreaker
    sort.push({ _score: { order: "desc" } })
    sort.push({ rating: { order: "desc" } })
  }

  try {
    const response = await client.search({
      index: INDICES.PROVIDERS,
      from,
      size: limit,
      body: {
        query: {
          bool: { must, filter },
        },
        sort,
        _source: {
          excludes: ["email", "role"],
        },
      },
    })

    const body = response.body
    const total =
      typeof body.hits.total === "number" ? body.hits.total : (body.hits.total?.value ?? 0)
    const hits = body.hits.hits.map(
      (h: { _source?: Record<string, unknown>; _score?: number }) => ({
        ...h._source,
        _score: h._score,
      }),
    ) as SearchProviderHit[]

    return {
      items: hits,
      total,
      page,
      limit,
      took: body.took ?? 0,
    }
  } catch (err) {
    logger.error({ err }, "OpenSearch search error")
    return { items: [], total: 0, page, limit, took: 0 }
  }
}

/**
 * Search services by text query.
 */
export async function searchServices(
  q: string,
  page = 1,
  limit = 20,
): Promise<SearchResult<SearchServiceHit>> {
  const client = getClient()
  const from = (page - 1) * limit

  if (!client || !q) {
    return { items: [], total: 0, page, limit, took: 0 }
  }

  try {
    const response = await client.search({
      index: INDICES.SERVICES,
      from,
      size: limit,
      body: {
        query: {
          bool: {
            must: [
              { term: { active: true } },
              {
                multi_match: {
                  query: q,
                  fields: ["title^3", "description", "categoryName"],
                  fuzziness: "AUTO",
                },
              },
            ],
          },
        },
        sort: [{ _score: { order: "desc" } }],
      },
    })

    const body = response.body
    const total =
      typeof body.hits.total === "number" ? body.hits.total : (body.hits.total?.value ?? 0)

    return {
      items: body.hits.hits.map((h: { _source?: unknown }) => h._source as SearchServiceHit),
      total,
      page,
      limit,
      took: body.took ?? 0,
    }
  } catch (err) {
    logger.error({ err }, "OpenSearch service search error")
    return { items: [], total: 0, page, limit, took: 0 }
  }
}

/**
 * Index a single document (upsert).
 */
export async function indexDocument(
  index: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.index({ index, id, body, refresh: "true" })
  } catch (err) {
    logger.error({ err, index, id }, "OpenSearch index error")
  }
}

/**
 * Bulk index multiple documents.
 */
export async function bulkIndex(
  index: string,
  documents: Array<{ id: string; body: Record<string, unknown> }>,
): Promise<void> {
  const client = getClient()
  if (!client || documents.length === 0) return

  const body = documents.flatMap((doc) => [{ index: { _index: index, _id: doc.id } }, doc.body])

  try {
    const response = await client.bulk({ body, refresh: "true" })
    if (response.body.errors) {
      const errorItems = response.body.items.filter(
        (i: { index?: { error?: unknown } }) => i.index?.error,
      )
      logger.error({ errorCount: errorItems.length, index }, "Bulk index had errors")
    }
  } catch (err) {
    logger.error({ err, index }, "Bulk index error")
  }
}

/**
 * Delete a document from the index.
 */
export async function deleteDocument(index: string, id: string): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.delete({ index, id })
  } catch (err: unknown) {
    // 404 is fine (document already gone)
    if ((err as { statusCode?: number }).statusCode !== 404) {
      logger.error({ err, index, id }, "OpenSearch delete error")
    }
  }
}

/**
 * Combined full-text search across providers and services.
 * Returns merged results sorted by relevance score.
 */
export async function fullTextSearch(
  q: string,
  limit = 10,
): Promise<Array<SearchProviderHit | SearchServiceHit>> {
  const [providers, services] = await Promise.all([
    searchProviders({ q, limit, page: 1 }),
    searchServices(q, 1, limit),
  ])

  const items: Array<(SearchProviderHit | SearchServiceHit) & { _type: "provider" | "service" }> = [
    ...providers.items.map((p) => ({ ...p, _type: "provider" as const })),
    ...services.items.map((s) => ({ ...s, _type: "service" as const })),
  ]

  items.sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
  return items.slice(0, limit)
}

const searchModule = {
  getClient,
  ensureIndices,
  deleteIndices,
  searchProviders,
  searchServices,
  indexDocument,
  bulkIndex,
  deleteDocument,
  INDICES,
}

export default searchModule
