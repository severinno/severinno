# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: health.spec.ts >> Health Check >> GET /api/health deve retornar timestamp ISO
- Location: e2e\health.spec.ts:30:7

# Error details

```
SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test"
  2  | 
  3  | /**
  4  |  * Health Check E2E Tests
  5  |  *
  6  |  * Verifies that the /api/health endpoint returns correct responses
  7  |  * and that the application is running properly.
  8  |  */
  9  | 
  10 | test.describe("Health Check", () => {
  11 |   test("GET /api/health deve retornar status 200", async ({ request }) => {
  12 |     const response = await request.get("/api/health")
  13 |     expect(response.ok()).toBeTruthy()
  14 |     expect(response.status()).toBe(200)
  15 | 
  16 |     const body = await response.json()
  17 |     expect(body).toHaveProperty("status")
  18 |     expect(body).toHaveProperty("checks")
  19 |     expect(body).toHaveProperty("uptime")
  20 |     expect(body.checks).toHaveProperty("database")
  21 |     expect(body.checks).toHaveProperty("redis")
  22 |   })
  23 | 
  24 |   test("GET /api/health deve ter status 'ok' ou 'degraded'", async ({ request }) => {
  25 |     const response = await request.get("/api/health")
  26 |     const body = await response.json()
  27 |     expect(["ok", "degraded"]).toContain(body.status)
  28 |   })
  29 | 
  30 |   test("GET /api/health deve retornar timestamp ISO", async ({ request }) => {
  31 |     const response = await request.get("/api/health")
> 32 |     const body = await response.json()
     |                  ^ SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
  33 |     expect(body.timestamp).toBeDefined()
  34 |     expect(() => new Date(body.timestamp)).not.toThrow()
  35 |   })
  36 | })
  37 | 
```