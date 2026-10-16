import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET, DELETE } from "../metrics/web-vitals/route"
import { webVitalsRegistry } from "@/lib/web-vitals-registry"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
  requireUser: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}))

describe("Admin Web Vitals Telemetry Route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webVitalsRegistry.reset()
  })

  it("GET returns Web Vitals telemetry summary with metrics", async () => {
    webVitalsRegistry.record({ name: "TTFB", value: 120 })
    webVitalsRegistry.record({ name: "LCP", value: 1800 })
    webVitalsRegistry.record({ name: "INP", value: 45 })
    webVitalsRegistry.record({ name: "CLS", value: 0.02 })
    webVitalsRegistry.record({ name: "FCP", value: 650 })

    const req = new NextRequest("http://localhost/api/admin/metrics/web-vitals")
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveProperty("totalSamples", 5)
    expect(data).toHaveProperty("complianceScore", 100)
    expect(data.metrics.TTFB.p50).toBe(120)
    expect(data.metrics.LCP.status).toBe("OPTIMAL")
    expect(requireRole).toHaveBeenCalledWith("ADMIN")
  })

  it("DELETE resets the telemetry buffer", async () => {
    webVitalsRegistry.record({ name: "TTFB", value: 200 })
    expect(webVitalsRegistry.getSummary().totalSamples).toBe(1)

    const req = new NextRequest("http://localhost/api/admin/metrics/web-vitals", {
      method: "DELETE",
    })
    const res = await DELETE(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(webVitalsRegistry.getSummary().totalSamples).toBe(0)
    expect(requireRole).toHaveBeenCalledWith("ADMIN")
  })

  it("fails if requireRole rejects with UNAUTHORIZED", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const req = new NextRequest("http://localhost/api/admin/metrics/web-vitals")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
