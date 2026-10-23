import { ensureConnected, activeTier } from "@/lib/redis"
import type { Redis, Cluster } from "ioredis"

export interface RedisMemoryStats {
  usedMemoryBytes: number
  usedMemoryHuman: string
  usedMemoryPeakHuman: string
  maxMemoryBytes: number
  maxMemoryHuman: string
  maxMemoryPolicy: string
  memFragmentationRatio: number
  memoryPressurePct: number
  evictedKeys: number
  expiredKeys: number
  keyspaceHits: number
  keyspaceMisses: number
}

export interface NoTtlKeyInfo {
  key: string
  prefix: string
  ttl: number
}

export interface RedisMemoryGuardReport {
  timestamp: string
  status: "HEALTHY" | "WARNING" | "CRITICAL"
  activeTier: string
  memory: RedisMemoryStats | null
  sampleSize: number
  noTtlKeysCount: number
  noTtlRatioPct: number
  noTtlKeysByPrefix: Record<string, number>
  dangerousKeys: string[]
  warnings: string[]
  recommendations: string[]
}

/**
 * Faz parse de seções do comando INFO do Redis (ex: INFO memory, INFO stats).
 */
export function parseInfoSection(infoStr: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = infoStr.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf(":")
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      result[key] = val
    }
  }
  return result
}

/**
 * Sentinela de memória e chaves sem TTL do Redis.
 * Usa SCAN não-bloqueante para auditoria segura sem parar o event loop do Redis.
 */
export async function checkRedisMemoryGuard(
  customClient?: Redis | Cluster | null,
): Promise<RedisMemoryGuardReport> {
  const timestamp = new Date().toISOString()
  const warnings: string[] = []
  const recommendations: string[] = []

  let client = customClient !== undefined ? customClient : null
  if (client === null && customClient === undefined) {
    try {
      client = await ensureConnected()
    } catch {
      // Falha ao conectar
    }
  }

  const currentTier = activeTier

  if (!client || currentTier === "memory") {
    return {
      timestamp,
      status: "WARNING",
      activeTier: currentTier || "memory",
      memory: null,
      sampleSize: 0,
      noTtlKeysCount: 0,
      noTtlRatioPct: 0,
      noTtlKeysByPrefix: {},
      dangerousKeys: [],
      warnings: ["Redis operando em fallback de memória local. Memória volátil por processo."],
      recommendations: ["Verificar conectividade com o container Redis/Valkey na porta 6379."],
    }
  }

  let memoryStats: RedisMemoryStats | null = null
  const sampleKeys: string[] = []
  const noTtlKeys: NoTtlKeyInfo[] = []
  const noTtlKeysByPrefix: Record<string, number> = {}

  try {
    // 1. Coleta INFO memory e INFO stats
    const rawMemory = await client.info("memory")
    const rawStats = await client.info("stats")

    const parsedMemory = parseInfoSection(rawMemory)
    const parsedStats = parseInfoSection(rawStats)

    const usedBytes = Number(parsedMemory.used_memory) || 0
    const maxBytes = Number(parsedMemory.maxmemory) || 0
    const policy = parsedMemory.maxmemory_policy || "allkeys-lru"
    const fragRatio = Number(parsedMemory.mem_fragmentation_ratio) || 1.0

    const pressurePct = maxBytes > 0 ? Number(((usedBytes / maxBytes) * 100).toFixed(1)) : 0

    const evictedKeys = Number(parsedStats.evicted_keys) || 0
    const expiredKeys = Number(parsedStats.expired_keys) || 0
    const hits = Number(parsedStats.keyspace_hits) || 0
    const misses = Number(parsedStats.keyspace_misses) || 0

    memoryStats = {
      usedMemoryBytes: usedBytes,
      usedMemoryHuman: parsedMemory.used_memory_human || "0B",
      usedMemoryPeakHuman: parsedMemory.used_memory_peak_human || "0B",
      maxMemoryBytes: maxBytes,
      maxMemoryHuman: parsedMemory.maxmemory_human || "unlimited",
      maxMemoryPolicy: policy,
      memFragmentationRatio: fragRatio,
      memoryPressurePct: pressurePct,
      evictedKeys,
      expiredKeys,
      keyspaceHits: hits,
      keyspaceMisses: misses,
    }

    // 2. SCAN não-bloqueante amostral de chaves
    let cursor = "0"
    let iterations = 0
    const maxIterations = 8
    const targetSample = 150

    do {
      iterations++
      const scanRes = await client.scan(cursor, "COUNT", 50)
      cursor = String(scanRes[0])
      const batch = scanRes[1] || []

      for (const k of batch) {
        if (!sampleKeys.includes(k)) {
          sampleKeys.push(k)
          if (sampleKeys.length >= targetSample) break
        }
      }
    } while (cursor !== "0" && sampleKeys.length < targetSample && iterations < maxIterations)

    // 3. Checagem de TTL para cada chave amostrada
    for (const key of sampleKeys) {
      try {
        const ttl = await client.ttl(key)
        if (ttl === -1) {
          const prefix = key.includes(":") ? key.split(":")[0] : "global"
          noTtlKeys.push({ key, prefix, ttl })
          noTtlKeysByPrefix[prefix] = (noTtlKeysByPrefix[prefix] || 0) + 1
        }
      } catch {
        // Ignora erro individual de ttl
      }
    }

    // 4. Análise de Risco & Alertas
    if (pressurePct >= 85) {
      warnings.push(`Pressão de memória crítica: ${pressurePct}% de ${memoryStats.maxMemoryHuman}.`)
      recommendations.push("Aumentar maxmemory do Redis ou verificar dados sem expiração.")
    } else if (pressurePct >= 70) {
      warnings.push(`Pressão de memória moderada: ${pressurePct}%.`)
    }

    if (evictedKeys > 500) {
      warnings.push(
        `Despejo de chaves frequente: ${evictedKeys} chaves descartadas pela política ${policy}.`,
      )
      recommendations.push(
        "A política LRU está expulsando chaves; verifique se chaves de negócio estão sendo perdidas.",
      )
    }

    if (fragRatio > 2.0 && usedBytes > 50 * 1024 * 1024) {
      warnings.push(`Fragmentação de memória elevada (ratio: ${fragRatio}).`)
      recommendations.push("Avaliar 'MEMORY PURGE' ou rebalanceamento do container Redis.")
    }

    const dangerousKeys = noTtlKeys
      .filter((k) => ["referral", "session", "settlement", "audit"].includes(k.prefix))
      .map((k) => k.key)

    if (policy.startsWith("allkeys-") && dangerousKeys.length > 0) {
      warnings.push(
        `Detectadas chaves de negócio críticas SEM TTL sob política ${policy} (${dangerousKeys.length} encontradas). Risco de perda de dados.`,
      )
      recommendations.push(
        "Configurar TTL explícito em cache/sessões ou persistir dados críticos no PostgreSQL.",
      )
    }
  } catch (err) {
    warnings.push(
      `Erro durante auditoria de memória do Redis: ${err instanceof Error ? err.message : "Falha desconhecida"}`,
    )
  }

  const sampleSize = sampleKeys.length
  const noTtlCount = noTtlKeys.length
  const noTtlRatioPct = sampleSize > 0 ? Number(((noTtlCount / sampleSize) * 100).toFixed(1)) : 0

  let status: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY"
  if (warnings.length > 0) {
    status =
      (memoryStats?.memoryPressurePct ?? 0) >= 85 ||
      warnings.some((w) => w.includes("Risco de perda de dados"))
        ? "CRITICAL"
        : "WARNING"
  }

  return {
    timestamp,
    status,
    activeTier: currentTier,
    memory: memoryStats,
    sampleSize,
    noTtlKeysCount: noTtlCount,
    noTtlRatioPct,
    noTtlKeysByPrefix,
    dangerousKeys: noTtlKeys.map((k) => k.key).slice(0, 20),
    warnings,
    recommendations,
  }
}
