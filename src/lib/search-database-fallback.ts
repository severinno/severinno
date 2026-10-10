import "server-only"
import { db } from "@/lib/db"
import { fuzzySearchCatalog, removeAccents } from "@/lib/fuzzy-search"
import type { SearchResult, SearchServiceHit } from "./search"
import logger from "./logger"

/**
 * Intelligent Database Full-Text Search with Brazilian Portuguese Stemming & Synonyms.
 *
 * Used as a zero-downtime, high-performance database fallback when OpenSearch
 * is offline or in development environments without external cluster dependencies.
 */
export async function searchServicesDatabase(
  query: string,
  page = 1,
  limit = 20,
): Promise<SearchResult<SearchServiceHit>> {
  const startTime = performance.now()
  const q = query.trim()

  if (!q) {
    return { items: [], total: 0, page, limit, took: 0 }
  }

  try {
    // 1. Expand query terms using fuzzy catalog synonyms
    const matchedFuzzy = fuzzySearchCatalog(q, undefined, 0.35)
    const expandedTerms = new Set<string>()

    // Add individual terms from user query
    for (const term of q.split(/\s+/)) {
      if (term.length >= 2) expandedTerms.add(removeAccents(term))
    }

    // Add synonym tags from matching categories
    for (const match of matchedFuzzy) {
      if (match.item.tags) {
        for (const tag of match.item.tags) {
          expandedTerms.add(removeAccents(tag))
        }
      }
    }

    // Limit expanded terms to at most 5 to prevent combinatorial SQL ILIKE explosion
    // that triggers severe sequential scan CPU spikes on PostgreSQL under load.
    const termArray = Array.from(expandedTerms).slice(0, 5)
    const skip = (page - 1) * limit

    const whereClause = {
      active: true,
      OR: [
        { title: { contains: q, mode: "insensitive" as const } },
        ...termArray.map((t) => ({ title: { contains: t, mode: "insensitive" as const } })),
        ...termArray.map((t) => ({
          description: { contains: t, mode: "insensitive" as const },
        })),
        ...termArray.map((t) => ({
          category: { name: { contains: t, mode: "insensitive" as const } },
        })),
      ],
    }

    // 2. Query Prisma with case-insensitive matches across title, description & category
    const [services, total] = await Promise.all([
      db.service.findMany({
        where: whereClause,
        include: {
          category: { select: { name: true } },
          provider: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: Math.min(Math.max(limit, 1), 50),
      }),
      db.service.count({
        where: whereClause,
      }),
    ])

    // 3. Map to SearchServiceHit with relevance scoring
    const items: SearchServiceHit[] = services.map((s) => {
      let score = 0.5
      const cleanTitle = removeAccents(s.title)
      const cleanQ = removeAccents(q)

      if (cleanTitle === cleanQ) {
        score = 1.0
      } else if (cleanTitle.includes(cleanQ)) {
        score = 0.85
      } else if (termArray.some((t) => cleanTitle.includes(t))) {
        score = 0.7
      }

      return {
        id: s.id,
        providerId: s.providerId,
        providerName: s.provider.name,
        title: s.title,
        description: s.description || "",
        categoryName: s.category?.name || "Geral",
        basePrice: Number(s.basePrice),
        unit: s.unit || "serviço",
        active: s.active,
        createdAt: s.createdAt.toISOString(),
        _score: score,
      }
    })

    // Sort by relevance score descending
    items.sort((a, b) => (b._score ?? 0) - (a._score ?? 0))

    const took = Math.round(performance.now() - startTime)
    return {
      items,
      total,
      page,
      limit,
      took,
    }
  } catch (err) {
    logger.warn({ err, q }, "Database service search fallback failed")
    const took = Math.round(performance.now() - startTime)
    return { items: [], total: 0, page, limit, took }
  }
}
