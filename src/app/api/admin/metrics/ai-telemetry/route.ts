export const dynamic = "force-dynamic"

/**
 * GET /api/admin/metrics/ai-telemetry
 *
 * Telemetria executiva e técnica da infraestrutura de Inteligência Artificial:
 * - Status e latência do motor local (Ollama / LocalAI na VPS)
 * - Configuração e disponibilidade do provedor Cloud (Groq Cloud Llama 3.3 70B)
 * - Métricas do Semantic Cache em Redis (Hits, Misses, Hit Ratio, Economia de Tokens e Custo)
 * - Parâmetros do Motor de Busca Semântica Vetorial (128 dimensões, âncoras temáticas)
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { checkLocalAiHealth, getCloudAiConfig } from "@/lib/ai-client"
import { getAICacheMetrics } from "@/lib/ai-cache"
import { VECTOR_DIMENSION } from "@/lib/ai-semantic-search"

export const GET = withRoute("api.admin.metrics.ai-telemetry.GET", async () => {
  await requireRole("ADMIN")

  const [localAi, cloudAiConfig] = await Promise.all([
    checkLocalAiHealth(),
    Promise.resolve(getCloudAiConfig()),
  ])

  const cacheMetrics = getAICacheMetrics()

  // Estimativa de tokens economizados: ~450 tokens por requisição em cache
  // Custo base de referência: Llama 3.3 70B Cloud (~$0.79 / milhão de tokens)
  const estimatedTokensSaved = cacheMetrics.hits * 450
  const estimatedCostSavedUsd = Number(((estimatedTokensSaved / 1_000_000) * 0.79).toFixed(4))

  const telemetry = {
    timestamp: new Date().toISOString(),
    localAi: {
      status: localAi.status,
      latencyMs: localAi.latencyMs,
      engine: localAi.engine,
      models: localAi.models,
      details: localAi.details,
    },
    cloudAi: {
      status: cloudAiConfig.apiKey ? "CONFIGURED" : "NOT_CONFIGURED",
      provider: "Groq Cloud LPU",
      model: cloudAiConfig.defaultModel,
      endpointConfigured: Boolean(cloudAiConfig.apiUrl),
    },
    semanticCache: {
      hits: cacheMetrics.hits,
      misses: cacheMetrics.misses,
      totalQueries: cacheMetrics.total,
      hitRatioPercent: Number((cacheMetrics.hitRatio * 100).toFixed(1)),
      estimatedTokensSaved,
      estimatedCostSavedUsd,
    },
    semanticSearch: {
      engine: "VectorCosineHybrid",
      vectorDimension: VECTOR_DIMENSION,
      indexingAnchors: 8,
      status: "ONLINE",
    },
  }

  return NextResponse.json({
    ok: true,
    data: telemetry,
  })
})
