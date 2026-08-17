/**
 * Tests for installGlobalFetchTimeoutFloor (src/lib/fetch-timeout.ts)
 *
 * O piso global de fetch timeout é a rede de segurança para fetchs SEM signal
 * explícito. Modelo de precedência (ver worklog):
 *   1. signal explícito no `init` → vence SEMPRE (passado intacto)
 *   2. signal no `Request` → vence (init.signal sobrescreve no spec, então
 *      um Request com signal também controla o timeout)
 *   3. nada → piso global (GLOBAL_FETCH_TIMEOUT_MS, default 60s)
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { installGlobalFetchTimeoutFloor, GLOBAL_FETCH_TIMEOUT_MS_ENV } from "../fetch-timeout"

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => undefined) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("installGlobalFetchTimeoutFloor", () => {
  it("fetch sem signal ganha um AbortSignal do piso no init", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()

    await globalThis.fetch("https://example.com")

    expect(native).toHaveBeenCalledTimes(1)
    const init = native.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.signal?.aborted).toBe(false)
  })

  it("não muta o init do caller (spread cria objeto novo)", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()

    const init = { method: "POST", headers: { "content-type": "application/json" } }
    await globalThis.fetch("https://example.com", init)

    expect(init).not.toHaveProperty("signal")
    const received = native.mock.calls[0]?.[1] as RequestInit | undefined
    expect(received?.method).toBe("POST")
    expect(received?.headers).toEqual({ "content-type": "application/json" })
    expect(received?.signal).toBeInstanceOf(AbortSignal)
  })

  it("signal explícito no init vence (não é substituído nem embrulhado)", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()

    const custom = AbortSignal.timeout(1234)
    await globalThis.fetch("https://example.com", { signal: custom })

    expect(native.mock.calls[0]?.[1]?.signal).toBe(custom)
  })

  it("Request com signal próprio vence (piso não é aplicado)", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()

    const req = new Request("https://example.com", { signal: AbortSignal.timeout(500) })
    // init explícito sem signal: mesmo assim o signal do Request governa
    // (o wrapper detecta requestSignal e delega SEM adicionar o piso).
    await globalThis.fetch(req, { method: "GET" })

    const init = native.mock.calls[0]?.[1] as RequestInit | undefined
    expect(native.mock.calls[0]?.[0]).toBe(req)
    expect(init?.method).toBe("GET")
    expect(init).not.toHaveProperty("signal")
  })

  it("init.signal + Request.signal juntos: init vence (spec do fetch)", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()

    const req = new Request("https://example.com", { signal: AbortSignal.timeout(500) })
    const initSignal = AbortSignal.timeout(777)
    await globalThis.fetch(req, { signal: initSignal })

    // init.signal REPLACE request.signal no spec — o piso não substitui o init.
    expect(native.mock.calls[0]?.[1]?.signal).toBe(initSignal)
  })

  // Limite conhecido (documentado no worklog): `new Request(url)` SEMPRE carrega
  // um signal (o default nunca aborta), então o wrapper não distingue o signal
  // padrão de um explícito e honra o do Request — alinhado ao spec do fetch
  // (fetch(req) respeita req.signal). O guard check-fetch-timeout cobre src/;
  // o piso é rede de segurança para código de terceiros (que raramente usa
  // `fetch(new Request(...))` nu — o padrão usual é fetch(url, init)).
  it("Request padrão (signal default) é passado intacto — limite conhecido", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()

    const req = new Request("https://example.com")
    await globalThis.fetch(req)

    // init permanece undefined: o fetch nativo usará req.signal (default).
    expect(native.mock.calls[0]?.[1]).toBeUndefined()
    expect(req.signal.aborted).toBe(false)
  })

  it("a env GLOBAL_FETCH_TIMEOUT_MS controla o valor do piso", async () => {
    vi.stubEnv(GLOBAL_FETCH_TIMEOUT_MS_ENV, "2500")
    const spy = vi.spyOn(AbortSignal, "timeout")
    installGlobalFetchTimeoutFloor()

    await globalThis.fetch("https://example.com")

    expect(spy).toHaveBeenCalledWith(2500)
  })

  it("env inválida cai no fallback (guard do resolveTimeoutMs)", async () => {
    vi.stubEnv(GLOBAL_FETCH_TIMEOUT_MS_ENV, "abc")
    const spy = vi.spyOn(AbortSignal, "timeout")
    installGlobalFetchTimeoutFloor()

    await globalThis.fetch("https://example.com")

    // fallback 60s
    expect(spy).toHaveBeenCalledWith(60_000)
  })

  it("é idempotente: instalar 2x não re-embrulha o fetch", async () => {
    installGlobalFetchTimeoutFloor()
    const wrapped = globalThis.fetch
    installGlobalFetchTimeoutFloor()
    expect(globalThis.fetch).toBe(wrapped)
  })

  it("fetch já embrulhado continua delegando uma única vez", async () => {
    const native = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    installGlobalFetchTimeoutFloor()
    installGlobalFetchTimeoutFloor()

    await globalThis.fetch("https://example.com")
    await globalThis.fetch("https://example.com")

    expect(native).toHaveBeenCalledTimes(2)
  })
})
