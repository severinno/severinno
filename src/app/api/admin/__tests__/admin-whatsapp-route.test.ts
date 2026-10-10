import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "@/app/api/admin/whatsapp/route"
import { requireRole } from "@/lib/auth"
import * as evolution from "@/lib/evolution"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    whatsAppMessageLog: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "log-1",
          phone: "5511999999999",
          content: "Olá mundo",
          context: "test",
          status: "SENT",
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          user: null,
        },
      ]),
      create: vi.fn().mockResolvedValue({ id: "log-created" }),
    },
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { windowMs: 60000, max: 100 } },
}))

vi.mock("@/lib/evolution", () => ({
  fetchInstance: vi.fn(),
  getConnectionStatus: vi.fn(),
  connectInstance: vi.fn(),
  restartInstance: vi.fn(),
  logoutInstance: vi.fn(),
  getWebhook: vi.fn(),
  setWebhook: vi.fn(),
  sendText: vi.fn(),
  formatPhone: vi.fn((p: string) => p.replace(/\D/g, "")),
  isValidWhatsApp: vi.fn((p: string) => p.length >= 10 && p.length <= 14),
  evolutionLogger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe("Admin WhatsApp Route (/api/admin/whatsapp)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireRole as any).mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
  })

  describe("GET /api/admin/whatsapp", () => {
    it("retorna status consolidado com QR code quando em estado connecting", async () => {
      ;(evolution.fetchInstance as any).mockResolvedValue({
        id: "inst-1",
        name: "severinno",
        connectionStatus: "connecting",
        number: null,
        profileName: null,
        integration: "WHATSAPP-BAILEYS",
        _count: { Message: 10, Contact: 5, Chat: 2 },
      })

      ;(evolution.getConnectionStatus as any).mockResolvedValue({
        instance: { instanceName: "severinno", status: "connecting" },
      })

      ;(evolution.connectInstance as any).mockResolvedValue({
        base64: "data:image/png;base64,mockqr",
        code: "mock-code",
        count: 1,
      })

      ;(evolution.getWebhook as any).mockResolvedValue({
        id: "wb-1",
        url: "https://severinno.com/api/webhooks/evolution",
        enabled: true,
        events: ["MESSAGES_UPSERT"],
      })

      const req = new Request("http://localhost:3000/api/admin/whatsapp")
      const res = await GET(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.instance.name).toBe("severinno")
      expect(json.instance.status).toBe("connecting")
      expect(json.qrcode.base64).toBe("data:image/png;base64,mockqr")
      expect(json.webhook.enabled).toBe(true)
      expect(json.logs).toBeDefined()
      expect(json.logs.length).toBe(1)
    })

    it("retorna dados do dispositivo quando já conectado sem tentar buscar novo QR code", async () => {
      ;(evolution.fetchInstance as any).mockResolvedValue({
        id: "inst-1",
        name: "severinno",
        connectionStatus: "open",
        number: "5511999999999",
        profileName: "Severinno Official",
        integration: "WHATSAPP-BAILEYS",
      })

      ;(evolution.getConnectionStatus as any).mockResolvedValue({
        instance: { instanceName: "severinno", status: "open" },
      })

      ;(evolution.getWebhook as any).mockResolvedValue(null)

      const req = new Request("http://localhost:3000/api/admin/whatsapp")
      const res = await GET(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.instance.status).toBe("open")
      expect(json.instance.number).toBe("5511999999999")
      expect(json.qrcode).toBeNull()
      expect(evolution.connectInstance).not.toHaveBeenCalled()
    })
  })

  describe("POST /api/admin/whatsapp", () => {
    it("dispara mensagem de teste com sucesso para número válido", async () => {
      ;(evolution.sendText as any).mockResolvedValue({ key: { id: "msg-123" } })

      const req = new Request("http://localhost:3000/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_message",
          phone: "11999998888",
          message: "Mensagem de teste unitário",
        }),
      })

      const res = await POST(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.messageId).toBe("msg-123")
      expect(evolution.sendText).toHaveBeenCalled()
    })

    it("rejeita telefone inválido no envio de teste", async () => {
      ;(evolution.isValidWhatsApp as any).mockReturnValue(false)

      const req = new Request("http://localhost:3000/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_message",
          phone: "00000000",
          message: "Teste curto",
        }),
      })

      const res = await POST(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain("telefone informado")
    })

    it("executa ação restart chamando restartInstance", async () => {
      ;(evolution.restartInstance as any).mockResolvedValue({ error: false, message: "Restarted" })

      const req = new Request("http://localhost:3000/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      })

      const res = await POST(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(evolution.restartInstance).toHaveBeenCalled()
    })

    it("executa ação disconnect chamando logoutInstance", async () => {
      ;(evolution.logoutInstance as any).mockResolvedValue({ status: "SUCCESS", error: false })

      const req = new Request("http://localhost:3000/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      })

      const res = await POST(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(evolution.logoutInstance).toHaveBeenCalled()
    })

    it("executa ação sync_webhook chamando setWebhook", async () => {
      ;(evolution.setWebhook as any).mockResolvedValue(undefined)

      const req = new Request("http://localhost:3000/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_webhook" }),
      })

      const res = await POST(req, { params: Promise.resolve({}) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(evolution.setWebhook).toHaveBeenCalled()
    })

    it("retorna 400 para ação desconhecida", async () => {
      const req = new Request("http://localhost:3000/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unknown_action" }),
      })

      const res = await POST(req, { params: Promise.resolve({}) })
      expect(res.status).toBe(400)
    })
  })
})
