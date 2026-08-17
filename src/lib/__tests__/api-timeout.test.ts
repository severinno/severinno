import { afterEach, describe, expect, it, vi } from "vitest"

// O setup global (src/components/vitrine/__tests__/vitest.setup.tsx) mocka
// @/lib/api PARCIALMENTE (só fetchGeoSearch/fetchGeoSearchStructured/
// fetchReverseGeo/fetchCep) para os testes da vitrine. Este teste quer o
// módulo REAL (apiGet + envTimeoutSignal) — restaura via importOriginal.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual }
})

import { apiGet } from "@/lib/api"
import type { ApiError } from "@/lib/api"

// ---------------------------------------------------------------------------
// api.ts — central fetch wrapper: hang protection via envTimeoutSignal
//
// Segue o padrão do realtime-client.test.ts: simula o serviço que aceita TCP
// mas nunca responde e valida que o AbortSignal.timeout resolve o hang.
// ---------------------------------------------------------------------------

/** Response fake como objeto plano (evita depender do global Response no jsdom). */
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => data,
  } as unknown as Response
}

/**
 * Mock fetch que simula um serviço que aceita TCP mas nunca responde:
 * a promise só resolve/rejeita quando o signal passado abortar.
 */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("api.ts — fetch wrapper com envTimeoutSignal", () => {
  it("passa um AbortSignal de timeout no init do fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await apiGet<{ items: unknown[] }>("/api/providers", { limit: 10 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("não trava quando o serviço aceita TCP mas nunca responde (TimeoutError)", async () => {
    vi.stubEnv("API_TIMEOUT_MS", "50")
    vi.stubGlobal("fetch", hangingFetch())

    const startedAt = Date.now()
    const error = await apiGet<unknown>("/api/providers").then(
      () => null,
      (e: ApiError) => e,
    )

    // Rejeita como erro de rede (status 0) — nunca fica pendurado.
    expect(error).not.toBeNull()
    expect(error?.status).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it("usa o fallback quando API_TIMEOUT_MS é inválido (não quebra)", async () => {
    vi.stubEnv("API_TIMEOUT_MS", "abc")
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await apiGet<unknown[]>("/api/categories")

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
