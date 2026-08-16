/**
 * Tests for src/lib/lytex.ts — timeout/AbortSignal behavior of lytexRequest.
 *
 * Complementa lytex.test.ts (que replica a lógica inline SEM importar o
 * módulo real). Aqui importamos o módulo REAL para validar que o
 * `AbortSignal.timeout()` aplicado via helper compartilhado
 * (fetch-timeout.ts) realmente aborta quando a Lytex aceita o TCP mas nunca
 * responde — o fetch não pode pendurar o fluxo de booking.
 *
 * Padrão copiado de realtime-client.test.ts (stub de fetch + logger mockado).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mock logger (o módulo real usa logger.child no escopo do módulo) ─────

const mockLoggerChild = vi.fn(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    child: mockLoggerChild,
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: "silent",
  },
}))

// ── Env necessária pelo getConfig() da Lytex ──────────────────────────────

const LY_CUSTOMER = {
  name: "João Silva",
  email: "joao@email.com",
  cpfCnpj: "123.456.789-00",
}

function setLytexEnv() {
  vi.stubEnv("LYTEX_CLIENT_ID", "test-client")
  vi.stubEnv("LYTEX_CLIENT_SECRET", "test-secret")
  vi.stubEnv("LYTEX_ENV", "sandbox")
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
  vi.resetModules()
  setLytexEnv()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

/**
 * Simula uma Lytex que aceita a conexão TCP mas nunca responde: o fetch só
 * rejeita quando o signal do AbortSignal.timeout abortar (TimeoutError).
 */
function mockFetchHangOnce() {
  const mockFetch = vi.mocked(fetch)
  mockFetch.mockImplementationOnce(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        if (!signal) {
          reject(new Error("expected an AbortSignal from AbortSignal.timeout"))
          return
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      }),
  )
}

describe("lytexRequest (módulo real)", () => {
  it("passa AbortSignal.timeout como signal do fetch", async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "lytx_ok_1", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const { createPixCharge } = await import("@/lib/lytex")
    // Assinatura REAL do módulo: um único objeto PixChargeRequest
    // (diferente do replica inline do lytex.test.ts, que usa 3 args).
    await createPixCharge({
      externalReference: "booking:ok",
      amount: 150,
      customer: LY_CUSTOMER,
    })

    const signal = mockFetch.mock.calls[0]![1]!.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
  })

  it("não trava quando a Lytex aceita o TCP mas nunca responde (timeout aborta o fetch)", async () => {
    vi.stubEnv("LYTEX_TIMEOUT_MS", "50")
    mockFetchHangOnce()

    const { createPixCharge } = await import("@/lib/lytex")

    const started = Date.now()
    const err = await createPixCharge({
      externalReference: "booking:hang",
      amount: 150,
      customer: LY_CUSTOMER,
    }).catch((e: unknown) => e)
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(2000) // não esperou para sempre
    expect((err as Error).name).toBe("TimeoutError")
  })
})
