import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────
// geo-settings: controlado por teste (kill-switches + URLs + User-Agent).
vi.mock("@/lib/geo-settings", () => ({
  getGeoSettings: vi.fn(),
  GEO_SETTINGS_DEFAULTS: {
    nominatimEnabled: true,
    viacepEnabled: true,
    nominatimBaseUrl: "https://nominatim.openstreetmap.org",
    viacepBaseUrl: "https://viacep.com.br",
    userAgent: "SeverinnoMarketplace/1.0 (admin@severinno.com)",
  },
}))

// Limiters: pass-through (sem delay) mas como spies — para provar a separação
// ViaCEP (60 req/min) vs Nominatim (1 req/s) no withCachedGeo.
const mockRateLimitedViaCEP = vi.fn(<T>(fn: () => Promise<T>): Promise<T> => fn())
const mockRateLimitedNominatim = vi.fn(<T>(fn: () => Promise<T>): Promise<T> => fn())

vi.mock("@/lib/nominatim-rate-limit", () => ({
  rateLimitedNominatim: (fn: any) => mockRateLimitedNominatim(fn),
  resetNominatimRateLimit: () => {},
}))

vi.mock("@/lib/viacep-rate-limit", () => ({
  rateLimitedViaCEP: (fn: any) => mockRateLimitedViaCEP(fn),
  resetViaCEPRateLimit: () => {},
}))

// db: fallback local (geocodeCEPLocal / geocodeSearchLocal / reverseGeocodeLocal).
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { getGeoSettings } from "@/lib/geo-settings"
import { geocodeCEP, geocodeSearch, geocodeSearchStructured, reverseGeocode } from "@/lib/geo"
import { db } from "@/lib/db"

type MockSettings = {
  nominatimEnabled: boolean
  viacepEnabled: boolean
  nominatimBaseUrl: string
  viacepBaseUrl: string
  userAgent: string
}

const DEFAULTS: MockSettings = {
  nominatimEnabled: true,
  viacepEnabled: true,
  nominatimBaseUrl: "https://nominatim.openstreetmap.org",
  viacepBaseUrl: "https://viacep.com.br",
  userAgent: "SeverinnoMarketplace/1.0 (admin@severinno.com)",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getGeoSettings).mockResolvedValue({ ...DEFAULTS })
})

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe("geo kill-switches (settings do painel admin)", () => {
  it("viacep_enabled=false: geocodeCEP vai direto ao fallback local (sem fetch)", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue({
      cep: "01001000",
      street: "Praça da Sé",
      district: "Sé",
      city: "São Paulo",
      state: "SP",
    } as any)
    vi.mocked(getGeoSettings).mockResolvedValue({ ...DEFAULTS, viacepEnabled: false })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const result = await geocodeCEP("01001-000")

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.mocked(db.user.findFirst)).toHaveBeenCalled()
    expect(result).toMatchObject({ street: "Praça da Sé", city: "São Paulo" })
  })

  it("nominatim_enabled=false: geocodeSearch vai direto ao fallback local (sem fetch)", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        lat: -23.55,
        lng: -46.63,
        street: "Rua XV",
        district: "Centro",
        city: "Campinas",
        state: "SP",
        cep: "13010000",
      },
    ] as any)
    vi.mocked(getGeoSettings).mockResolvedValue({ ...DEFAULTS, nominatimEnabled: false })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const results = await geocodeSearch("Campinas")

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ city: "Campinas", type: "local_fallback" })
  })

  it("nominatim_enabled=false: reverseGeocode usa o fallback local (prestador mais próximo)", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        lat: -23.55,
        lng: -46.63,
        street: "Av. Paulista",
        district: "Bela Vista",
        city: "São Paulo",
        state: "SP",
        cep: "01310100",
      },
    ] as any)
    vi.mocked(getGeoSettings).mockResolvedValue({ ...DEFAULTS, nominatimEnabled: false })
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const result = await reverseGeocode(-23.55, -46.63)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result).toMatchObject({ city: "São Paulo", postcode: "01310100" })
    expect(result.displayName).toContain("Av. Paulista")
  })

  it("NOMINATIM_BASE_URL custom substitui o default no geocodeSearch", async () => {
    vi.mocked(getGeoSettings).mockResolvedValue({
      ...DEFAULTS,
      nominatimBaseUrl: "https://nominatim.example.org",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        okJson([{ lat: "-23.55", lon: "-46.63", display_name: "Av. Paulista", importance: "0.6" }]),
      )

    await geocodeSearch("Av. Paulista")

    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toMatch(/^https:\/\/nominatim\.example\.org\/search\?/)
    expect(url).not.toContain("openstreetmap")
  })

  it("VIACEP_BASE_URL custom substitui o default no geocodeCEP", async () => {
    vi.mocked(getGeoSettings).mockResolvedValue({
      ...DEFAULTS,
      viacepBaseUrl: "https://viacep.example.org",
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({
        cep: "01310100",
        logradouro: "Av. Paulista",
        bairro: "Bela Vista",
        localidade: "São Paulo",
        uf: "SP",
      }),
    )

    await geocodeCEP("01310-100")

    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toMatch(/^https:\/\/viacep\.example\.org\/ws\/01310100\/json\/$/)
  })

  it("User-Agent das settings é enviado ao Nominatim", async () => {
    vi.mocked(getGeoSettings).mockResolvedValue({
      ...DEFAULTS,
      userAgent: "MyApp/2.0 (dev@example.com)",
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        okJson([{ lat: "-23.55", lon: "-46.63", display_name: "Rua Augusta", importance: "0.5" }]),
      )

    await geocodeSearch("Rua Augusta")

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "MyApp/2.0 (dev@example.com)",
    )
  })
})

describe("limiters separados no withCachedGeo (ViaCEP 60/min vs Nominatim 1 req/s)", () => {
  it("geocodeCEP passa pelo limiter ViaCEP, e NÃO pelo do Nominatim", async () => {
    vi.mocked(getGeoSettings).mockResolvedValue({ ...DEFAULTS })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({
        cep: "01310100",
        logradouro: "Av. Paulista",
        bairro: "Bela Vista",
        localidade: "São Paulo",
        uf: "SP",
      }),
    )

    await geocodeCEP("01310-100")

    expect(mockRateLimitedViaCEP).toHaveBeenCalledTimes(1)
    expect(mockRateLimitedNominatim).not.toHaveBeenCalled()
  })

  it("search/structured/reverse (Nominatim) passam pelo limiter 1 req/s, e NÃO pelo ViaCEP", async () => {
    vi.mocked(getGeoSettings).mockResolvedValue({ ...DEFAULTS })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson([{ lat: "-23.55", lon: "-46.63", display_name: "Av. Paulista", importance: "0.6" }]),
    )

    await geocodeSearch("Av. Paulista")
    await geocodeSearchStructured({ city: "São Paulo" })
    await reverseGeocode(-23.55, -46.63)

    expect(mockRateLimitedNominatim).toHaveBeenCalledTimes(3)
    expect(mockRateLimitedViaCEP).not.toHaveBeenCalled()
  })
})
