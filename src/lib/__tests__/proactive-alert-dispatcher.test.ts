import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  formatProactiveAlertMessage,
  getSeverityEmoji,
  dispatchProactiveAlert,
  getProactiveAlertHistory,
  clearProactiveAlertHistory,
} from "../proactive-alert-dispatcher"
import * as safeFetchModule from "../safe-fetch"

describe("proactive-alert-dispatcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearProactiveAlertHistory()
    delete process.env.EVOLUTION_API_KEY
    delete process.env.WHATSAPP_API_KEY
    delete process.env.OPS_WHATSAPP_NUMBER
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.ALERT_WEBHOOK_URL
  })

  it("retorna o emoji correspondente para cada severidade", () => {
    expect(getSeverityEmoji("INFO")).toBe("ℹ️")
    expect(getSeverityEmoji("WARNING")).toBe("⚠️")
    expect(getSeverityEmoji("CRITICAL")).toBe("🚨")
    expect(getSeverityEmoji("EMERGENCY")).toBe("🛑")
  })

  it("formata a mensagem em markdown limpo com métrica e metadata", () => {
    const formatted = formatProactiveAlertMessage({
      category: "DISK_PRESSURE",
      severity: "WARNING",
      title: "Uso de disco elevado",
      message: "O disco ultrapassou o limiar de 70%",
      metric: "72% ocupado",
      metadata: { freeGb: "54 GB", host: "vps-hostinger" },
    })

    expect(formatted).toContain("⚠️ *[SEVERINNO OPS] WARNING*")
    expect(formatted).toContain("*Uso de disco elevado*")
    expect(formatted).toContain("O disco ultrapassou o limiar de 70%")
    expect(formatted).toContain("📊 *Métrica:* `72% ocupado`")
    expect(formatted).toContain("• *freeGb:* 54 GB")
    expect(formatted).toContain("• *host:* vps-hostinger")
  })

  it("dispara alerta via WhatsApp pela Evolution API quando credenciais estão presentes", async () => {
    process.env.EVOLUTION_API_KEY = "test-key"
    process.env.EVOLUTION_API_URL = "http://evolution:8080"
    process.env.EVOLUTION_INSTANCE = "severinno"
    process.env.OPS_WHATSAPP_NUMBER = "5533999998888"

    const fetchSpy = vi.spyOn(safeFetchModule, "safeFetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "SUCCESS" }),
    } as any)

    const result = await dispatchProactiveAlert({
      category: "PAYMENT_FAILURE",
      severity: "CRITICAL",
      title: "Falha na liquidação Pix",
      message: "Split de pagamento rejeitado pelo gateway",
    })

    expect(result.dispatched).toBe(true)
    expect(result.channels.whatsapp).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://evolution:8080/message/sendText/severinno",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "test-key",
        }),
      }),
    )

    const history = getProactiveAlertHistory()
    expect(history.length).toBe(1)
    expect(history[0].category).toBe("PAYMENT_FAILURE")
    expect(history[0].channelsSent).toContain("whatsapp")
  })

  it("dispara alerta via Telegram Bot quando credenciais estão presentes", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF"
    process.env.TELEGRAM_CHAT_ID = "-100123456789"

    const fetchSpy = vi.spyOn(safeFetchModule, "safeFetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as any)

    const result = await dispatchProactiveAlert({
      category: "SYSTEM_RESTART",
      severity: "CRITICAL",
      title: "Contêiner Redis reiniciado",
      message: "O contêiner severinno-redis-1 foi reiniciado",
    })

    expect(result.dispatched).toBe(true)
    expect(result.channels.telegram).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123456:ABC-DEF/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("-100123456789"),
      }),
    )
  })

  it("aplica debounce de 5 minutos para alertas não-críticos da mesma categoria", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF"
    process.env.TELEGRAM_CHAT_ID = "-100123456789"

    vi.spyOn(safeFetchModule, "safeFetch").mockResolvedValue({
      ok: true,
      status: 200,
    } as any)

    // Primeiro disparo (WARNING): deve enviar
    const res1 = await dispatchProactiveAlert({
      category: "DISK_PRESSURE",
      severity: "WARNING",
      title: "Disco 71%",
      message: "Primeiro aviso",
    })
    expect(res1.debounced).toBe(false)
    expect(res1.dispatched).toBe(true)

    // Segundo disparo imediato da mesma categoria (WARNING): deve ser suprimido por debounce
    const res2 = await dispatchProactiveAlert({
      category: "DISK_PRESSURE",
      severity: "WARNING",
      title: "Disco 72%",
      message: "Segundo aviso repetido",
    })
    expect(res2.debounced).toBe(true)
    expect(res2.dispatched).toBe(false)

    // Terceiro disparo mas com severidade CRITICAL: deve furar o debounce
    const res3 = await dispatchProactiveAlert({
      category: "DISK_PRESSURE",
      severity: "CRITICAL",
      title: "Disco 85%",
      message: "Nível crítico ultrapassado",
    })
    expect(res3.debounced).toBe(false)
    expect(res3.dispatched).toBe(true)
  })
})
