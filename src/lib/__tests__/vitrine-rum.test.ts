/**
 * Testes do client RUM da vitrine (src/lib/vitrine-rum.ts).
 *
 * O que é coberto SEM rede:
 *   1. amostragem — por LOAD (uma decisão), fronteira enumerada, env saneado;
 *   2. SEM PII — o payload é whitelist: campo extra do objeto de entrada não
 *      chega ao wire (a prova é a asserção do corpo enviado);
 *   3. micro-batch — 5 medidas ou 5s, o que vier primeiro; flush manual;
 *   4. transport — sendBeacon com fallback fetch keepalive; falha engolida.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_SAMPLE_RATE,
  RUM_BATCH_SIZE,
  RUM_ENDPOINT,
  RUM_FLUSH_MS,
  createVitrineRumReporter,
  reportVitrineMeasure,
  resetVitrineRumForTests,
  sampleRateFromEnv,
  type VitrineRumEntry,
} from "@/lib/vitrine-rum"

const medida = (overrides?: Partial<VitrineRumEntry>): VitrineRumEntry => ({
  name: "vitrine:pagina:render",
  duration: 110,
  target: 3,
  direction: "proxima",
  warm: true,
  inFlight: false,
  ...overrides,
})

/** Corpo decodificado do último envio do spy. */
function ultimoCorpo(send: ReturnType<typeof vi.fn>): {
  entries: Record<string, unknown>[]
} {
  expect(send).toHaveBeenCalled()
  const [url, body] = send.mock.calls.at(-1) as [string, string]
  expect(url).toBe(RUM_ENDPOINT)
  return JSON.parse(body)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetVitrineRumForTests()
})

describe("sampleRateFromEnv — env saneado", () => {
  it("default 0.1 para ausente, não-numérica ou negativa", () => {
    expect(sampleRateFromEnv(undefined)).toBe(DEFAULT_SAMPLE_RATE)
    expect(sampleRateFromEnv("abc")).toBe(DEFAULT_SAMPLE_RATE)
    expect(sampleRateFromEnv("-1")).toBe(DEFAULT_SAMPLE_RATE)
    expect(sampleRateFromEnv("NaN")).toBe(DEFAULT_SAMPLE_RATE)
  })

  it("aceita 0 (desliga) e satura em 1", () => {
    expect(sampleRateFromEnv("0")).toBe(0)
    expect(sampleRateFromEnv("0.25")).toBe(0.25)
    expect(sampleRateFromEnv("2")).toBe(1)
  })
})

describe("amostragem — decisão POR LOAD, uma vez", () => {
  it("rate 1 amostra tudo; rate 0 não amostra nada", () => {
    const sempre = createVitrineRumReporter({ rate: 1, random: () => 0.99, send: vi.fn() })
    expect(sempre.sampled()).toBe(true)

    const nunca = createVitrineRumReporter({ rate: 0, random: () => 0, send: vi.fn() })
    expect(nunca.sampled()).toBe(false)
  })

  it("fronteira enumerada: random < rate amostra; random >= rate não", () => {
    const dentro = createVitrineRumReporter({ rate: 0.1, random: () => 0.09, send: vi.fn() })
    const fora = createVitrineRumReporter({ rate: 0.1, random: () => 0.1, send: vi.fn() })
    expect(dentro.sampled()).toBe(true)
    expect(fora.sampled()).toBe(false)
  })

  it("sessão não amostrada descarta TODAS as medidas (nenhum send, nenhum timer)", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 0, random: () => 0.5, send })
    for (let i = 0; i < RUM_BATCH_SIZE + 3; i++) r.report(medida({ target: i + 2 }))
    vi.advanceTimersByTime(RUM_FLUSH_MS * 2)
    expect(send).not.toHaveBeenCalled()
  })
})

describe("SEM PII — whitelist no wire", () => {
  it("campo extra do objeto de entrada NÃO chega ao corpo enviado", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send, batchSize: 1 })
    const vazada = medida({ target: 4 }) as VitrineRumEntry & Record<string, unknown>
    vazada.email = "maria@severinno.com"
    vazada.userId = "cmu9uxwll01..."
    vazada.cursor = "eyJzIjoicmF0aW5nIn0"

    r.report(vazada)
    const { entries } = ultimoCorpo(send)
    expect(entries[0]).toEqual({
      name: "vitrine:pagina:render",
      duration: 110,
      target: 4,
      direction: "proxima",
      warm: true,
      inFlight: false,
    })
    expect(JSON.stringify(entries)).not.toContain("maria@")
    expect(JSON.stringify(entries)).not.toContain("cursor")
  })

  it("flags ausentes não viram null/undefined no payload", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send, batchSize: 1 })
    r.report({ name: "vitrine:walk:render", duration: 238.6, target: 2 })
    const { entries } = ultimoCorpo(send)
    expect(entries[0]).toEqual({ name: "vitrine:walk:render", duration: 238.6, target: 2 })
    expect(Object.keys(entries[0]).sort()).toEqual(["duration", "name", "target"])
  })

  it("duração arredondada a 1 decimal (o log não precisa de precisão de frame)", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send, batchSize: 1 })
    r.report(medida({ duration: 100.456 }))
    expect(ultimoCorpo(send).entries[0].duration).toBe(100.5)
  })
})

describe("micro-batch — 5 medidas ou 5s", () => {
  it("fecha o batch ao atingir o tamanho (5 medidas = 1 request)", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send })
    for (let i = 0; i < RUM_BATCH_SIZE; i++) r.report(medida({ target: i + 2 }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(ultimoCorpo(send).entries).toHaveLength(RUM_BATCH_SIZE)
  })

  it("batch menor flusha no timer de 5s — e só uma vez", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send })
    r.report(medida({ target: 2 }))
    r.report(medida({ target: 3 }))
    expect(send).not.toHaveBeenCalled()

    vi.advanceTimersByTime(RUM_FLUSH_MS - 1)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(ultimoCorpo(send).entries).toHaveLength(2)

    // Timer é one-shot: sem medidas novas, novo avanço não envia nada.
    vi.advanceTimersByTime(RUM_FLUSH_MS * 3)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("flush manual esvazia o buffer imediatamente", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send })
    r.report(medida({ target: 2 }))
    r.flush()
    expect(send).toHaveBeenCalledTimes(1)
    r.flush()
    expect(send).toHaveBeenCalledTimes(1) // buffer vazio não envia
  })
})

describe("transport — sendBeacon com fallback fetch keepalive", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sendBeacon disponível e aceitando: fetch NÃO é chamado", async () => {
    const beacon = vi.fn(() => true)
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    })

    const r = createVitrineRumReporter({ rate: 1, random: () => 0, batchSize: 1 })
    r.report(medida())

    await vi.advanceTimersByTimeAsync(0)
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("sendBeacon indisponível: fallback fetch com keepalive e corpo igual", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchSpy)
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    })

    const r = createVitrineRumReporter({ rate: 1, random: () => 0, batchSize: 1 })
    r.report(medida())

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("POST")
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(String(init.body)).entries).toHaveLength(1)
  })

  it("sendBeacon recusando a entrada (false) cai no fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchSpy)
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn(() => false),
      configurable: true,
      writable: true,
    })

    const r = createVitrineRumReporter({ rate: 1, random: () => 0, batchSize: 1 })
    r.report(medida())

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("RUM é observabilidade — nada lança", () => {
  it("send que lança é engolido e o PRÓXIMO batch segue funcionando", () => {
    let falhas = 0
    const send = vi.fn(() => {
      if (falhas++ === 0) throw new Error("rede fora")
    })
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send, batchSize: 1 })

    expect(() => r.report(medida())).not.toThrow()
    expect(() => r.report(medida({ target: 3 }))).not.toThrow()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("report com objeto malformado não derruba o chamador", () => {
    const send = vi.fn()
    const r = createVitrineRumReporter({ rate: 1, random: () => 0, send })
    expect(() =>
      r.report({ name: "x" as VitrineRumEntry["name"], duration: NaN, target: 1 }),
    ).not.toThrow()
    vi.advanceTimersByTime(RUM_FLUSH_MS)
    // O server descarta, mas o client entregou — o contrato de não-lançar é client.
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("singleton do app reporta sem lançar em jsdom (janela existe, decisão lazy)", () => {
    expect(() => reportVitrineMeasure(medida({ target: 2 }))).not.toThrow()
  })
})
