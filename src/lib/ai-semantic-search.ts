/**
 * ai-semantic-search.ts — Motor de Busca Semântica e Embeddings Vetoriais
 *
 * Permite que clientes e prestadores pesquisem no catálogo de serviços utilizando
 * linguagem natural coloquial (ex: "minha pia tá vazando pelo sifão", "disjuntor desarmando",
 * "parede descascando com mofo").
 *
 * Arquitetura Híbrida de 3 Camadas Vetoriais:
 * 1. Camada Neural (Ollama / LocalAI / OpenAI /v1/embeddings): Embeddings densos quando online.
 * 2. Camada Vetorial Determinística (Local TF-IDF & Subword N-Grams): Vetorização semântica
 *    em 128 dimensões com ancoragem semântica de domínio em Português (zero custo, 0ms, offline).
 * 3. Cache Vetorial no Redis: Armazena vetores pré-computados com TTL para busca sub-milissegundo.
 */

import crypto from "node:crypto"
import { db } from "@/lib/db"
import { cacheGet, cacheSet } from "@/lib/redis"
import { getLocalAiUrl } from "@/lib/ai-client"
import logger from "@/lib/logger"
import { toMoneyNumber } from "@/lib/money"

const log =
  typeof logger?.child === "function" ? logger.child({ module: "ai-semantic-search" }) : logger

export interface SemanticSearchResult {
  serviceId: string
  title: string
  categoryName: string
  description: string
  basePrice: number
  similarityScore: number
  matchType: "neural_vector" | "sparse_semantic" | "hybrid"
  providerId: string
  providerName: string
  providerRating?: number
}

export interface SemanticSearchOptions {
  limit?: number
  minScore?: number
  categoryId?: string
  city?: string
  useCache?: boolean
  cacheTtlSeconds?: number
}

export const VECTOR_DIMENSION = 128

// ---------------------------------------------------------------------------
// Âncoras Semânticas de Domínio para Serviços Residenciais (PT-BR)
// ---------------------------------------------------------------------------

const DOMAIN_SEMANTIC_ANCHORS: Record<string, string[]> = {
  eletrica: [
    "eletricista",
    "fio",
    "tomada",
    "disjuntor",
    "curto",
    "circuito",
    "luz",
    "lampada",
    "apagao",
    "quadro",
    "energia",
    "chuveiro",
    "resistencia",
    "voltagem",
    "110v",
    "220v",
    "fase",
    "neutro",
    "aterramento",
    "choque",
    "cabeamento",
  ],
  hidraulica: [
    "encanador",
    "vazamento",
    "cano",
    "pia",
    "torneira",
    "sifao",
    "ralo",
    "vaso",
    "descarga",
    "esgoto",
    "desentupir",
    "infiltracao",
    "registro",
    "pressao",
    "agua",
    "caixa",
    "valvula",
    "pingando",
    "canamento",
    "tubulacao",
  ],
  chaveiro: [
    "chaveiro",
    "fechadura",
    "tranca",
    "chave",
    "tetra",
    "cadeado",
    "abertura",
    "copia",
    "trancado",
    "porta",
    "portao",
    "miolo",
    "cilindro",
    "biometria",
    "digital",
    "segredo",
  ],
  pintura: [
    "pintor",
    "pintura",
    "tinta",
    "parede",
    "massa",
    "corrida",
    "verniz",
    "textura",
    "lixar",
    "mofo",
    "descascando",
    "rolo",
    "pincel",
    "esmalte",
    "acrilica",
    "teto",
    "fachada",
  ],
  refrigeracao: [
    "ar",
    "condicionado",
    "split",
    "inverter",
    "gas",
    "geladeira",
    "congelador",
    "freezer",
    "refrigeracao",
    "limpeza",
    "higienizacao",
    "termotanque",
    "btu",
    "evaporadora",
    "condensadora",
  ],
  marcenaria: [
    "montador",
    "moveis",
    "guarda",
    "roupa",
    "armario",
    "marceneiro",
    "madeira",
    "gaveta",
    "dobradica",
    "puxador",
    "cama",
    "mesa",
    "painel",
    "furadeira",
    "parafuso",
  ],
  limpeza: [
    "faxina",
    "diarista",
    "limpeza",
    "pos",
    "obra",
    "pesada",
    "higienizacao",
    "sofa",
    "estofado",
    "vidro",
    "carpete",
    "faxineira",
    "organizacao",
  ],
  alvenaria: [
    "pedreiro",
    "reforma",
    "piso",
    "porcelanato",
    "azulejo",
    "reboco",
    "cimento",
    "argamassa",
    "parede",
    "telhado",
    "calha",
    "goteira",
    "tijolo",
    "demolicao",
  ],
}

/**
 * Normaliza um texto para extração de tokens semânticos:
 * minúsculas, sem acentos, sem pontuações descartáveis.
 */
export function normalizeSemanticText(text: string): string {
  if (!text) return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Hash determinístico FNV-1a para indexação de dimensões vetoriais.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Normaliza um vetor para norma euclidiana unitária L2 (||v|| = 1).
 */
export function normalizeL2Vector(vector: number[]): number[] {
  let sumSquares = 0
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i]
  }

  const magnitude = Math.sqrt(sumSquares)
  if (magnitude === 0) return vector

  const normalized = new Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = Math.round((vector[i] / magnitude) * 10000) / 10000
  }
  return normalized
}

/**
 * Gera um embedding vetorial semântico determinístico de 128 dimensões
 * combinando n-gramas subpalavra com ponderação por âncoras temáticas.
 */
export function generateDeterministicSemanticVector(text: string): number[] {
  const normalized = normalizeSemanticText(text)
  const vector = new Array(VECTOR_DIMENSION).fill(0)
  if (!normalized) return vector

  const tokens = normalized.split(" ").filter((t) => t.length >= 2)

  // 1. Ponderação por âncoras semânticas de domínio (alta relevância)
  const anchorEntries = Object.entries(DOMAIN_SEMANTIC_ANCHORS)
  anchorEntries.forEach(([category, terms], catIdx) => {
    let matchCount = 0
    for (const token of tokens) {
      if (terms.some((term) => token.includes(term) || term.includes(token))) {
        matchCount++
      }
    }

    if (matchCount > 0) {
      const baseDim = (catIdx * 8) % VECTOR_DIMENSION
      const weight = 2.5 * Math.log2(1 + matchCount)
      for (let offset = 0; offset < 6; offset++) {
        const dim = (baseDim + offset) % VECTOR_DIMENSION
        vector[dim] += weight * (1 - offset * 0.12)
      }
    }
  })

  // 2. Projeção de n-gramas de subpalavras (3-grams e 4-grams)
  for (const token of tokens) {
    // Termo completo
    const tokenDim = fnv1a(token) % VECTOR_DIMENSION
    vector[tokenDim] += 1.8

    // Trigramas
    for (let i = 0; i <= token.length - 3; i++) {
      const trigram = token.slice(i, i + 3)
      const dim = fnv1a(trigram) % VECTOR_DIMENSION
      vector[dim] += 0.6
    }

    // 4-gramas
    for (let i = 0; i <= token.length - 4; i++) {
      const tetragram = token.slice(i, i + 4)
      const dim = fnv1a(tetragram) % VECTOR_DIMENSION
      vector[dim] += 0.8
    }
  }

  return normalizeL2Vector(vector)
}

/**
 * Calcula a similaridade de cosseno entre dois vetores:
 * cos(theta) = (A . B) / (||A|| * ||B||)
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0
  const length = Math.min(vecA.length, vecB.length)

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  const sim = dotProduct / denominator
  return Math.max(0, Math.min(1, Math.round(sim * 10000) / 10000))
}

/**
 * Tenta obter embeddings neurais via API Ollama/LocalAI/OpenAI com fallback determinístico.
 */
export async function computeEmbedding(text: string): Promise<{
  vector: number[]
  source: "neural" | "deterministic"
}> {
  const normalized = normalizeSemanticText(text)
  if (!normalized) {
    return { vector: new Array(VECTOR_DIMENSION).fill(0), source: "deterministic" }
  }

  // Checa cache de embeddings no Redis
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24)
  const cacheKey = `ai:embed:v1:${hash}`

  try {
    const cached = await cacheGet<number[]>(cacheKey)
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return { vector: cached, source: "neural" }
    }
  } catch {
    // Fallback silencioso de cache
  }

  // Tenta API neural local (Ollama /v1/embeddings) com timeout estrito de 2s
  const localUrl = `${getLocalAiUrl().replace(/\/$/, "")}/embeddings`
  try {
    const res = await fetch(localUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        input: normalized,
      }),
      signal: AbortSignal.timeout(2000),
    })

    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ embedding: number[] }>
        embedding?: number[]
      }
      const rawVector = data.data?.[0]?.embedding || data.embedding
      if (Array.isArray(rawVector) && rawVector.length > 0) {
        const normalizedVec = normalizeL2Vector(rawVector)
        await cacheSet(cacheKey, normalizedVec, 86400 * 7).catch(() => {})
        return { vector: normalizedVec, source: "neural" }
      }
    }
  } catch {
    // API neural offline ou modelo não instalado — usa contingência determinística
  }

  const deterministicVec = generateDeterministicSemanticVector(normalized)
  await cacheSet(cacheKey, deterministicVec, 86400 * 3).catch(() => {})
  return { vector: deterministicVec, source: "deterministic" }
}

/**
 * Executa busca semântica inteligente sobre o catálogo de serviços ativos da plataforma.
 */
export async function searchSemanticCatalog(
  query: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticSearchResult[]> {
  const { limit = 8, minScore = 0.28, categoryId, city, useCache = true } = options

  const cleanQuery = normalizeSemanticText(query)
  if (!cleanQuery) return []

  // Cache de resultados de busca frequentes no Redis
  const queryHash = crypto
    .createHash("sha256")
    .update(`${cleanQuery}:${categoryId || "all"}:${city || "all"}`)
    .digest("hex")
    .slice(0, 24)
  const searchCacheKey = `ai:search:sem:v1:${queryHash}`

  if (useCache) {
    try {
      const cached = await cacheGet<SemanticSearchResult[]>(searchCacheKey)
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached.slice(0, limit)
      }
    } catch {
      // Segue para execução
    }
  }

  // 1. Gera embedding da consulta
  const { vector: queryVec, source } = await computeEmbedding(cleanQuery)

  // 2. Consulta serviços ativos no banco de dados
  const services = await db.service.findMany({
    where: {
      active: true,
      deletedAt: null,
      ...(categoryId ? { categoryId } : {}),
      ...(city
        ? {
            provider: {
              city: { equals: city, mode: "insensitive" },
              active: true,
            },
          }
        : {
            provider: { active: true },
          }),
    },
    select: {
      id: true,
      title: true,
      description: true,
      basePrice: true,
      categoryId: true,
      category: { select: { name: true } },
      providerId: true,
      provider: { select: { name: true, avgRating: true } },
    },
    take: 120, // Amostra de alto desempenho para ranqueamento
  })

  if (!services.length) return []

  // 3. Ranqueamento por similaridade vetorial de cosseno
  const scoredResults: SemanticSearchResult[] = []

  for (const svc of services) {
    const serviceContent = `${svc.title} ${svc.category.name} ${svc.description}`
    const svcVector = generateDeterministicSemanticVector(serviceContent)
    const score = cosineSimilarity(queryVec, svcVector)

    if (score >= minScore) {
      scoredResults.push({
        serviceId: svc.id,
        title: svc.title,
        categoryName: svc.category.name,
        description: svc.description,
        basePrice: toMoneyNumber(svc.basePrice),
        similarityScore: score,
        matchType: source === "neural" ? "neural_vector" : "sparse_semantic",
        providerId: svc.providerId,
        providerName: svc.provider.name,
        providerRating: Number(svc.provider.avgRating) || 5.0,
      })
    }
  }

  // Ordena por score decrescente
  scoredResults.sort((a, b) => b.similarityScore - a.similarityScore)
  const finalResults = scoredResults.slice(0, limit)

  // Salva no cache com TTL de 30 minutos
  if (finalResults.length > 0) {
    cacheSet(searchCacheKey, finalResults, options.cacheTtlSeconds || 1800).catch(() => {})
  }

  return finalResults
}
