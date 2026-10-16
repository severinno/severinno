import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET, POST } from "../metrics/sre/route"
import { createCircuitBreaker } from "@/lib/circuit-breaker"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
  requireUser: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}))

vi.mock("@/lib/synthetic-prober", () => ({
  runSyntheticProbe: vi.fn().mockResolvedValue({
    status: "PASS",
    timestamp: "2026-10-16T12:00:00Z",
    totalDurationMs: 42,
    phases: {
      database: { status: "PASS", latencyMs: 10 },
      redis: { status: "PASS", latencyMs: 2 },
      escrowOtp: { status: "PASS", latencyMs: 1 },
      geoDistance: { status: "PASS", latencyMs: 0 },
    },
    warnings: [],
  }),
}))

describe("Admin SRE Metrics Route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET returns unified SRE status with circuit breakers and system stats", async () => {
    createCircuitBreaker("test-service", { failureThreshold: 3 })

    const req = new NextRequest("http://localhost/api/admin/metrics/sre")
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveProperty("status")
    expect(data).toHaveProperty("circuitBreakers")
    expect(data.circuitBreakers.summary.total).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty("webVitals")
    expect(data).toHaveProperty("system")
    expect(requireRole).toHaveBeenCalledWith("ADMIN")
  })

  it("POST handles reset_circuit action", async () => {
    const breaker = createCircuitBreaker("sre-test-cb", { failureThreshold: 1 })
    // Trip breaker
    try {
      await breaker.execute(async () => {
        throw new Error("fail")
      })
    } catch {
      // ignore
    }
    expect(breaker.getStats().state).toBe("open")

    const req = new NextRequest("http://localhost/api/admin/metrics/sre", {
      method: "POST",
      body: JSON.stringify({ action: "reset_circuit", circuit: "sre-test-cb" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(breaker.getStats().state).toBe("closed")
  })

  it("POST returns 404 for unknown circuit", async () => {
    const req = new NextRequest("http://localhost/api/admin/metrics/sre", {
      method: "POST",
      body: JSON.stringify({ action: "reset_circuit", circuit: "non-existent-cb" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it("POST handles reset_all_circuits action", async () => {
    const req = new NextRequest("http://localhost/api/admin/metrics/sre", {
      method: "POST",
      body: JSON.stringify({ action: "reset_all_circuits" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it("POST handles run_synthetic_probe action", async () => {
    const req = new NextRequest("http://localhost/api/admin/metrics/sre", {
      method: "POST",
      body: JSON.stringify({ action: "run_synthetic_probe" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.report.status).toBe("PASS")
  })

  it("POST returns 400 on invalid action", async () => {
    const req = new NextRequest("http://localhost/api/admin/metrics/sre", {
      method: "POST",
      body: JSON.stringify({ action: "unknown_action" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 401 when requireRole rejects with UNAUTHORIZED", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const req = new NextRequest("http://localhost/api/admin/metrics/sre")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
