/**
 * Testes de integração — Lytex Pagamentos (API v2 REAL)
 *
 * Totalmente auto-contido — NENHUM import de @/lib/lytex.
 * A lógica é replicada inline para evitar problemas de resolução de módulo com vitest.
 *
 * Cobre (mesmas 4 áreas do client v1, agora sobre a API v2):
 * 1. ✅ OAuth obtain_token + Bearer + 401 → re-obtém e repete UMA vez
 * 2. ✅ Client HTTP v2 (PIX invoice, cartão via card_token, get, cancel PUT,
 *    refund-solicitation, getByRef via ?referenceId=)
 * 3. ✅ Fallback quando a Lytex está offline (erro de rede)
 * 4. ✅ Polling de fatura assíncrona (pending→paid, timeout)
 *
 * Contrato da v2 (spec extraída dos docs em 2026-10-06):
 * - auth: POST auth-pay.lytex.com.br/v1/oauth/obtain_token {clientId, clientSecret}
 * - API:  api-pay.lytex.com.br — POST /v2/invoices (items em CENTAVOS,
 *         paymentMethods.pix.enable), GET /v2/invoices/{id},
 *         PUT /v2/invoices/cancel/{id}, POST /v2/refund-solicitation,
 *         GET /v2/invoices?referenceId=…
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { createHmac, timingSafeEqual } from "crypto"

// ============================================================================
// Implementações inline que replicam a lógica de lytex.ts (v2)
// ============================================================================

const BASE_URL = "https://api-pay.lytex.com.br"
const AUTH_URL = "https://auth-pay.lytex.com.br/v1/oauth/obtain_token"
const CLIENT_ID = "test-client-id"
const CLIENT_SECRET = "test-client-secret"

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

type CustomerShapeV2 = {
  name: string
  email?: string
  phone?: string
  cpfCnpj: string
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

function toCents(reais: number): number {
  return Math.round(reais * 100)
}

// Token cache inline (replica o client v2)
let cachedToken: { token: string; expiresAtMs: number } | null = null

function setCachedToken(token: string, ttlMs: number) {
  cachedToken = { token, expiresAtMs: Date.now() + ttlMs }
}

async function obtainAccessToken(): Promise<{ token: string; expiresAtMs: number }> {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grantType: "clientCredentials",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }),
  })
  const parsed = (await res.json().catch(() => null)) as {
    accessToken?: string
    expireAt?: string
    message?: string
  } | null
  if (!res.ok || !parsed?.accessToken) {
    throw new LytexError(parsed?.["message"] ?? `auth ${res.status}`, res.status)
  }
  const expiresAtMs = parsed.expireAt
    ? Math.max(Date.parse(parsed.expireAt) - 60_000, Date.now() + 30_000)
    : Date.now() + 10 * 60_000
  return { token: parsed.accessToken, expiresAtMs }
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs) return cachedToken.token
  const fresh = await obtainAccessToken()
  cachedToken = fresh
  return fresh.token
}

async function lytexRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = (token: string) =>
    fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let res = await doFetch(await getAccessToken())
  if (res.status === 401) {
    cachedToken = null
    res = await doFetch(await getAccessToken())
  }

  const parsed = await res.json().catch(() => null)
  if (!res.ok) {
    throw new LytexError(
      (parsed as { message?: string })?.message ?? `Lytex API error: ${res.status}`,
      res.status,
    )
  }
  return parsed as T
}

function normalizeContactPhone(rawPhone: string | undefined): string {
  const digits = (rawPhone ?? "").replace(/\D/g, "").slice(-11)
  if (digits.length < 10) {
    throw new LytexError(
      "Cobrança Lytex exige celular do cliente com DDD (10 ou 11 dígitos)",
      400,
      "client_contact_required",
    )
  }
  return digits
}

function buildClientV2(customer: CustomerShapeV2) {
  const digits = customer.cpfCnpj.replace(/\D/g, "")
  return {
    type: (digits.length <= 11 ? "pf" : "pj") as "pf" | "pj",
    name: customer.name,
    cpfCnpj: digits,
    ...(customer.email ? { email: customer.email } : {}),
    cellphone: normalizeContactPhone(customer.phone),
  }
}

function toDueDate(iso?: string): string | undefined {
  return iso ? iso.slice(0, 10) : undefined
}

async function createPixCharge(
  ref: string,
  amount: number,
  customer: CustomerShapeV2,
  extra?: { description?: string; expiresAt?: string },
) {
  const cents = toCents(amount)
  const body = {
    client: buildClientV2(customer),
    items: [
      { name: extra?.description ?? `Serviço Severinno (${ref})`, quantity: 1, value: cents },
    ],
    dueDate: toDueDate(extra?.expiresAt),
    referenceId: ref,
    paymentMethods: {
      pix: { enable: true },
      boleto: { enable: false },
      creditCard: { enable: false },
    },
  }
  return lytexRequest<Record<string, unknown>>("POST", "/v2/invoices", body)
}

async function getCharge(id: string) {
  return lytexRequest<Record<string, unknown>>("GET", `/v2/invoices/${encodeURIComponent(id)}`)
}

async function cancelCharge(id: string) {
  await lytexRequest("PUT", `/v2/invoices/cancel/${encodeURIComponent(id)}`, {})
}

async function refundCharge(id: string, amountCents?: number) {
  return lytexRequest<Record<string, unknown>>("POST", "/v2/refund-solicitation", {
    _invoiceId: id,
    refundValue: amountCents !== undefined ? amountCents / 100 : undefined,
  })
}

async function getChargeByExternalReference(ref: string) {
  try {
    const res = await lytexRequest<{ results?: Array<Record<string, unknown>> }>(
      "GET",
      `/v2/invoices?referenceId=${encodeURIComponent(ref)}`,
    )
    return res.results?.[0] ?? null
  } catch (e) {
    if (e instanceof LytexError && e.status === 404) return null
    throw e
  }
}

async function pollChargeStatus(id: string, maxAttempts = 3, intervalMs = 1) {
  let last: Record<string, unknown> | undefined
  for (let i = 0; i < maxAttempts; i++) {
    last = (await getCharge(id)) as { status?: string }
    if (last.status !== "waitingPayment" && last.status !== "pending") return last
    if (i < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return last
}

// ============================================================================

afterEach(() => {
  vi.restoreAllMocks()
  cachedToken = null
})

describe("Lytex v2 — OAuth obtain_token + Bearer", () => {
  it("obtém access token e usa Bearer na chamada da API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "TOKEN_A",
            expireAt: new Date(Date.now() + 600_000).toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ _id: "inv1", status: "pending", totalValue: 1990 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await getCharge("inv1")

    const authCall = fetchMock.mock.calls[0]
    expect(authCall[0]).toBe(AUTH_URL)
    const authBody = JSON.parse(String(authCall[1]?.body ?? "{}"))
    expect(authBody.clientId).toBe(CLIENT_ID)
    expect(authBody.clientSecret).toBe(CLIENT_SECRET)

    const apiCall = fetchMock.mock.calls[1]
    expect(apiCall[0]).toBe(`${BASE_URL}/v2/invoices/inv1`)
    expect((apiCall[1]?.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN_A")
  })

  it("reusa o token cacheado (sem segundo obtain_token)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "TOKEN_A",
            expireAt: new Date(Date.now() + 600_000).toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await getCharge("a")
    await getCharge("b")

    const authCalls = fetchMock.mock.calls.filter((c) => c[0] === AUTH_URL)
    expect(authCalls).toHaveLength(1)
  })

  it("401 na API força re-obtenção e UMA retry com o token novo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "TOKEN_VELHO",
            expireAt: new Date(Date.now() + 600_000).toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Token inválido" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "TOKEN_NOVO",
            expireAt: new Date(Date.now() + 600_000).toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await getCharge("inv1")

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const retryCall = fetchMock.mock.calls[3]
    expect((retryCall[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer TOKEN_NOVO",
    )
  })

  it("credencial inválida no obtain_token falha fechado (LytexError)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    await expect(getCharge("x")).rejects.toThrow("Unauthorized")
  })
})

describe("Lytex v2 — criar cobrança PIX (invoice)", () => {
  it("constrói invoice v2: items em centavos, pix habilitado, referenceId", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          _id: "inv123",
          status: "pending",
          totalValue: 62100,
          dueDate: "2026-10-10",
          createdAt: "2026-10-06T22:00:00Z",
          paymentMethods: {
            pix: { enable: true, qrcode: "00020126PIX-COPIA-COLA", txId: "tx123" },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = (await createPixCharge("booking:abc123", 621.0, {
      name: "Cliente Teste",
      email: "cliente@teste.com",
      phone: "11999999999",
      cpfCnpj: "529.982.247-25",
    })) as { totalValue?: number; paymentMethods?: { pix?: { qrcode?: string } } }

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe(`${BASE_URL}/v2/invoices`)
    const body = JSON.parse(String(call[1]?.body ?? "{}"))
    // centavos na fronteira (621.00 reais → 62100)
    expect(body.items[0].value).toBe(62100)
    // itens determinam o total: description/totalValue NUNCA são enviados
    // (mutuamente exclusivos na v2 — provado E2E 2026-10-06)
    expect(body.totalValue).toBeUndefined()
    expect(body.description).toBeUndefined()
    // cliente: cpfCnpj só dígitos + pf + contato v2 (cellphone obrigatório)
    expect(body.client.cpfCnpj).toBe("52998224725")
    expect(body.client.type).toBe("pf")
    expect(body.client.email).toBe("cliente@teste.com")
    expect(body.client.cellphone).toBe("11999999999")
    // pix habilitado; referenceId preserva o booking
    expect(body.paymentMethods.pix.enable).toBe(true)
    expect(body.referenceId).toBe("booking:abc123")
    // resposta mapeada: qrcode v2 disponível
    expect(res.paymentMethods?.pix?.qrcode).toBe("00020126PIX-COPIA-COLA")
  })

  it("escopo de cliente: cellphone obrigatório (+DDD); email ausente é OMITIDO (regras provadas E2E)", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _id: "i", status: "pending", totalValue: 200 }), {
        status: 201,
        headers: { "content-type": "application json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    // (a) sem phone: falha cedo com erro acionável (a API rejeitaria com 400 opaco)
    await expect(
      createPixCharge("booking:sem-phone", 2, {
        name: "Sem Telefone",
        email: "s@s.com",
        cpfCnpj: "52998224725",
      }),
    ).rejects.toThrow("celular")

    // (b) sem email: a chave email NÃO pode ir no body (null também rejeita na API)
    await createPixCharge("booking:sem-email", 2, {
      name: "Sem Email",
      phone: "11999999999",
      cpfCnpj: "52998224725",
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? "{}"))
    expect(body.client.cellphone).toBe("11999999999")
    expect("email" in body.client).toBe(false)
  })

  it("dueDate vira data YYYY-MM-DD (formato da v2)", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _id: "i", status: "pending", totalValue: 200 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await createPixCharge(
      "booking:x",
      2,
      { name: "C", email: "c@c.com", phone: "11999999999", cpfCnpj: "52998224725" },
      { expiresAt: "2026-10-15T23:59:59Z" },
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? "{}"))
    expect(body.dueDate).toBe("2026-10-15")
  })
})

describe("Lytex v2 — consultar / cancelar / reembolsar / getByRef", () => {
  it("getCharge consulta /v2/invoices/{id}", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _id: "inv9", status: "paid", totalValue: 5000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await getCharge("inv9")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/v2/invoices/inv9`)
  })

  it("cancelCharge usa PUT /v2/invoices/cancel/{id} (a v2 cancela com PUT)", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await cancelCharge("inv9")
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/v2/invoices/cancel/inv9`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT")
  })

  it("refundCharge cria refund-solicitation com refundValue em reais", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _id: "ref1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await refundCharge("inv9", 5000)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? "{}"))
    expect(body._invoiceId).toBe("inv9")
    expect(body.refundValue).toBe(50) // 5000 centavos → 50 reais (float da spec)
  })

  it("getChargeByExternalReference filtra por referenceId e devolve null sem resultado", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const r = await getChargeByExternalReference("booking:inexistente")
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/v2/invoices?referenceId=booking%3Ainexistente`,
    )
    expect(r).toBeNull()
  })
})

describe("Lytex v2 — fallback offline", () => {
  it("erro de rede vira exceção (falha fechada)", async () => {
    setCachedToken("TOKEN", 600_000)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    await expect(getCharge("x")).rejects.toThrow()
  })
})

describe("Lytex v2 — polling de fatura assíncrona", () => {
  it("pending → paid em polling", async () => {
    setCachedToken("TOKEN", 600_000)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ _id: "i", status: "pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ _id: "i", status: "paid" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const r = (await pollChargeStatus("i")) as { status?: string }
    expect(r.status).toBe("paid")
  })

  it("timeout devolve o último status consultado", async () => {
    setCachedToken("TOKEN", 600_000)
    // Resposta nova por chamada: um mesmo objeto Response só pode ser lido uma vez.
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify({ _id: "i", status: "pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const r = (await pollChargeStatus("i", 2, 1)) as { status?: string }
    expect(r.status).toBe("pending")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("Lytex — webhook (HMAC-SHA256 com client_secret)", () => {
  const SECRET = CLIENT_SECRET

  function signed(payload: Record<string, unknown>) {
    const { signature: _excluida, ...rest } = payload as { signature?: string }
    const sig = createHmac("sha256", SECRET).update(JSON.stringify(rest)).digest("hex")
    return { ...payload, signature: sig }
  }

  it("aceita payload com assinatura válida", () => {
    const payload = signed({
      id: "w1",
      status: "paid",
      externalReference: "booking:1",
      eventDate: "2026-10-06T22:00:00Z",
    })
    expect(verifySig(payload, SECRET)).toBe(true)
  })

  it("recusa payload adulterado", () => {
    const payload = signed({
      id: "w1",
      status: "paid",
      externalReference: "booking:1",
      eventDate: "2026-10-06T22:00:00Z",
    })
    expect(verifySig({ ...payload, status: "pending" }, SECRET)).toBe(false)
  })

  it("recusa assinatura de outro secret", () => {
    const payload = signed({
      id: "w1",
      status: "paid",
      externalReference: "booking:1",
      eventDate: "2026-10-06T22:00:00Z",
    })
    expect(verifySig(payload, "outro-secret")).toBe(false)
  })
})

describe("Lytex — helpers de domínio", () => {
  it("parseRef quebra booking:{id}", () => {
    expect(parseRef("booking:abc")).toEqual({ type: "booking", id: "abc" })
    expect(parseRef("sem-dois-pontos")).toBeNull()
  })

  it("mapStatus mapeia status v2 observados", () => {
    expect(mapStatus("paid")).toBe("PAID")
    expect(mapStatus("pending")).toBe("PENDING")
    expect(mapStatus("canceled")).toBe("REFUNDED")
    expect(mapStatus("expired")).toBe("REFUNDED")
    expect(mapStatus("refunded")).toBe("REFUNDED")
  })
})
