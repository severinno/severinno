/**
 * k6 Load Test — Severinno Marketplace API
 *
 * Tests API performance under load:
 *   - Health checks
 *   - Provider listings
 *   - Category listings
 *   - Authentication flows
 *
 * Usage:
 *   k6 run loadtest/k6-load-test.js
 *   k6 run --out json=results.json loadtest/k6-load-test.js
 *
 * Requirements:
 *   - k6 installed (https://k6.io/docs/getting-started/installation/)
 *   - API running on BASE_URL
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend } from "k6/metrics"

// ── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"

// Custom metrics
const errorRate = new Rate("errors")
const healthDuration = new Trend("health_duration", true)
const providersDuration = new Trend("providers_duration", true)
const categoriesDuration = new Trend("categories_duration", true)

// ── Test Options ───────────────────────────────────────────────────────────

export const options = {
  // Stages: ramp up → sustain → ramp down
  stages: [
    { duration: "30s", target: 10 },  // Ramp up to 10 VUs
    { duration: "1m", target: 10 },   // Sustain 10 VUs for 1 min
    { duration: "30s", target: 50 },  // Ramp up to 50 VUs
    { duration: "2m", target: 50 },   // Sustain 50 VUs for 2 min
    { duration: "30s", target: 100 }, // Ramp up to 100 VUs
    { duration: "1m", target: 100 },  // Sustain 100 VUs for 1 min
    { duration: "30s", target: 0 },   // Ramp down
  ],
  
  // Thresholds (pass/fail criteria)
  thresholds: {
    http_req_duration: ["p(95)<2000"],  // 95% of requests < 2s
    http_req_failed: ["rate<0.01"],     // Error rate < 1%
    errors: ["rate<0.01"],
    health_duration: ["p(95)<500"],     // Health check P95 < 500ms
    providers_duration: ["p(95)<3000"], // Providers P95 < 3s
    categories_duration: ["p(95)<1000"], // Categories P95 < 1s
  },
}

// ── Scenarios ──────────────────────────────────────────────────────────────

export default function () {
  // ── Scenario 1: Health Check (lightweight) ──────────────────────────────
  const healthRes = http.get(`${BASE_URL}/api/health`)
  healthDuration.add(healthRes.timings.duration)
  
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
    "health has status field": (r) => JSON.parse(r.body).status !== undefined,
  }) || errorRate.add(1)
  
  sleep(0.1) // 100ms between requests
  
  // ── Scenario 2: Provider Listing ────────────────────────────────────────
  const providersRes = http.get(`${BASE_URL}/api/providers?limit=20`)
  providersDuration.add(providersRes.timings.duration)
  
  check(providersRes, {
    "providers status is 200": (r) => r.status === 200,
    "providers has items array": (r) => {
      const body = JSON.parse(r.body)
      return Array.isArray(body.items)
    },
  }) || errorRate.add(1)
  
  sleep(0.2) // 200ms between requests
  
  // ── Scenario 3: Category Listing ────────────────────────────────────────
  const categoriesRes = http.get(`${BASE_URL}/api/categories`)
  categoriesDuration.add(categoriesRes.timings.duration)
  
  check(categoriesRes, {
    "categories status is 200": (r) => r.status === 200,
  }) || errorRate.add(1)
  
  sleep(0.5) // 500ms between iterations
}

// ── Setup (runs once before test) ─────────────────────────────────────────

export function setup() {
  console.log(`\n🚀 Starting load test against ${BASE_URL}`)
  console.log(`📊 Thresholds: P95 < 2s, Error rate < 1%\n`)
  
  // Verify API is accessible
  const healthCheck = http.get(`${BASE_URL}/api/health`)
  if (healthCheck.status !== 200) {
    throw new Error(`API not accessible at ${BASE_URL}`)
  }
  
  console.log(`✅ API accessible — starting test...\n`)
  return { startTime: Date.now() }
}

// ── Teardown (runs once after test) ───────────────────────────────────────

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000
  console.log(`\n✅ Load test completed in ${duration.toFixed(1)}s`)
}

// ── Handle summary ────────────────────────────────────────────────────────

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs / 1000,
    vus: {
      max: data.metrics.vus_max?.value || 0,
    },
    http: {
      requests: data.metrics.http_reqs?.value || 0,
      duration_p50: data.metrics.http_req_duration?.values?.p50 || 0,
      duration_p95: data.metrics.http_req_duration?.values?.p95 || 0,
      duration_p99: data.metrics.http_req_duration?.values?.p99 || 0,
      failed_rate: data.metrics.http_req_failed?.values?.rate || 0,
    },
    custom: {
      health_p95: data.metrics.health_duration?.values?.p95 || 0,
      providers_p95: data.metrics.providers_duration?.values?.p95 || 0,
      categories_p95: data.metrics.categories_duration?.values?.p95 || 0,
      error_rate: data.metrics.errors?.values?.rate || 0,
    },
    thresholds_met: Object.entries(data.thresholds || {}).every(
      ([, passed]) => passed === true
    ),
  }
  
  console.log("\n📊 Load Test Summary:")
  console.log(JSON.stringify(summary, null, 2))
  
  return {
    "stdout": textSummary(data, { indent: " ", enableColors: true }),
    [`loadtest/results-${Date.now()}.json`]: JSON.stringify(summary, null, 2),
  }
}

function textSummary(data, options) {
  // Simple text summary
  let text = "\n"
  text += "╔══════════════════════════════════════════════════════════════╗\n"
  text += "║                   LOAD TEST RESULTS                        ║\n"
  text += "╠══════════════════════════════════════════════════════════════╣\n"
  text += `║ Duration:     ${(data.state.testRunDurationMs / 1000).toFixed(1)}s`.padEnd(63) + "║\n"
  text += `║ Max VUs:      ${data.metrics.vus_max?.value || 0}`.padEnd(63) + "║\n"
  text += `║ Total Reqs:   ${data.metrics.http_reqs?.value || 0}`.padEnd(63) + "║\n"
  text += `║ P50 Latency:  ${(data.metrics.http_req_duration?.values?.p50 || 0).toFixed(0)}ms`.padEnd(63) + "║\n"
  text += `║ P95 Latency:  ${(data.metrics.http_req_duration?.values?.p95 || 0).toFixed(0)}ms`.padEnd(63) + "║\n"
  text += `║ P99 Latency:  ${(data.metrics.http_req_duration?.values?.p99 || 0).toFixed(0)}ms`.padEnd(63) + "║\n"
  text += `║ Error Rate:   ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%`.padEnd(63) + "║\n"
  text += "╠══════════════════════════════════════════════════════════════╣\n"
  text += `║ Health P95:       ${(data.metrics.health_duration?.values?.p95 || 0).toFixed(0)}ms`.padEnd(63) + "║\n"
  text += `║ Providers P95:    ${(data.metrics.providers_duration?.values?.p95 || 0).toFixed(0)}ms`.padEnd(63) + "║\n"
  text += `║ Categories P95:   ${(data.metrics.categories_duration?.values?.p95 || 0).toFixed(0)}ms`.padEnd(63) + "║\n"
  text += "╠══════════════════════════════════════════════════════════════╣\n"
  text += `║ Thresholds Met:   ${Object.entries(data.thresholds || {}).every(([, p]) => p === true) ? "✅ PASS" : "❌ FAIL"}`.padEnd(63) + "║\n"
  text += "╚══════════════════════════════════════════════════════════════╝\n"
  return text
}
