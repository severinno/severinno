# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api-health.spec.ts >> GET /api/health returns 200 with ok status
- Location: e2e\api-health.spec.ts:3:5

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test"
  2  | 
  3  | test("GET /api/health returns 200 with ok status", async ({ request }) => {
  4  |   const response = await request.get("/api/health")
> 5  |   expect(response.ok()).toBeTruthy()
     |                         ^ Error: expect(received).toBeTruthy()
  6  | 
  7  |   const body = await response.json()
  8  |   expect(body.status).toBeDefined()
  9  | })
  10 | 
  11 | test("GET /api/providers returns paginated providers", async ({ request }) => {
  12 |   const response = await request.get("/api/providers?page=1&limit=5")
  13 |   expect(response.ok()).toBeTruthy()
  14 | 
  15 |   const body = await response.json()
  16 |   expect(Array.isArray(body.items)).toBeTruthy()
  17 |   expect(typeof body.total).toBe("number")
  18 | })
  19 | 
```