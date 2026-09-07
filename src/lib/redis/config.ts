/**
 * Redis configuration — extracted from redis.ts for modularity.
 */

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined
export const REDIS_TLS = process.env.REDIS_TLS === "true"
export const REDIS_CLUSTER_MODE = process.env.REDIS_CLUSTER_MODE === "true"
export const REDIS_CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES || "localhost:6379"

/** Which Redis topology the application was configured to use. */
export const configMode: "cluster" | "standalone" = REDIS_CLUSTER_MODE ? "cluster" : "standalone"

export type Tier = "cluster" | "standalone" | "memory"
