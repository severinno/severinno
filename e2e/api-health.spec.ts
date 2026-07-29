import { test, expect } from "@playwright/test"

test("GET /api/providers returns paginated providers", async ({ request }) => {
  const response = await request.get("/api/providers?page=1&limit=5")
  expect(response.ok()).toBeTruthy()

  const body = await response.json()
  expect(Array.isArray(body.items)).toBeTruthy()
  expect(typeof body.total).toBe("number")
})

test.describe("/api/health — geo services", () => {
  test("returns 200 and geo check fields when all services are healthy", async ({ request }) => {
    const response = await request.get("/api/health")
    const body = await response.json()

    // The endpoint should respond — accept either 200 (healthy) or 503 (degraded)
    expect([200, 503]).toContain(response.status())

    // Root fields
    expect(body).toHaveProperty("status")
    expect(["ok", "degraded"]).toContain(body.status)
    expect(body).toHaveProperty("timestamp")
    expect(body).toHaveProperty("uptime")
    expect(body).toHaveProperty("version")

    // Checks object with all 5 services
    expect(body).toHaveProperty("checks")
    expect(body.checks).toHaveProperty("database")
    expect(body.checks).toHaveProperty("redis")
    expect(body.checks).toHaveProperty("nominatim")
    expect(body.checks).toHaveProperty("viacep")
    expect(body.checks).toHaveProperty("postgis")
    expect(["ok", "error"]).toContain(body.checks.database)
    expect(["ok", "error"]).toContain(body.checks.nominatim)
    expect(["ok", "error"]).toContain(body.checks.viacep)
    expect(["ok", "error"]).toContain(body.checks.postgis)

    // Geo object with detail strings
    expect(body).toHaveProperty("geo")
    expect(body.geo).toHaveProperty("nominatim")
    expect(body.geo).toHaveProperty("viacep")
    expect(body.geo).toHaveProperty("postgis")
    expect(typeof body.geo.nominatim).toBe("string")
    expect(typeof body.geo.viacep).toBe("string")
    expect(typeof body.geo.postgis).toBe("string")

    // Cache stats
    expect(body).toHaveProperty("cache")
    expect(body.cache).toHaveProperty("hits")
    expect(body.cache).toHaveProperty("misses")
    expect(body.cache).toHaveProperty("total")

    // HTTP status matches status field
    if (body.status === "ok") {
      expect(response.status()).toBe(200)
    } else {
      expect(response.status()).toBe(503)
    }
  })

  test("all health check fields have correct types", async ({ request }) => {
    const response = await request.get("/api/health")
    const body = await response.json()

    expect(typeof body.timestamp).toBe("string")
    expect(typeof body.uptime).toBe("number")
    expect(typeof body.version).toBe("string")
    expect(body.uptime).toBeGreaterThan(0)

    // Each check value must be "ok" or "error"
    for (const service of ["database", "redis", "nominatim", "viacep", "postgis"] as const) {
      expect(["ok", "error"]).toContain(body.checks[service])
    }
  })
})

test.describe("/api/health — status consistency", () => {
  test("status is 'degraded' when any geo service is down", async ({ request }) => {
    const response = await request.get("/api/health")
    const body = await response.json()

    const geoChecks = [body.checks.nominatim, body.checks.viacep, body.checks.postgis]
    const allGeoOk = geoChecks.every((s: string) => s === "ok")

    if (!allGeoOk) {
      expect(body.status).toBe("degraded")
    }
  })
})
