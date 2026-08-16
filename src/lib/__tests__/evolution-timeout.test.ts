/**
 * Tests for src/lib/evolution.ts — timeout/AbortSignal behavior of
 * evolutionRequest (primeiro arquivo de teste do módulo, testando o módulo
 * REAL).
 *
 * Valida que o `AbortSignal.timeout()` aplicado via helper compartilhado
 * (fetch-timeout.ts) realmente aborta quando a Evolution API aceita o TCP mas
 * nunca responde — o fetch não pode pendurar envios de WhatsApp.
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

// ── Env necessária pelo getConfig() da Evolution ──────────────────────────

function setEvolutionEnv() {
  vi.stubEnv("EVOLUTION_API_URL", "https://evo.test.local")
  vi.stubEnv("EVOLUTION_API_KEY", "test-key")
  vi.stubEnv("EVOLUTION_INSTANCE", "test-instance")
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
  vi.resetModules()
  setEvolutionEnv()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

/**
 * Simula uma Evolution API que aceita a conexão TCP mas nunca responde: o
 * fetch só rejeita quando o signal do AbortSignal.timeout abortar (TimeoutError).
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

describe("evolutionRequest (módulo real)", () => {
  it("passa AbortSignal.timeout como signal do fetch", async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: { id: "msg-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const { sendText } = await import("@/lib/evolution")
    await sendText("5511999999999", "olá")

    const signal = mockFetch.mock.calls[0]![1]!.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
  })

  it("não trava quando a Evolution aceita o TCP mas nunca responde (timeout aborta o fetch)", async () => {
    vi.stubEnv("EVOLUTION_TIMEOUT_MS", "50")
    mockFetchHangOnce()

    const { sendText } = await import("@/lib/evolution")

    const started = Date.now()
    const err = await sendText("5511999999999", "olá").catch((e: unknown) => e)
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(2000) // não esperou para sempre
    expect((err as Error).name).toBe("TimeoutError")
  })
})
