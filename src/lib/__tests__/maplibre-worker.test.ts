/**
 * maplibre-worker.test.ts
 *
 * Tests ensureMaplibreWorker — configura `maplibreConfig.WORKER_URL`
 * para o worker servido pelo app, com idempotência e fallback seguro.
 *
 * Coverage:
 *   ✅ Seta WORKER_URL quando nenhuma URL pré-existe
 *   ✅ Idempotente: chamar de novo não refetcha nem reconfigura
 *   ✅ Respeita URL já configurada por outra parte (não sobrescreve)
 *   ✅ Fallback: erro no fetch deixa o default do MapLibre intacto
 *   ✅ Não roda fora do browser (SSR)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockConfig = vi.hoisted(() => ({ WORKER_URL: undefined as string | undefined }))
const mockGetWorkerUrl = vi.hoisted(() => vi.fn(() => undefined as string | undefined))

vi.mock("maplibre-gl", () => ({
  config: mockConfig,
  getWorkerUrl: mockGetWorkerUrl,
}))

describe("ensureMaplibreWorker", () => {
  const realWindow = globalThis.window
  const realWorker = globalThis.Worker

  beforeEach(() => {
    vi.clearAllMocks()
    // window falso "browser-like" (o módulo checa typeof window/Worker)
    vi.stubGlobal("window", {} as unknown as Window & typeof globalThis)
    vi.stubGlobal("Worker", class {})
    mockConfig.WORKER_URL = undefined
    mockGetWorkerUrl.mockReturnValue(undefined)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    void realWindow
    void realWorker
  })

  it("seta WORKER_URL para /maplibre/maplibre-gl-worker.js quando a URL responde", async () => {
    const { ensureMaplibreWorker: fresh } = await import("../maplibre-worker")
    const applied = await fresh()
    expect(applied).toBe(true)
    expect(mockConfig.WORKER_URL).toBe("/maplibre/maplibre-gl-worker.js")
  })

  it("é idempotente — segunda chamada não refetcha", async () => {
    const { ensureMaplibreWorker: fresh } = await import("../maplibre-worker")
    await fresh()
    await fresh()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("respeita WORKER_URL já configurado por outra parte", async () => {
    mockGetWorkerUrl.mockReturnValue("/custom/worker.js")
    const { ensureMaplibreWorker: fresh } = await import("../maplibre-worker")
    const applied = await fresh()
    expect(applied).toBe(false)
    expect(mockConfig.WORKER_URL).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("fallback: fetch falhando não seta WORKER_URL (default do MapLibre permanece)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { ensureMaplibreWorker: fresh } = await import("../maplibre-worker")
    const applied = await fresh()
    expect(applied).toBe(false)
    expect(mockConfig.WORKER_URL).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("não roda fora do browser (SSR)", async () => {
    vi.stubGlobal("window", undefined)
    const { ensureMaplibreWorker: fresh } = await import("../maplibre-worker")
    const applied = await fresh()
    expect(applied).toBe(false)
    expect(mockConfig.WORKER_URL).toBeUndefined()
  })
})
