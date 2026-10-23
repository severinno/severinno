import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { sendAlertWebhook } from "../alert-webhook"

describe("sendAlertWebhook (src/lib/alert-webhook.ts)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("does nothing when no webhook environment variables are configured", async () => {
    const mockFetch = vi.mocked(fetch)
    await sendAlertWebhook({
      severity: "critical",
      title: "DB Outage",
      message: "Connection lost",
      metric: "latency > 5000ms",
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("dispatches formatted payload to Discord webhook", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await sendAlertWebhook({
      severity: "critical",
      title: "PostGIS Error",
      message: "Extension down",
      metric: "db_error",
      metadata: { host: "db-primary" },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe("https://discord.com/api/webhooks/123/abc")
    const body = JSON.parse(call[1]!.body as string)
    expect(body.username).toBe("Severinno Alerts")
    expect(body.embeds[0].title).toContain("PostGIS Error")
    expect(body.embeds[0].color).toBe(0xe74c3c)
    expect(body.embeds[0].fields).toContainEqual({
      name: "Metric",
      value: "db_error",
      inline: true,
    })
    expect(body.embeds[0].fields).toContainEqual({
      name: "host",
      value: "db-primary",
      inline: true,
    })
  })

  it("dispatches formatted payload to Slack webhook", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T00/B00/X00")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await sendAlertWebhook({
      severity: "warning",
      title: "Latency Warning",
      message: "API SLA breach",
      metric: "latency_ms",
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe("https://hooks.slack.com/services/T00/B00/X00")
    const body = JSON.parse(call[1]!.body as string)
    expect(body.text).toContain("Latency Warning")
    expect(body.text).toContain("🟡")
  })

  it("dispatches formatted payload to Telegram bot API", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:ABC-DEF")
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456789")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await sendAlertWebhook({
      severity: "critical",
      title: "Core Service Failure",
      message: "Redis unavailable",
      metric: "redis_ping",
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe("https://api.telegram.org/bot123456:ABC-DEF/sendMessage")
    const body = JSON.parse(call[1]!.body as string)
    expect(body.chat_id).toBe("-100123456789")
    expect(body.text).toContain("Core Service Failure")
  })

  it("dispatches payload to generic incident webhook", async () => {
    vi.stubEnv("INCIDENT_WEBHOOK_URL", "https://incident.company.internal/webhook")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await sendAlertWebhook({
      severity: "critical",
      title: "Kubernetes Pod Crash",
      message: "OOMKilled",
      metric: "memory_mb",
      metadata: { pod: "worker-0" },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe("https://incident.company.internal/webhook")
    const body = JSON.parse(call[1]!.body as string)
    expect(body.title).toBe("Kubernetes Pod Crash")
    expect(body.metadata).toEqual({ pod: "worker-0" })
  })
})
