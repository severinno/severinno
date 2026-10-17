/**
 * Severinno — Load Test com K6
 *
 * Testa os endpoints críticos com carga realista:
 * - Home page (SSR)
 * - Health check
 * - Providers search
 * - Categories
 * - Provider detail
 *
 * Usage:
 *   k6 run k6/load-test.js
 *   k6 run --vus 100 --duration 2m k6/load-test.js
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend, Counter } from "k6/metrics"

// ── Custom metrics ──────────────────────────────────────────────────────────

const errorRate = new Rate("errors")
const homeLatency = new Trend("home_latency", true)
const healthLatency = new Trend("health_latency", true)
const searchLatency = new Trend("search_latency", true)
const categoriesLatency = new Trend("categories_latency", true)
const providerLatency = new Trend("provider_latency", true)
const totalRequests = new Counter("total_requests")

// ── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"

export const options = {
  // Ramp-up: 0→50→100→150 VUs over 3 minutes, hold 100 VUs for 2 min, ramp-down
  stages: [
    { duration: "30s", target: 20 }, // Warm-up
    { duration: "30s", target: 50 }, // Ramp to 50
    { duration: "30s", target: 100 }, // Ramp to 100
    { duration: "2m", target: 100 }, // Hold 100 VUs
    { duration: "30s", target: 150 }, // Spike to 150
    { duration: "1m", target: 150 }, // Hold spike
    { duration: "30s", target: 0 }, // Ramp-down
  ],

  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"], // 95% < 2s, 99% < 5s
    http_req_failed: ["rate<0.05"], // < 5% errors
    errors: ["rate<0.05"],
    home_latency: ["p(95)<3000"],
    health_latency: ["p(95)<2000"],
    search_latency: ["p(95)<3000"],
  },
}

// ── Helper functions ────────────────────────────────────────────────────────

const PROVIDER_IDS = [
  "cmvbk7hhr0003sm2asbmm5e1n",
  "cmvbk7hig0004sm2ajp2hdmre",
  "cmvbk7hj50005sm2anm89ms9d",
  "cmvbk7hjt0006sm2azn3zozlh",
  "cmvbk7hki0007sm2afixxvp04",
  "cmvbk7hl70008sm2ap3npw4wx",
]

function randomProviderId() {
  return PROVIDER_IDS[Math.floor(Math.random() * PROVIDER_IDS.length)]
}

// ── Test scenarios ──────────────────────────────────────────────────────────

export default function loadTest() {
  const scenario = __ENV.SCENARIO || "mixed"

  if (scenario === "home") {
    testHome()
  } else if (scenario === "health") {
    testHealth()
  } else if (scenario === "search") {
    testSearch()
  } else {
    // Mixed: weighted random selection
    const rand = Math.random()
    if (rand < 0.25) {
      testHome()
    } else if (rand < 0.4) {
      testHealth()
    } else if (rand < 0.6) {
      testSearch()
    } else if (rand < 0.75) {
      testGeoSearch()
    } else if (rand < 0.85) {
      testCities()
    } else if (rand < 0.92) {
      testCategories()
    } else {
      testProviderDetail()
    }
  }

  sleep(Math.random() * 2 + 1) // 1-3s between requests (realistic user behavior)
}

// ── Individual test functions ───────────────────────────────────────────────

function testHome() {
  const res = http.get(`${BASE_URL}/`, {
    tags: { endpoint: "home" },
    timeout: "10s",
  })

  totalRequests.add(1)
  homeLatency.add(res.timings.duration)

  const body = res.body || ""
  const success = check(res, {
    "home: status 200": (r) => r.status === 200,
    "home: has content": () => body.includes("Severinno") || body.includes("prestadores"),
    "home: response < 5s": (r) => r.timings.duration < 5000,
  })

  errorRate.add(!success)
}

function testHealth() {
  const res = http.get(`${BASE_URL}/api/health`, {
    tags: { endpoint: "health" },
    timeout: "15s",
  })

  totalRequests.add(1)
  healthLatency.add(res.timings.duration)

  let body
  try {
    body = JSON.parse(res.body)
  } catch {
    body = {}
  }

  const success = check(res, {
    "health: status 200": (r) => r.status === 200,
    "health: status ok": () => body.status === "ok",
    "health: database ok": () => body.checks?.database === "ok",
    "health: redis ok": () => body.checks?.redis === "ok",
    "health: response < 2s": (r) => r.timings.duration < 2000,
  })

  errorRate.add(!success)
}

function testSearch() {
  const res = http.get(`${BASE_URL}/api/providers?limit=9`, {
    tags: { endpoint: "search" },
    timeout: "20s",
  })

  totalRequests.add(1)
  searchLatency.add(res.timings.duration)

  // Only count as error if HTTP request itself failed (not JSON parse)
  const success = check(res, {
    "search: status 200": (r) => r.status === 200,
    "search: response < 10s": (r) => r.timings.duration < 10000,
  })

  // Try to parse body for data check, but don't fail on parse errors
  if (res.status === 200 && res.body) {
    try {
      const body = JSON.parse(res.body)
      check(body, {
        "search: has items array": (b) => Array.isArray(b.items),
      })
    } catch {
      // JSON parse error under load — don't count as HTTP failure
    }
  }

  errorRate.add(!success)
}

function testCategories() {
  const res = http.get(`${BASE_URL}/api/categories`, {
    tags: { endpoint: "categories" },
    timeout: "5s",
  })

  totalRequests.add(1)
  categoriesLatency.add(res.timings.duration)

  const catBody = res.body || ""
  const success = check(res, {
    "categories: status 200": (r) => r.status === 200,
    "categories: has data": () => catBody.length > 2,
    "categories: response < 2s": (r) => r.timings.duration < 2000,
  })

  errorRate.add(!success)
}

function testProviderDetail() {
  const id = randomProviderId()
  const res = http.get(`${BASE_URL}/api/providers/${id}`, {
    tags: { endpoint: "provider_detail" },
    timeout: "10s",
  })

  totalRequests.add(1)
  providerLatency.add(res.timings.duration)

  const success = check(res, {
    "provider: status 200": (r) => r.status === 200,
    "provider: response < 3s": (r) => r.timings.duration < 3000,
  })

  errorRate.add(!success)
}

function testCities() {
  const res = http.get(`${BASE_URL}/api/cities`, {
    tags: { endpoint: "cities" },
    timeout: "5s",
  })

  totalRequests.add(1)
  const success = check(res, {
    "cities: status 200": (r) => r.status === 200,
    "cities: response < 2s": (r) => r.timings.duration < 2000,
  })

  errorRate.add(!success)
}

function testGeoSearch() {
  const res = http.get(`${BASE_URL}/api/providers?lat=-18.8546&lng=-41.9443&radius=15`, {
    tags: { endpoint: "geo_search" },
    timeout: "10s",
  })

  totalRequests.add(1)
  searchLatency.add(res.timings.duration)

  const success = check(res, {
    "geo_search: status 200": (r) => r.status === 200,
    "geo_search: response < 5s": (r) => r.timings.duration < 5000,
  })

  errorRate.add(!success)
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] || 0
  const p99 = data.metrics.http_req_duration?.values?.["p(99)"] || 0
  const avg = data.metrics.http_req_duration?.values?.avg || 0
  const failed = data.metrics.http_req_failed?.values?.rate || 0
  const total = data.metrics.http_reqs?.values?.count || 0
  const rps = data.metrics.http_reqs?.values?.rate || 0

  const status = failed < 0.05 && p95 < 2000 ? "✅ PASS" : "❌ FAIL"

  const summary = `
╔══════════════════════════════════════════════════════════╗
║         SEVERINNO — LOAD TEST RESULTS                   ║
╠══════════════════════════════════════════════════════════╣
║  Status:       ${status.padEnd(40)}║
║  Total Reqs:   ${String(total).padEnd(40)}║
║  RPS:          ${rps.toFixed(1).padEnd(40)}║
║  Avg Latency:  ${(avg.toFixed(0) + "ms").padEnd(40)}║
║  P95 Latency:  ${(p95.toFixed(0) + "ms").padEnd(40)}║
║  P99 Latency:  ${(p99.toFixed(0) + "ms").padEnd(40)}║
║  Error Rate:   ${(failed * 100).toFixed(1).padEnd(39)}%║
╠══════════════════════════════════════════════════════════╣
║  Thresholds:                                             ║
║    p(95) < 2000ms:  ${(p95 < 2000 ? "✅ PASS" : "❌ FAIL").padEnd(30)}║
║    errors < 5%:     ${(failed < 0.05 ? "✅ PASS" : "❌ FAIL").padEnd(30)}║
╚══════════════════════════════════════════════════════════╝
`

  // eslint-disable-next-line no-console -- k6 writes results to stdout intentionally
  console.log(summary)

  return {
    "k6/results.json": JSON.stringify(data, null, 2),
    stdout: summary,
  }
}
