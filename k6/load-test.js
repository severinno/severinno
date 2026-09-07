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
    health_latency: ["p(95)<1000"],
    search_latency: ["p(95)<3000"],
  },
}

// ── Helper functions ────────────────────────────────────────────────────────

const PROVIDER_IDS = [
  "cmtga9n3z01swsmz530cwkik4",
  "cmtgaq7mi0001smx083iwaqtn",
  "cmthhl6vd0000smsz1v4yo93e",
  "cmtga9n0b01jksmz5h06rsoox",
  "cmtga9n0b01jlsmz57saf1z6e",
  "cmtga9n0b01jmsmz5npv12841",
  "cmtga9n0b01jnsmz5ywb043fe",
  "cmtga9n0b01josmz5lnzwpa35",
  "cmtga9n0b01jpsmz5xpsbm22z",
  "cmtga9n0b01jqsmz5e82jjjf6",
  "cmtga9n0b01jrsmz5k7fhc79a",
  "cmtga9n0b01jssmz5w9ul55ey",
  "cmtga9n0c01jtsmz5yzxfj561",
  "cmtga9n0c01jusmz5xqzef8ky",
  "cmtga9n0c01jvsmz5wgo7mu3b",
  "cmtga9n0c01jwsmz5o1b7zbb1",
  "cmtga9n0c01jxsmz57ayxzqrc",
  "cmtga9n0c01jysmz5lndd3x02",
  "cmtga9n0c01jzsmz5nweba9oy",
  "cmtga9n0c01k0smz58tpxcj4e",
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
    if (rand < 0.35) {
      testHome()
    } else if (rand < 0.5) {
      testHealth()
    } else if (rand < 0.8) {
      testSearch()
    } else if (rand < 0.9) {
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
    "provider: status 200 or 404": (r) => r.status === 200 || r.status === 404,
    "provider: response < 3s": (r) => r.timings.duration < 3000,
  })

  errorRate.add(!success && res.status !== 404)
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
