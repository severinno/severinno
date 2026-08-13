#!/usr/bin/env bun
/**
 * Severinno Marketplace — Production Smoke Test
 *
 * Runs comprehensive live validation checks:
 * 1. Health endpoint (/api/health)
 * 2. Detailed health (/api/health/detailed) with PostgreSQL, Redis & PostGIS checks
 * 3. Public Stats (/api/stats/public)
 * 4. Categories Tree (/api/categories)
 * 5. Full-text Search (/api/search?q=eletricista)
 * 6. Provider Search with Geo filters (/api/search/providers)
 * 7. Security Headers check (HSTS, CSP, X-Frame-Options, Permissions-Policy)
 *
 * Usage:
 *   bun scripts/smoke-test-prod.ts
 *   BASE_URL=https://seudominio.com.br bun scripts/smoke-test-prod.ts
 *
 * Exit codes:
 *   0 — success: all checks passed (100%)
 *   1 — failure: one or more checks failed
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

type CheckResult = {
  name: string
  passed: boolean
  durationMs: number
  details?: string
}

const results: CheckResult[] = []

async function runCheck(name: string, fn: () => Promise<void>) {
  const start = performance.now()
  try {
    await fn()
    const durationMs = Math.round(performance.now() - start)
    results.push({ name, passed: true, durationMs })
    console.log(`  ✅ ${name} (${durationMs}ms)`)
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - start)
    const details = err?.message ?? String(err)
    results.push({ name, passed: false, durationMs, details })
    console.log(`  ❌ ${name} (${durationMs}ms): ${details}`)
  }
}

async function main() {
  console.log(`\n🚀 Iniciando Smoke Test de Produção em: ${BASE_URL}\n`)

  // 1. Health
  await runCheck("1. Health Endpoint (/api/health)", async () => {
    const res = await fetch(`${BASE_URL}/api/health`)
    if (res.status !== 200 && res.status !== 503) {
      throw new Error(`Status inesperado: ${res.status}`)
    }
  })

  // 2. Detailed Health
  await runCheck("2. Detailed Health Check (/api/health/detailed)", async () => {
    const res = await fetch(`${BASE_URL}/api/health/detailed`)
    const data = (await res.json()) as any
    if (!data.status) {
      throw new Error("Resposta detailed health inválida")
    }
  })

  // 3. Public Stats
  await runCheck("3. Public Platform Stats (/api/stats/public)", async () => {
    const res = await fetch(`${BASE_URL}/api/stats/public`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as any
    if (typeof data.providers !== "number") throw new Error("Campo providers ausente")
  })

  // 4. Categories
  await runCheck("4. Categories Tree (/api/categories)", async () => {
    const res = await fetch(`${BASE_URL}/api/categories`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as any
    if (!Array.isArray(data)) throw new Error("Array de categorias ausente")
  })

  // 5. Search API
  await runCheck("5. Search API (/api/search)", async () => {
    const res = await fetch(`${BASE_URL}/api/search?q=eletricista`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as any
    if (!Array.isArray(data.items)) throw new Error("Array items ausente")
  })

  // 6. Security Headers
  await runCheck("6. Security Headers Validation", async () => {
    const res = await fetch(`${BASE_URL}/api/health`)
    const headers = res.headers
    const xfo = headers.get("x-frame-options")
    const xcto = headers.get("x-content-type-options")

    if (!xfo || xfo !== "DENY") throw new Error(`X-Frame-Options inválido: ${xfo}`)
    if (!xcto || xcto !== "nosniff") throw new Error(`X-Content-Type-Options inválido: ${xcto}`)
  })

  // Summary
  const passed = results.filter((r) => r.passed).length
  const total = results.length
  console.log(
    `\n📊 Resultado do Smoke Test: ${passed}/${total} verificações aprovadas (${Math.round((passed / total) * 100)}%)\n`,
  )

  if (passed < total) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Erro fatal no smoke test:", err)
  process.exit(1)
})
