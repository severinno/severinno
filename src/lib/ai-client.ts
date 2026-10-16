/**
 * ai-client.ts — Cliente Unificado de Inteligência Artificial com Arquitetura Híbrida
 *
 * Arquitetura de 3 Camadas de Resiliência:
 * - Camada 1 (Nuvem Primária): Groq Cloud (Llama 3.3 70B / 8B em LPU a 350+ tok/s, zero CPU da VPS).
 * - Camada 2 (Local Secundária): Contêiner Ollama na VPS (Llama 3.2 3B otimizado para 2 vCPUs).
 * - Camada 3 (Heurística Determinística): Fallback de regras de domínio quando offline.
 */

import logger from "@/lib/logger"

const aiLogger =
  typeof logger?.child === "function" ? logger.child({ module: "ai-client" }) : logger

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type ChatCompletionResponse = {
  id: string
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
}

import { computeAICacheKey, getCachedAIResponse, setCachedAIResponse } from "./ai-cache"

export type AIEngineUsed = "cloud_groq" | "local_ollama" | "cache" | "fallback"

export interface HybridChatResult {
  content: string | null
  engine: AIEngineUsed
  model: string
  latencyMs: number
  cached?: boolean
}

export interface HybridChatOptions {
  preferredEngine?: "cloud" | "local" | "auto"
  cloudModel?: string
  localModel?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  useCache?: boolean
  cacheTtlSeconds?: number
}

export function getLocalAiUrl(): string {
  // Dá preferência para OLLAMA_URL, fallback para LOCALAI_URL ou localhost/docker service
  return (
    process.env.OLLAMA_URL ||
    process.env.LOCAL_AI_URL ||
    process.env.LOCALAI_URL ||
    (process.env.NODE_ENV === "production"
      ? "http://severinno-ollama:11434/v1"
      : "http://127.0.0.1:11434/v1")
  )
}

export function getCloudAiConfig(): {
  apiUrl: string
  apiKey: string | null
  defaultModel: string
} {
  const apiKey =
    process.env.GROQ_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || null

  const apiUrl = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1"

  const defaultModel = process.env.AI_MODEL || "llama-3.3-70b-versatile"

  return { apiUrl, apiKey, defaultModel }
}

/**
 * Verifica se a IA local (Ollama ou LocalAI) está online e respondendo na porta configurada.
 */
export async function isLocalAiOnline(): Promise<boolean> {
  const rawUrl = getLocalAiUrl()
  const baseHost = rawUrl.replace(/\/v1\/?$/, "")

  // 1. Tenta endpoint nativo do Ollama (/api/tags)
  try {
    const res = await fetch(`${baseHost}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) return true
  } catch {
    // Tenta fallback para readyz do LocalAI
  }

  // 2. Tenta endpoint de healthcheck do LocalAI (/readyz)
  try {
    const res = await fetch(`${baseHost}/readyz`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch (err) {
    aiLogger.debug({ err: (err as Error).message }, "Checagem de IA local falhou")
    return false
  }
}

/**
 * Chamada de inferência híbrida inteligente:
 * 1. Tenta Groq Cloud (se houver chave e engine != 'local')
 * 2. Em caso de falha/timeout, faz failover automático para o Ollama local
 */
export async function chatCompletionHybrid(
  messages: ChatMessage[],
  options: HybridChatOptions = {},
): Promise<HybridChatResult> {
  const {
    preferredEngine = "auto",
    cloudModel,
    localModel = "llama3.2:3b",
    temperature = 0.2,
    maxTokens = 600,
    timeoutMs = 6000,
  } = options

  const start = Date.now()
  const cloudConfig = getCloudAiConfig()

  // ── Etapa 0: Checagem de Cache Semântico (Redis) ─────────────────────────────
  const useCache = options.useCache !== false
  const activeModel = cloudModel || cloudConfig.defaultModel
  const cacheKey = useCache ? computeAICacheKey(messages, activeModel, temperature) : null

  if (useCache && cacheKey) {
    const cached = await getCachedAIResponse(cacheKey)
    if (cached) {
      return {
        content: cached.content,
        engine: "cache",
        model: cached.model,
        latencyMs: Date.now() - start,
        cached: true,
      }
    }
  }

  // ── Etapa 1: Tentativa Cloud (Groq) ─────────────────────────────────────────
  if (preferredEngine !== "local" && cloudConfig.apiKey) {
    const modelToUse = cloudModel || cloudConfig.defaultModel
    const cloudUrl = `${cloudConfig.apiUrl.replace(/\/$/, "")}/chat/completions`

    try {
      const res = await fetch(cloudUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cloudConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: modelToUse,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (res.ok) {
        const data = (await res.json()) as ChatCompletionResponse
        const content = data.choices?.[0]?.message?.content ?? null
        if (content) {
          if (useCache && cacheKey) {
            await setCachedAIResponse(cacheKey, content, modelToUse, options.cacheTtlSeconds)
          }
          return {
            content,
            engine: "cloud_groq",
            model: modelToUse,
            latencyMs: Date.now() - start,
          }
        }
      } else {
        aiLogger.warn(
          { status: res.status, url: cloudUrl },
          "Falha na IA Cloud — acionando contingência local...",
        )
      }
    } catch (err) {
      aiLogger.warn(
        { err: (err as Error).message },
        "Timeout ou erro na IA Cloud — acionando contingência local...",
      )
    }
  }

  // ── Etapa 2: Contingência Local (Ollama) ─────────────────────────────────────
  const localUrl = `${getLocalAiUrl().replace(/\/$/, "")}/chat/completions`

  try {
    const res = await fetch(localUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: localModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(30_000), // Em CPU local pode levar alguns segundos
    })

    if (res.ok) {
      const data = (await res.json()) as ChatCompletionResponse
      const content = data.choices?.[0]?.message?.content ?? null
      if (content) {
        if (useCache && cacheKey) {
          await setCachedAIResponse(cacheKey, content, localModel, options.cacheTtlSeconds)
        }
        return {
          content,
          engine: "local_ollama",
          model: localModel,
          latencyMs: Date.now() - start,
        }
      }
    } else {
      aiLogger.warn({ status: res.status }, "Falha na resposta da IA Local Ollama")
    }
  } catch (err) {
    aiLogger.warn({ err: (err as Error).message }, "Falha na requisição da IA Local Ollama")
  }

  // ── Etapa 3: Falha total (ambas indisponíveis) ───────────────────────────────
  return {
    content: null,
    engine: "fallback",
    model: "none",
    latencyMs: Date.now() - start,
  }
}

/**
 * Chamada compatível com a assinatura legada do sistema.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  model?: string,
): Promise<string | null> {
  const result = await chatCompletionHybrid(messages, {
    cloudModel: model,
    localModel: model || "llama3.2:3b",
  })
  return result.content
}
