/**
 * benchmark-utils.mjs — ESM shim for src/lib/benchmark-utils.ts
 *
 * This file exists so that standalone Node.js scripts (like
 * scripts/geo-benchmark.mjs) can import shared benchmarking
 * utilities without a TypeScript build step.
 *
 * SOURCE: src/lib/benchmark-utils.ts — keep both files in sync.
 */

/**
 * Generate `count` synthetic provider points uniformly distributed
 * within `spreadKm` km of `center`.
 *
 * @param {number} count
 * @param {number} [spreadKm=50]
 * @param {{lat:number,lng:number}} [center]  — default São Paulo (-23.5505, -46.6333)
 * @returns {Array<{lat:number,lng:number}>}
 */
export function generateProviders(count, spreadKm = 50, center = { lat: -23.5505, lng: -46.6333 }) {
  const degPerKm = { lat: 1 / 111, lng: 1 / 102 }
  const out = []
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI
    const dist = Math.random() * spreadKm
    out.push({
      lat: center.lat + Math.cos(angle) * dist * degPerKm.lat,
      lng: center.lng + Math.sin(angle) * dist * degPerKm.lng,
    })
  }
  return out
}

export function measure(fn, iterations = 100) {
  const samples = []

  // Warmup (excluded from results)
  for (let i = 0; i < 3; i++) fn()

  // Measured iterations
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    fn()
    const t1 = performance.now()
    samples.push((t1 - t0) * 1000) // µs
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length

  return {
    mean: Math.round(mean * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    opsPerSec: Math.round(1_000_000 / mean),
  }
}
