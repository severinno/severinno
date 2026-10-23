import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

vi.mock("@/lib/whatsapp-queue", () => ({
  enqueueWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/ai-client", () => ({
  chatCompletionHybrid: vi.fn(),
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import {
  processAiTriage,
  classifyIntentHeuristic,
  type AiTriageContext,
} from "../whatsapp-ai-triage"
import { chatCompletionHybrid } from "@/lib/ai-client"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { cacheGet } from "@/lib/redis"
import { db } from "@/lib/db"

describe("WhatsApp AI Triage Engine (whatsapp-ai-triage.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("classifyIntentHeuristic (Camada 3 Fallback)", () => {
    it("classifica busca por encanador e detecta emergência", () => {
      const res = classifyIntentHeuristic(
        "Socorro, cano estourou e está alagando a cozinha no Centro",
      )
      expect(res.intent).toBe("SERVICE_SEARCH")
      expect(res.category).toBe("Encanador")
      expect(res.urgency).toBe("EMERGENCY")
    })

    it("classifica busca por eletricista com urgência normal", () => {
      const res = classifyIntentHeuristic("Preciso trocar a fiação e o chuveiro 220v")
      expect(res.intent).toBe("SERVICE_SEARCH")
      expect(res.category).toBe("Eletricista")
      expect(res.urgency).toBe("NORMAL")
    })

    it("classifica dúvidas sobre escrow e pagamento com PIX", () => {
      const res = classifyIntentHeuristic(
        "Como funciona o pagamento? É seguro pagar via PIX ou tem garantia?",
      )
      expect(res.intent).toBe("ESCROW_PAYMENT")
    })

    it("identifica pedido de suporte humano ou reclamação", () => {
      const res = classifyIntentHeuristic("Quero falar com pessoa atendente humano urgente")
      expect(res.intent).toBe("SUPPORT_COMPLAINT")
      expect(res.urgency).toBe("HIGH")
    })

    it("identifica dúvidas sobre o funcionamento do marketplace Severinno", () => {
      const res = classifyIntentHeuristic("O que é o Severinno e como funciona em Valadares?")
      expect(res.intent).toBe("PLATFORM_INFO")
    })

    it("detecta interação operacional direta entre cliente e prestador", () => {
      const res = classifyIntentHeuristic("Já cheguei e estou descendo para abrir o portão")
      expect(res.intent).toBe("DIRECT_INTERACTION")
    })
  })

  describe("processAiTriage com IA Híbrida (Ollama / Groq / Fallback)", () => {
    it("processa com IA Híbrida e responde busca de serviço com link e garantia Escrow", async () => {
      vi.mocked(chatCompletionHybrid).mockResolvedValueOnce({
        content: JSON.stringify({
          intent: "SERVICE_SEARCH",
          category: "Climatização",
          neighborhood: "Ilha dos Araújos",
          urgency: "NORMAL",
          confidence: 0.95,
        }),
        engine: "local_ollama",
        model: "qwen2.5:0.5b",
        latencyMs: 320,
      })

      const ctx: AiTriageContext = {
        phone: "5533999991234",
        text: "Vocês têm técnico para consertar ar condicionado split na Ilha dos Araújos?",
        user: { id: "user-1", name: "Carlos Silva" },
        remoteJid: "5533999991234@s.whatsapp.net",
      }

      const res = await processAiTriage(ctx)

      expect(res.handled).toBe(true)
      expect(res.intent).toBe("SERVICE_SEARCH")
      expect(res.category).toBe("Climatização")
      expect(res.neighborhood).toBe("Ilha dos Araújos")
      expect(res.engineUsed).toBe("local_ollama")

      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5533999991234",
          text: expect.stringContaining("Severinno Match Inteligente"),
          context: "ai:triage:service_search",
        }),
      )
    })

    it("não intercepta quando a IA identifica DIRECT_INTERACTION entre as partes", async () => {
      vi.mocked(chatCompletionHybrid).mockResolvedValueOnce({
        content: JSON.stringify({
          intent: "DIRECT_INTERACTION",
          category: null,
          confidence: 0.98,
        }),
        engine: "cloud_groq",
        model: "llama-3.3-70b-versatile",
        latencyMs: 180,
      })

      const ctx: AiTriageContext = {
        phone: "5533999991234",
        text: "O interfone é 102, pode tocar que eu desço",
        user: { id: "user-1", name: "Carlos Silva" },
        remoteJid: "5533999991234@s.whatsapp.net",
      }

      const res = await processAiTriage(ctx)

      expect(res.handled).toBe(false)
      expect(res.intent).toBe("DIRECT_INTERACTION")
      expect(enqueueWhatsApp).not.toHaveBeenCalled()
    })

    it("responde consulta de STATUS_INQUIRY com dados reais do banco", async () => {
      vi.mocked(chatCompletionHybrid).mockResolvedValueOnce({
        content: JSON.stringify({
          intent: "STATUS_INQUIRY",
          confidence: 0.9,
        }),
        engine: "local_ollama",
        model: "qwen2.5:0.5b",
        latencyMs: 250,
      })

      vi.mocked(db.booking.findFirst).mockResolvedValueOnce({
        id: "cm1234567890",
        clientId: "user-client-1",
        providerId: "user-provider-1",
        status: "CONFIRMED",
        scheduledAt: new Date("2026-10-18T14:00:00Z"),
        service: { title: "Instalação de Tomada 220V" },
        provider: { name: "Marcos Eletricista", phone: "5533988881111" },
        client: { name: "Maria Oliveira" },
      } as any)

      const ctx: AiTriageContext = {
        phone: "5533999995555",
        text: "Que horas o eletricista vai vir amanhã?",
        user: { id: "user-client-1", name: "Maria Oliveira" },
        remoteJid: "5533999995555@s.whatsapp.net",
      }

      const res = await processAiTriage(ctx)

      expect(res.handled).toBe(true)
      expect(res.intent).toBe("STATUS_INQUIRY")
      expect(db.booking.findFirst).toHaveBeenCalled()
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("#cm123456"),
        }),
      )
    })

    it("cai no fallback heurístico determinístico quando a IA gera erro/timeout", async () => {
      vi.mocked(chatCompletionHybrid).mockRejectedValueOnce(new Error("Timeout Ollama"))

      const ctx: AiTriageContext = {
        phone: "5533999997777",
        text: "Como funciona a garantia do pagamento?",
        user: null,
        remoteJid: "5533999997777@s.whatsapp.net",
      }

      const res = await processAiTriage(ctx)

      expect(res.handled).toBe(true)
      expect(res.intent).toBe("ESCROW_PAYMENT")
      expect(res.engineUsed).toBe("heuristic_fallback")
      expect(enqueueWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Garantia Severinno Escrow & Pagamentos"),
        }),
      )
    })

    it("ignora mensagens de grupos do WhatsApp (@g.us)", async () => {
      const ctx: AiTriageContext = {
        phone: "5533999998888",
        text: "Alguém conhece pintor em Valadares?",
        user: null,
        remoteJid: "1203630234567890@g.us",
      }

      const res = await processAiTriage(ctx)

      expect(res.handled).toBe(false)
      expect(chatCompletionHybrid).not.toHaveBeenCalled()
      expect(enqueueWhatsApp).not.toHaveBeenCalled()
    })

    it("respeita cooldown para evitar loops de mensagens automatizadas", async () => {
      vi.mocked(cacheGet).mockResolvedValueOnce("1") // Em cooldown

      const ctx: AiTriageContext = {
        phone: "5533999999999",
        text: "Preciso de diarista",
        user: null,
        remoteJid: "5533999999999@s.whatsapp.net",
      }

      const res = await processAiTriage(ctx)

      expect(res.handled).toBe(false)
      expect(chatCompletionHybrid).not.toHaveBeenCalled()
      expect(enqueueWhatsApp).not.toHaveBeenCalled()
    })
  })
})
