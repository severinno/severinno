import { test, expect } from "@playwright/test"

test("GET /api/health returns 200 with ok status", async ({ request }) => {
  const response = await request.get("/api/health")
  expect(response.ok()).toBeTruthy()

  const body = await response.json()
  expect(body.status).toBeDefined()
})

test("GET /api/providers returns paginated providers", async ({ request }) => {
  const response = await request.get("/api/providers?page=1&limit=5")
  expect(response.ok()).toBeTruthy()

  const body = await response.json()
  expect(Array.isArray(body.items)).toBeTruthy()
  expect(typeof body.total).toBe("number")
})
