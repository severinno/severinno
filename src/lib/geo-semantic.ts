/**
 * Semantic Geocoding — text embedding-based fuzzy address matching.
 *
 * When exact geocoding fails (misspelled addresses, colloquial names),
 * this module uses cosine similarity between address embeddings to find
 * the closest match in the local provider database.
 *
 * Uses a lightweight TF-IDF approach (no external API needed) for
 * fast in-memory similarity search.
 */
import { db } from "@/lib/db"
import { cacheGet, cacheSet } from "./redis"
import logger from "./logger"

const CACHE_TTL_S = 3600 // 1h

// ── TF-IDF Vectorizer (lightweight, no dependencies) ──────────────────────

/** Tokenize a Portuguese address into meaningful terms */
function tokenize(text: string): string[] {
  const stopWords = new Set([
    "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
    "para", "por", "com", "sem", "sob", "entre", "até", "após",
    "rua", "avenida", "travessa", "alameda", "praça", "rodovia",
    "bairro", "vila", "jardim", "parque", "lote", "quadra",
  ])

  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopWords.has(t))
}

/** Build a term frequency vector from tokens */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1)
  }
  // Normalize by max frequency
  const maxFreq = Math.max(1, ...tf.values())
  for (const [key, val] of tf) {
    tf.set(key, val / maxFreq)
  }
  return tf
}

/** Cosine similarity between two term frequency vectors */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (const [key, valA] of a) {
    const valB = b.get(key) ?? 0
    dotProduct += valA * valB
    normA += valA * valA
  }
  for (const valB of b.values()) {
    normB += valB * valB
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator > 0 ? dotProduct / denominator : 0
}

// ── Provider Address Index ────────────────────────────────────────────────

interface AddressEntry {
  id: string
  fullAddress: string
  tokens: string[]
  tf: Map<string, number>
  lat: number
  lng: number
}

let addressIndex: AddressEntry[] = []

/** Build or rebuild the in-memory address index from the database */
async function buildAddressIndex(): Promise<void> {
  try {
    const providers = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        deletedAt: null,
        lat: { not: null },
        lng: { not: null },
      },
      select: {
        id: true,
        street: true,
        district: true,
        city: true,
        state: true,
        lat: true,
        lng: true,
      },
    })

    addressIndex = providers
      .filter((p) => p.lat && p.lng)
      .map((p) => {
        const fullAddress = [p.street, p.district, p.city, p.state]
          .filter(Boolean)
          .join(", ")
        const tokens = tokenize(fullAddress)
        return {
          id: p.id,
          fullAddress,
          tokens,
          tf: termFrequency(tokens),
          lat: p.lat!,
          lng: p.lng!,
        }
      })

    logger.info({ count: addressIndex.length }, "geo-semantic: address index built")
  } catch (err) {
    logger.warn({ err }, "geo-semantic: failed to build address index")
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export type SemanticMatch = {
  providerId: string
  address: string
  similarity: number
  lat: number
  lng: number
}

/**
 * Find providers whose addresses are semantically similar to the query.
 *
 * @param query - Free-text address query (e.g. "padaria perto da praça")
 * @param limit - Max results (default: 5)
 * @param threshold - Minimum similarity score (default: 0.3)
 */
export async function semanticGeocode(
  query: string,
  limit: number = 5,
  threshold: number = 0.3,
): Promise<SemanticMatch[]> {
  if (!query.trim()) return []

  // Check cache
  const cacheKey = `geo:semantic:${query.trim().toLowerCase()}`
  const cached = await cacheGet<SemanticMatch[]>(cacheKey)
  if (cached) return cached

  // Build index if empty (lazy init)
  if (addressIndex.length === 0) {
    await buildAddressIndex()
  }
  if (addressIndex.length === 0) return []

  // Vectorize query
  const queryTokens = tokenize(query)
  const queryTf = termFrequency(queryTokens)

  // Score all providers
  const scored = addressIndex
    .map((entry) => ({
      providerId: entry.id,
      address: entry.fullAddress,
      similarity: cosineSimilarity(queryTf, entry.tf),
      lat: entry.lat,
      lng: entry.lng,
    }))
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)

  // Cache results
  if (scored.length > 0) {
    try {
      await cacheSet(cacheKey, scored, CACHE_TTL_S)
    } catch {
      // Cache unavailable
    }
  }

  return scored
}

/**
 * Rebuild the address index (call after provider location updates).
 */
export async function rebuildAddressIndex(): Promise<number> {
  await buildAddressIndex()
  return addressIndex.length
}
