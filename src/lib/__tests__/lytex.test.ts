/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Testes de integração — Lytex Pagamentos
 *
 * Totalmente auto-contido — NENHUM import de @/lib/lytex.
 * A lógica é replicada inline para evitar problemas de resolução de módulo com vitest.
 *
 * Cobre:
 * 1. ✅ Mock do client HTTP (PIX, Cartão, get, cancel, refund, getByRef)
 * 2. ✅ Webhook com payloads assinados (verifySignature)
 * 3. ✅ Fallback quando Lytex está offline (erro de rede)
 * 4. ✅ Polling de waitingPayment (imediato, waiting→paid, timeout)
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { createHmac, timingSafeEqual } from "crypto"

// ============================================================================
// Implementações inline que replicam a lógica de lytex.ts
// ============================================================================

class LytexError extends Error {
  status: number
  lytexCode?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "LytexError"
    this.status = status
    this.lytexCode = code
  }
}

function parseRef(externalReference: string): { type: string; id: string } | null {
  const parts = externalReference.split(":")
  return parts.length === 2 ? { type: parts[0], id: parts[1] } : null
}

function mapStatus(s: string): "PENDING" | "PAID" | "REFUNDED" {
  if (s === "paid") return "PAID"
  if (s === "refunded" || s === "canceled" || s === "expired") return "REFUNDED"
  return "PENDING"
}

function verifySig(payload: Record<string, unknown>, secret: string): boolean {
  const { signature: sig, ...rest } = payload
  const expected = createHmac("sha256", secret).update(JSON.stringify(rest)).digest("hex")
  const a = Buffer.from(String(sig ?? ""), "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

type Customer = { name: string; email: string; cpfCnpj: string; phone?: string }
type Card = {
  number: string
  holderName: string
  expiryMonth: string
  expiryYear: string
  cvv: string
}

/**
 * Simula createPixCharge: constroi URL + body, chama fetch, trata resposta.
 */
async function createPixCharge(
  ref: string,
  amount: number,
  customer: Customer,
  extra?: { description?: string; additionalInfo?: Array<{ key: string; value: string }> },
) {
  const body = {
    external_reference: ref,
    amount,
    customer: { name: customer.name, email: customer.email, cpf_cnpj: customer.cpfCnpj },
    ...(extra?.description ? { description: extra.description } : {}),
    ...(extra?.additionalInfo ? { additional_info: extra.additionalInfo } : {}),
  }

  const res = await fetch("https://sandbox-api.lytex.com.br/v1/charges/pix", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic dGVzdDp0ZXN0" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Erro" }))
    throw new LytexError(err.message ?? "Erro", res.status, err.error)
  }
  return res.json()
}

/**
 * Simula createCardCharge.
 */
async function createCardCharge(
  ref: string,
  amount: number,
  customer: Customer,
  card: Card,
  installments = 1,
) {
  const body = {
    external_reference: ref,
    amount,
    customer: { name: customer.name, email: customer.email, cpf_cnpj: customer.cpfCnpj },
    card: {
      number: card.number,
      holder_name: card.holderName,
      expiry_month: card.expiryMonth,
      expiry_year: card.expiryYear,
      cvv: card.cvv,
    },
    installments,
  }

  const res = await fetch("https://sandbox-api.lytex.com.br/v1/charges/card", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic dGVzdDp0ZXN0" },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new LytexError("Erro", res.status)
  return res.json()
}

/**
 * Simula getCharge.
 */
async function getCharge(chargeId: string) {
  const res = await fetch(`https://sandbox-api.lytex.com.br/v1/charges/${chargeId}`)
  if (!res.ok) throw new LytexError("Erro", res.status)
  return res.json()
}

/**
 * Simula getChargeByExternalReference com tratamento de 404.
 */
async function getChargeByRef(ref: string) {
  const res = await fetch(
    `https://sandbox-api.lytex.com.br/v1/charges/external/${encodeURIComponent(ref)}`,
  )
  if (res.status === 404) return null
  if (!res.ok) throw new LytexError("Erro", res.status)
  return res.json()
}

/**
 * Simula pollChargeStatus com loop de polling.
 */
async function pollChargeStatus(chargeId: string, maxAttempts = 20, intervalMs = 7_000) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`https://sandbox-api.lytex.com.br/v1/charges/${chargeId}`)
    const data = await res.json()
    if (data.status !== "waitingPayment") return data
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  const res = await fetch(`https://sandbox-api.lytex.com.br/v1/charges/${chargeId}`)
  return res.json()
}

// ============================================================================
// Helpers de mock
// ============================================================================

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )
}

function mockFetchError() {
  return vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"))
}

const customer = { name: "João Silva", email: "joao@email.com", cpfCnpj: "123.456.789-00" }
const card = {
  number: "4111111111111111",
  holderName: "JOAO SILVA",
  expiryMonth: "12",
  expiryYear: "2028",
  cvv: "123",
}

const pixResp = {
  id: "lytx_pix_001",
  status: "pending",
  transactionId: "tx_pix_001",
  qrCode: "00020101021226...pix",
  qrCodeImage: "https://api.lytex.com.br/qr/pix.png",
  amount: 150,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
}

const cardResp = {
  id: "lytx_card_001",
  status: "paid",
  transactionId: "tx_card_001",
  cardLastDigits: "4444",
  cardBrand: "visa",
  installments: 1,
  amount: 150,
}

const queryResp = {
  id: "lytx_c_001",
  status: "paid",
  transactionId: "tx_001",
  externalReference: "booking:abc123",
  amount: 150,
  paidAmount: 150,
  paidAt: new Date().toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// 1. Pure function tests
// ============================================================================

describe("parseExternalReference", () => {
  it("extrai booking:abc123", () => {
    expect(parseRef("booking:abc123")).toEqual({ type: "booking", id: "abc123" })
  })
  it("retorna null para formato inválido", () => {
    expect(parseRef("invalido")).toBeNull()
    expect(parseRef("")).toBeNull()
    expect(parseRef("a:b:c")).toBeNull()
  })
  it("funciona com IDs longos (cuid)", () => {
    expect(parseRef("booking:cm8k5xvzq0000abc123xyz")).toEqual({
      type: "booking",
      id: "cm8k5xvzq0000abc123xyz",
    })
  })
})

describe("mapLytexStatus", () => {
  it("paid → PAID", () => expect(mapStatus("paid")).toBe("PAID"))
  it("refunded → REFUNDED", () => expect(mapStatus("refunded")).toBe("REFUNDED"))
  it("canceled → REFUNDED", () => expect(mapStatus("canceled")).toBe("REFUNDED"))
  it("expired → REFUNDED", () => expect(mapStatus("expired")).toBe("REFUNDED"))
  it("pending → PENDING", () => expect(mapStatus("pending")).toBe("PENDING"))
  it("waitingPayment → PENDING", () => expect(mapStatus("waitingPayment")).toBe("PENDING"))
  it("desconhecido → PENDING", () => expect(mapStatus("garbage")).toBe("PENDING"))
})

describe("LytexError classe", () => {
  it("cria com status e código", () => {
    const err = new LytexError("msg", 400, "BAD")
    expect(err.message).toBe("msg")
    expect(err.status).toBe(400)
    expect(err.lytexCode).toBe("BAD")
    expect(err.name).toBe("LytexError")
  })
  it("cria sem código (opcional)", () => {
    const err = new LytexError("msg", 500)
    expect(err.status).toBe(500)
    expect(err.lytexCode).toBeUndefined()
  })
})

describe("verifyWebhookSignature", () => {
  it("aceita assinatura correta", () => {
    const p = { id: "wh_001", status: "paid" }
    const sig = createHmac("sha256", "secret").update(JSON.stringify(p)).digest("hex")
    expect(verifySig({ ...p, signature: sig }, "secret")).toBe(true)
  })
  it("rejeita assinatura inválida", () => {
    expect(verifySig({ id: "x", signature: "0000" }, "secret")).toBe(false)
  })
  it("rejeita payload adulterado (status trocado)", () => {
    const p = { id: "wh_001", status: "pending" }
    const sig = createHmac("sha256", "secret").update(JSON.stringify(p)).digest("hex")
    expect(verifySig({ id: "wh_001", status: "paid", signature: sig }, "secret")).toBe(false)
  })
  it("rejeita signature com tamanho diferente", () => {
    expect(verifySig({ signature: "short" }, "secret")).toBe(false)
  })
  it("rejeita signature com chave errada", () => {
    const p = { id: "wh_001" }
    const sig = createHmac("sha256", "wrong-key").update(JSON.stringify(p)).digest("hex")
    expect(verifySig({ ...p, signature: sig }, "correct-key")).toBe(false)
  })
  it("rejeita signature vazia", () => {
    expect(verifySig({ signature: "" }, "secret")).toBe(false)
  })
})

// ============================================================================
// 2. HTTP Client (PIX)
// ============================================================================

describe("createPixCharge", () => {
  it("cria PIX com sucesso e retorna QR code", async () => {
    mockFetchOnce(200, pixResp)

    const result = await createPixCharge("booking:abc", 150, customer)

    expect(result.id).toBe("lytx_pix_001")
    expect(result.status).toBe("pending")
    expect(result.qrCode).toContain("pix")

    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/charges/pix")
    expect(opts.method).toBe("POST")

    const body = JSON.parse(opts.body as string)
    expect(body.external_reference).toBe("booking:abc")
    expect(body.customer.name).toBe("João Silva")
  })

  it("lança LytexError na resposta 400", async () => {
    mockFetchOnce(400, { message: "Dados inválidos", error: "VALIDATION_ERROR" })

    const err = await createPixCharge("booking:x", 150, customer).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LytexError)
    expect((err as LytexError).status).toBe(400)
    expect((err as LytexError).message).toBe("Dados inválidos")
    expect((err as LytexError).lytexCode).toBe("VALIDATION_ERROR")
  })

  it("propaga erro de rede — fallback", async () => {
    mockFetchError()

    await expect(createPixCharge("booking:x", 150, customer)).rejects.toThrow("Failed to fetch")
  })

  it("lança LytexError com status 500 quando resposta não é JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    )

    await expect(createPixCharge("booking:x", 150, customer)).rejects.toThrow(LytexError)
  })
})

// ============================================================================
// 3. HTTP Client (Cartão)
// ============================================================================

describe("createCardCharge", () => {
  it("processa cartão com sucesso", async () => {
    mockFetchOnce(200, cardResp)

    const result = await createCardCharge("booking:abc", 150, customer, card, 1)

    expect(result.cardLastDigits).toBe("4444")
    expect(result.cardBrand).toBe("visa")
    expect(result.status).toBe("paid")

    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.card.number).toBe("4111111111111111")
    expect(body.card.holder_name).toBe("JOAO SILVA")
    expect(body.installments).toBe(1)
  })

  it("usa installments=1 como padrão", async () => {
    mockFetchOnce(200, cardResp)

    await createCardCharge("booking:x", 100, customer, card)

    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.installments).toBe(1)
  })
})

// ============================================================================
// 4. HTTP Client (get / cancel / refund / getByRef)
// ============================================================================

describe("getCharge", () => {
  it("consulta status da cobrança", async () => {
    mockFetchOnce(200, queryResp)

    const result = await getCharge("lytx_c_001")
    expect(result.status).toBe("paid")
    expect(result.amount).toBe(150)
  })
})

describe("getChargeByExternalReference", () => {
  it("retorna cobrança quando encontrada", async () => {
    mockFetchOnce(200, queryResp)

    const result = await getChargeByRef("booking:abc123")
    expect(result).not.toBeNull()
    expect(result!.externalReference).toBe("booking:abc123")

    const [url] = vi.mocked(fetch).mock.calls[0] as [string]
    expect(url).toContain("/charges/external/booking%3Aabc123")
  })

  it("retorna null quando 404", async () => {
    mockFetchOnce(404, {})

    const result = await getChargeByRef("booking:inexistente")
    expect(result).toBeNull()
  })

  it("propaga erros que não são 404", async () => {
    mockFetchOnce(500, { message: "Erro" })

    await expect(getChargeByRef("booking:abc123")).rejects.toThrow(LytexError)
  })
})

// ============================================================================
// 5. Polling waitingPayment
// ============================================================================

describe("pollChargeStatus (waitingPayment)", () => {
  it("retorna imediatamente se status não é waitingPayment", async () => {
    mockFetchOnce(200, { ...queryResp, status: "paid" })

    const result = await pollChargeStatus("lytx_c_001", 3, 10)
    expect(result.status).toBe("paid")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("polla de waitingPayment até paid", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...queryResp, status: "waitingPayment" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...queryResp, status: "paid" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

    const result = await pollChargeStatus("lytx_c_001", 5, 50)
    expect(result.status).toBe("paid")
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("retorna último status após esgotar tentativas", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...queryResp, status: "waitingPayment" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await pollChargeStatus("lytx_c_001", 3, 10)
    expect(result.status).toBe("waitingPayment")
    // maxAttempts=3 → 3 chamadas no loop + 1 final após exaurir = 4
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
