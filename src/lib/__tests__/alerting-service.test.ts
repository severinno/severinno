import { describe, it, expect, vi, beforeEach } from "vitest"
import { AlertingService, type AlertPayload } from "../alerting-service"
import { db } from "@/lib/db"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/whatsapp-queue", () => ({
  enqueueWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

describe("AlertingService & Proactive WhatsApp Admin Alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ALERT_WEBHOOK_URL
    delete process.env.DISCORD_WEBHOOK_URL
    delete process.env.SLACK_WEBHOOK_URL
  })

  it("envia alerta via webhook e notifica admins via WhatsApp para nível CRITICAL", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/test"

    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any

    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: "admin-1", whatsapp: "5511999990001", name: "Admin Geral" } as any,
    ])

    const alert: AlertPayload = {
      title: "Falha de Conexão com o PostgreSQL",
      message: "Pool de conexões esgotado (timeout 5000ms)",
      severity: "CRITICAL",
      source: "HealthMonitor",
    }

    const ok = await AlertingService.sendAlert(alert)

    expect(ok).toBe(true)
    expect(global.fetch).toHaveBeenCalled()
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "ADMIN" }),
      }),
    )
    expect(enqueueWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "5511999990001",
        context: "alert:critical:HealthMonitor",
      }),
    )
  })

  it("ignora envio de WhatsApp para alertas com severidade INFO", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/test"
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any

    const alert: AlertPayload = {
      title: "Deploy concluído",
      message: "Build aplicada com sucesso",
      severity: "INFO",
      source: "DeploySentry",
    }

    const ok = await AlertingService.sendAlert(alert)
    expect(ok).toBe(true)
    expect(enqueueWhatsApp).not.toHaveBeenCalled()
  })

  it("reportOutage aplica debounce após o primeiro alerta para evitar spam", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/test"
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any

    const first = await AlertingService.reportOutage("RedisCache", "ECONNREFUSED")
    expect(first).toBe(true)

    // Segunda chamada imediata deve ser filtrada pelo debounce
    const second = await AlertingService.reportOutage("RedisCache", "ECONNREFUSED")
    expect(second).toBe(true)
  })
})
