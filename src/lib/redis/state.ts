/**
 * Shared mutable Redis state — extracted to break circular deps.
 */

import { Redis, Cluster } from "ioredis"
import { configMode, type Tier } from "./config"

type RedisState = {
  clusterClient: Cluster | null
  standaloneClient: Redis | null
  activeTier: Tier
  everConnected: boolean
}

const GLOBAL_KEY = "__SEVERINNO_REDIS__" as const
const g = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as RedisState | undefined
const state: RedisState =
  g ??
  ((globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
    clusterClient: null,
    standaloneClient: null,
    activeTier: configMode,
    everConnected: false,
  })

export let clusterClient = state.clusterClient
export let standaloneClient = state.standaloneClient
export let activeTier = state.activeTier
export let everConnected = state.everConnected

/** Sync state back to globalThis after mutation */
export function syncState() {
  state.clusterClient = clusterClient
  state.standaloneClient = standaloneClient
  state.activeTier = activeTier
  state.everConnected = everConnected
}

export function setClusterClient(c: Cluster | null) {
  clusterClient = c
  syncState()
}

export function setStandaloneClient(c: Redis | null) {
  standaloneClient = c
  syncState()
}

export function setActiveTier(t: Tier) {
  activeTier = t
  syncState()
}

export function setEverConnected(v: boolean) {
  everConnected = v
  syncState()
}
