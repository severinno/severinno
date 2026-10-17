/**
 * scripts/test-load-high-concurrency.ts — Teste de Carga Real de Alta Concorrência (1.000 requisições)
 *
 * Simula 1.000 requisições concorrentes disparadas contra a API do Severinno Marketplace
 * para estressar e validar o pool de conexões do PgBouncer, o Next.js e o Caddy.
 *
 * Usage:
 *   bun run scripts/test-load-high-concurrency.ts [--target=http://localhost:3000]
 *
 * Exit codes:
 *   0 — Sucesso (Taxa de sucesso >= 99% e p95 < 500ms)
 *   1 — Falha
 */

export {}

const TARGET_URL =
  process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] || "http://localhost:3000"
const TOTAL_REQUESTS = 1000
const CONCURRENCY = 100 // 100 requisições em voo simultâneo

const ENDPOINTS = [
  "/api/health",
  "/api/search/services?q=eletricista",
  "/api/search/services?q=pintor",
  "/api/search/services?q=limpeza",
  "/api/search/services?q=reforma",
  "/api/search/services?q=chaveiro",
]

interface RequestResult {
  durationMs: number
  status: number
  ok: boolean
}

async function runLoadTest() {
  console.log("================================================================================")
  console.log("⚡ TESTE DE CARGA REAL DE ALTA CONCORRÊNCIA — SEVERINNO MARKETPLACE")
  console.log(`   • Alvo: ${TARGET_URL}`)
  console.log(`   • Volume Total: ${TOTAL_REQUESTS} requisições`)
  console.log(`   • Concorrência em Voo: ${CONCURRENCY} workers simultâneos`)
  console.log("================================================================================\n")

  const results: RequestResult[] = []
  let completed = 0
  const startTime = performance.now()

  // Fila de execução concorrente
  const queue: Array<() => Promise<void>> = []

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const endpoint = ENDPOINTS[i % ENDPOINTS.length]
    queue.push(async () => {
      const reqStart = performance.now()
      try {
        const res = await fetch(`${TARGET_URL}${endpoint}`, {
          headers: {
            "User-Agent": `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) UserAgent-${i}`,
            Accept: `application/json, text/plain, */*; q=0.${(i % 9) + 1}`,
          },
        })
        const reqEnd = performance.now()
        results.push({
          durationMs: reqEnd - reqStart,
          status: res.status,
          ok: res.ok,
        })
      } catch {
        const reqEnd = performance.now()
        results.push({
          durationMs: reqEnd - reqStart,
          status: 0,
          ok: false,
        })
      } finally {
        completed++
        if (completed % 100 === 0 || completed === TOTAL_REQUESTS) {
          process.stdout.write(
            `   ⏳ Progresso: ${completed}/${TOTAL_REQUESTS} (${Math.round((completed / TOTAL_REQUESTS) * 100)}%)\r`,
          )
        }
      }
    })
  }

  // Executa com limite de concorrência
  let activeWorkers = 0
  let index = 0

  await new Promise<void>((resolve) => {
    function next() {
      while (activeWorkers < CONCURRENCY && index < queue.length) {
        activeWorkers++
        const task = queue[index++]
        task().finally(() => {
          activeWorkers--
          if (completed === TOTAL_REQUESTS) {
            resolve()
          } else {
            next()
          }
        })
      }
    }
    next()
  })

  const totalTimeSec = (performance.now() - startTime) / 1000
  const rps = TOTAL_REQUESTS / totalTimeSec

  // Métricas
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b)
  const successCount = results.filter((r) => r.ok).length
  const failureCount = TOTAL_REQUESTS - successCount
  const successRate = (successCount / TOTAL_REQUESTS) * 100

  const min = durations[0] || 0
  const max = durations[durations.length - 1] || 0
  const avg = durations.reduce((acc, v) => acc + v, 0) / (durations.length || 1)
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0

  console.log(
    "\n\n================================================================================",
  )
  console.log("📊 RESULTADOS DA PROVA DE CARGA (1.000 REQUISIÇÕES):")
  console.log("================================================================================")
  console.log(`   • Tempo Total de Execução: ${totalTimeSec.toFixed(2)}s`)
  console.log(`   • Vazão Alcançada (Throughput): ${rps.toFixed(1)} requisições/segundo (RPS)`)
  console.log(
    `   • Requisições com Sucesso: ${successCount}/${TOTAL_REQUESTS} (${successRate.toFixed(1)}%)`,
  )
  console.log(`   • Requisições Falhas: ${failureCount}`)
  const statusSummary = results.reduce<Record<number, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})
  console.log(`   • Distribuição de Status HTTP: ${JSON.stringify(statusSummary)}`)
  console.log("────────────────────────────────────────────────────────────────────────────────")
  console.log("⏱️  LATÊNCIAS DE RESPOSTA:")
  console.log(`   • Mínima:  ${min.toFixed(1)} ms`)
  console.log(`   • Média:   ${avg.toFixed(1)} ms`)
  console.log(`   • p50:     ${p50.toFixed(1)} ms (50% das requisições responderam abaixo disso)`)
  console.log(`   • p95:     ${p95.toFixed(1)} ms (95% das requisições responderam abaixo disso)`)
  console.log(`   • p99:     ${p99.toFixed(1)} ms (99% das requisições responderam abaixo disso)`)
  console.log(`   • Máxima:  ${max.toFixed(1)} ms`)
  console.log("================================================================================\n")

  if (successRate >= 99 && p95 < 500) {
    console.log("🎉 VEREDITO: SERVIDOR APROVADO COM EXCELÊNCIA EM ALTA CONCORRÊNCIA! ✅\n")
    process.exit(0)
  } else {
    console.error("❌ VEREDITO: TAXA DE ERRO OU LATÊNCIA ACIMA DO LIMITE TOLERADO.\n")
    process.exit(1)
  }
}

runLoadTest().catch((err) => {
  console.error("Erro fatal na prova de carga:", err)
  process.exit(1)
})
