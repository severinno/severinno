/**
 * Tests for POST /api/webhooks/sentry-alert — alert forwarding (Discord + Telegram).
 *
 * Valida que os fetches de Discord e Telegram carregam AbortSignal.timeout
 * via helper compartilhado (fetch-timeout.ts): um canal que aceita o TCP mas
 * nunca responde não pode atrasar o 200 ao GlitchTip (o POST só responde após
 * Promise.allSettled).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const triggeredPayload = {
  action: "triggered",
  data: {
    event: {
      event_id: "evt-1",
      level: "error",
      message: "Erro crítico",
      culprit: "src/app/api/x/route.ts",
      tags: [["environment", "production"]],
    },
    triggered_rule: { name: "Erros 5xx" },
  },
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
  vi.resetModules()
  vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/test")
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token")
  vi.stubEnv("TELEGRAM_CHAT_ID", "test-chat")
  // Sem secret → isAuthorized aceita qualquer origem (dev/test)
  vi.stubEnv("SENTRY_ALERT_SECRET", "")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

function postAlert(): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/webhooks/sentry-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(triggeredPayload),
    }),
  )
}

describe("POST /api/webhooks/sentry-alert — signal presence", () => {
  it("passa AbortSignal.timeout nos fetches de Discord e Telegram", async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    )

    const { POST } = await import("../webhooks/sentry-alert/route")
    const res = await POST(postAlert())

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2) // Discord + Telegram
    for (const [, init] of mockFetch.mock.calls as Array<[string, RequestInit]>) {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal!.aborted).toBe(false)
    }
  })
})
