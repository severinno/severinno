import { test, expect } from "@playwright/test"

test("GET /api/cron/reminders returns 401 without auth", async ({ request }) => {
  const response = await request.get("/api/cron/reminders")
  expect(response.status()).toBe(401)
})

test("GET /api/cron/reminders returns 200 with valid CRON_SECRET", async ({ request }) => {
  const secret = process.env.CRON_SECRET
  test.skip(!secret, "CRON_SECRET not set")
  const response = await request.get("/api/cron/reminders", {
    headers: { Authorization: `Bearer ${secret}` },
  })
  expect(response.ok()).toBeTruthy()
})
