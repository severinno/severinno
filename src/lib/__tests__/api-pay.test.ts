/**
 * Tests for payBooking/newIdempotencyKey in src/lib/api.ts — o ponto ÚNICO
 * do contrato que garante que todo POST /api/bookings/[id]/pay (PIX e CARTÃO)
 * viaja com header Idempotency-Key.
 *
 * fetch é stubado (jsdom não tem rede); a resposta simulada é o JSON de
 * sucesso/erro da rota.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// api.ts importa helpers de CSRF (cookie) — mantém o unit hermético.
vi.mock("@/lib/csrf", () => ({
  CSRF_HEADER: "x-csrf-token",
  getCsrfTokenFromCookie: vi.fn().mockReturnValue("tok"),
}))

// O setup global da vitrine mocka @/lib/api (só funções de geo) para toda a
// suíte; este unit testa o módulo REAL — restaura com importOriginal.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
}))

import { payBooking, newIdempotencyKey, type PayResponse } from "../api"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockJsonResponse(payload: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  )
}

function sentIdempotencyKeys(): Array<string | null> {
  return fetchMock.mock.calls.map((call) =>
    new Headers((call[1] as RequestInit).headers).get("idempotency-key"),
  )
}

describe("newIdempotencyKey", () => {
  it("gera chave no formato aceito pelo servidor (^[A-Za-z0-9_-]{8,128}$)", () => {
    expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
  })

  it("chaves sucessivas são distintas", () => {
    const set = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()))
    expect(set.size).toBe(50)
  })
})

describe("payBooking", () => {
  const PAY_OK: PayResponse = {
    paymentMethod: "CARD",
    status: "PAID",
    cardLastDigits: "1111",
    cardBrand: "visa",
    installments: 1,
  }

  it("faz POST no endpoint /pay com method e corpo corretos", async () => {
    mockJsonResponse(PAY_OK)

    await payBooking("book-1", { card: { number: "4111" } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/bookings/book-1/pay")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ card: { number: "4111" } })
  })

  it("SEMPRE envia header Idempotency-Key (mesmo sem options)", async () => {
    mockJsonResponse(PAY_OK)

    await payBooking("book-1", {})

    const [key] = sentIdempotencyKeys()
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
  })

  it("usa a chave passada em options: retry reenvia a MESMA chave", async () => {
    mockJsonResponse(PAY_OK)

    await payBooking("book-1", {}, { idempotencyKey: "chave-fixada-tentativa-1" })
    await payBooking("book-1", {}, { idempotencyKey: "chave-fixada-tentativa-1" })

    expect(sentIdempotencyKeys()).toEqual(["chave-fixada-tentativa-1", "chave-fixada-tentativa-1"])
  })

  it("sem options, cada chamada gera chave NOVA (intenções distintas)", async () => {
    mockJsonResponse(PAY_OK)

    await payBooking("book-1", {})
    await payBooking("book-1", {})

    const [k1, k2] = sentIdempotencyKeys()
    expect(k1).toBeTruthy()
    expect(k2).toBeTruthy()
    expect(k1).not.toBe(k2)
  })

  it("propaga a resposta tipada do pagamento (fluxo card)", async () => {
    mockJsonResponse(PAY_OK)

    const res = await payBooking("book-1")

    expect(res).toEqual(PAY_OK)
    expect(res.cardLastDigits).toBe("1111")
  })

  it("lança ApiError com status/message do servidor em erro HTTP (409 in_flight)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Pagamento já em processamento para esta chave." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    )

    await expect(payBooking("book-1")).rejects.toMatchObject({
      status: 409,
      message: "Pagamento já em processamento para esta chave.",
    })
  })
})
