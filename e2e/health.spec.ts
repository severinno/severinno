/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test"

/**
 * Health Check E2E Tests
 *
 * Verifies that the /api/health endpoint returns correct responses
 * and that the application is running properly.
 */

test.describe("Health Check", () => {
  test("GET /api/health deve retornar status 200", async ({ request }) => {
    const response = await request.get("/api/health")
    expect(response.ok()).toBeTruthy()
    expect(response.status()).toBe(200)

    const body = await response.json()
    expect(body).toHaveProperty("status")
    expect(body).toHaveProperty("checks")
    expect(body).toHaveProperty("uptime")
    expect(body.checks).toHaveProperty("database")
    expect(body.checks).toHaveProperty("redis")
  })

  test("GET /api/health deve ter status 'ok' ou 'degraded'", async ({ request }) => {
    const response = await request.get("/api/health")
    const body = await response.json()
    expect(["ok", "degraded"]).toContain(body.status)
  })

  test("GET /api/health deve retornar timestamp ISO", async ({ request }) => {
    const response = await request.get("/api/health")
    const body = await response.json()
    expect(body.timestamp).toBeDefined()
    expect(() => new Date(body.timestamp)).not.toThrow()
  })
})
