/**
 * ai-cache.ts — Cache Semântico e Normalizado de Respostas de IA no Redis
 *
 * Evita chamadas redundantes a APIs de nuvem (Groq Cloud) e alivia a CPU/RAM
 * do contêiner Ollama na VPS, respondendo em < 3ms para consultas idênticas
 * ou semanticamente equivalentes (FAQ, triagem de categorias e orçamentos recorrentes).
 */

import crypto from "node:crypto"
import { cacheGet, cacheSet } from "@/lib/redis"
import type { ChatMessage } from "./ai-client"

export interface CachedAIResult {
  content: string
  model: string
  cachedAt: number
}

export interface AICacheMetrics {
  hits: number
  misses: number
  total: number
  hitRatio: number
}

let cacheHits = 0
let cacheMisses = 0

/**
 * Normaliza o texto de um prompt para maximizar o cache hit rate:
 * - Converte para minúsculas
 * - Remove acentos e diacríticos (ex: "elétrica" -> "eletrica")
 * - Remove pontuações descartáveis e múltiplos espaços
 */
export function normalizePromptText(text: string): string {
  if (!text) return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\w\s]/gi, " ") // substitui pontuações por espaço
    .replace(/\s+/g, " ") // colapsa espaços múltiplos
    .trim()
}

/**
 * Gera uma chave determinística SHA-256 baseada nas mensagens normalizadas e parâmetros.
 */
export function computeAICacheKey(
  messages: ChatMessage[],
  model: string,
  temperature: number = 0.2,
): string {
  const canonicalPayload = messages
    .map((m) => `${m.role}:${normalizePromptText(m.content)}`)
    .join("||")

  // Arredonda a temperatura para 1 casa decimal para agrupar variações sutis
  const roundedTemp = Math.round(temperature * 10) / 10
  const rawKey = `${model}:${roundedTemp}:${canonicalPayload}`

  const hash = crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 32)
  return `ai:cache:v1:${hash}`
}

/**
 * Busca uma resposta em cache no Redis ou memória.
 */
export async function getCachedAIResponse(cacheKey: string): Promise<CachedAIResult | null> {
  try {
    const cached = await cacheGet<CachedAIResult>(cacheKey)
    if (cached && cached.content) {
      cacheHits++
      return cached
    }
  } catch {
    // Falha silenciosa em caso de indisponibilidade de cache
  }

  cacheMisses++
  return null
}

/**
 * Armazena a resposta de IA no cache com TTL (padrão: 2 horas = 7200s).
 */
export async function setCachedAIResponse(
  cacheKey: string,
  content: string,
  model: string,
  ttlSeconds: number = 7200,
): Promise<void> {
  if (!content) return

  try {
    await cacheSet(
      cacheKey,
      {
        content,
        model,
        cachedAt: Date.now(),
      },
      ttlSeconds,
    )
  } catch {
    // Falha silenciosa para não quebrar o fluxo principal
  }
}

/**
 * Retorna as métricas operacionais de hit/miss do cache de IA.
 */
export function getAICacheMetrics(): AICacheMetrics {
  const total = cacheHits + cacheMisses
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRatio: total > 0 ? Math.round((cacheHits / total) * 100) / 100 : 0,
  }
}

/**
 * Reseta os contadores para isolamento em testes unitários.
 */
export function resetAICacheMetrics(): void {
  cacheHits = 0
  cacheMisses = 0
}
