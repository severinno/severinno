import logger from "./logger"

interface ABExperiment {
  name: string
  variants: string[]
  weights: number[]
  enabled: boolean
}

const experiments = new Map<string, ABExperiment>()
const assignments = new Map<string, string>()

export function registerExperiment(exp: ABExperiment): void {
  experiments.set(exp.name, exp)
}

export function getVariant(experimentName: string, userId: string): string | null {
  const exp = experiments.get(experimentName)
  if (!exp?.enabled) return null

  const key = `${experimentName}:${userId}`
  if (assignments.has(key)) return assignments.get(key)!

  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  const bucket = Math.abs(hash) % 100

  let cumulative = 0
  for (let i = 0; i < exp.variants.length; i++) {
    cumulative += exp.weights[i] ?? 0
    if (bucket < cumulative) {
      const variant = exp.variants[i]
      assignments.set(key, variant)
      logger.info({ experiment: experimentName, userId, variant }, "A/B experiment assigned")
      return variant
    }
  }
  return exp.variants[0] ?? null
}

export function getAllExperiments(): Record<string, ABExperiment> {
  return Object.fromEntries(experiments)
}
