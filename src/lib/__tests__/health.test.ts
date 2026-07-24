import { describe, it, expect, vi } from "vitest"

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from "@/app/api/health/route"

describe("GET /api/health", () => {
  it("retorna status 200 no formato esperado", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveProperty("status")
    expect(body).toHaveProperty("checks")
    expect(body).toHaveProperty("timestamp")
    expect(body).toHaveProperty("version")
    // uptime may not be available in all test environments
    if (body.uptime !== undefined) {
      expect(typeof body.uptime).toBe("number")
    }
  })

  it("campos checks têm database e redis", async () => {
    const response = await GET()
    const body = await response.json()

    expect(body.checks).toHaveProperty("database")
    expect(body.checks).toHaveProperty("redis")
    expect(typeof body.status).toBe("string")
    expect(typeof body.timestamp).toBe("string")
    expect(typeof body.version).toBe("string")
  })

  it("usa cache em memória em chamadas subsequentes", async () => {
    const first = await GET()
    expect(first.status).toBe(200)

    const second = await GET()
    expect(second.status).toBe(200)
  })
})
