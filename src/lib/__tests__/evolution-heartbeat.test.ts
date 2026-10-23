import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
  return { mockLogger: logger }
})

vi.mock("@/lib/logger", () => ({
  default: mockLogger,
  logger: mockLogger,
}))

const mockAlerting = vi.hoisted(() => ({
  reportOutage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/alerting-service", () => ({
  AlertingService: mockAlerting,
}))

import { checkWhatsAppSessionHeartbeat } from "../evolution"

describe("checkWhatsAppSessionHeartbeat: Monitor da Sessão WhatsApp", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.EVOLUTION_API_URL = "https://evo.severinno.test"
    process.env.EVOLUTION_API_KEY = "test-api-key"
    process.env.EVOLUTION_INSTANCE = "severinno-gv"
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it("retorna 'connected' quando a instância da Evolution API responde status open", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        instance: {
          instanceName: "severinno-gv",
          state: "open",
        },
      }),
    }) as unknown as typeof fetch

    const result = await checkWhatsAppSessionHeartbeat("severinno-gv")

    expect(result.connected).toBe(true)
    expect(result.status).toBe("connected")
    expect(result.instanceName).toBe("severinno-gv")
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("retorna 'disconnected' e dispara alerta quando a sessão estiver close/desconectada", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        instance: {
          instanceName: "severinno-gv",
          state: "close",
        },
      }),
    }) as unknown as typeof fetch

    const result = await checkWhatsAppSessionHeartbeat("severinno-gv")

    expect(result.connected).toBe(false)
    expect(result.status).toBe("disconnected")
    expect(mockAlerting.reportOutage).toHaveBeenCalledWith(
      "WhatsApp/Evolution",
      expect.stringContaining("desconectada"),
    )
  })

  it("retorna 'unconfigured' se as credenciais de ambiente não existirem", async () => {
    delete process.env.EVOLUTION_API_URL
    delete process.env.EVOLUTION_API_KEY

    const result = await checkWhatsAppSessionHeartbeat()

    expect(result.connected).toBe(false)
    expect(result.status).toBe("unconfigured")
  })
})
