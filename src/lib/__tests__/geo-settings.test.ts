import { describe, it, expect, vi, beforeEach } from "vitest"
import { getGeoSettings, resetGeoSettingsCache, GEO_SETTINGS_DEFAULTS } from "../geo-settings"

// Mock Prisma db
const mockFindMany = vi.fn()
vi.mock("@/lib/db", () => ({
  get db() {
    return { setting: { findMany: mockFindMany } }
  },
}))

vi.mock("../logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

describe("geo-settings.ts — Settings Loading", () => {
  beforeEach(() => {
    resetGeoSettingsCache()
    mockFindMany.mockReset()
  })

  it("returns defaults when DB is empty", async () => {
    mockFindMany.mockResolvedValue([])
    const settings = await getGeoSettings()
    expect(settings).toEqual(GEO_SETTINGS_DEFAULTS)
  })

  it("returns defaults when DB throws", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection refused"))
    const settings = await getGeoSettings()
    expect(settings).toEqual(GEO_SETTINGS_DEFAULTS)
  })

  it("parses 'true' as enabled", async () => {
    mockFindMany.mockResolvedValue([
      { key: "nominatim_enabled", value: "true" },
      { key: "viacep_enabled", value: "true" },
    ])
    const settings = await getGeoSettings()
    expect(settings.nominatimEnabled).toBe(true)
    expect(settings.viacepEnabled).toBe(true)
  })

  it("parses 'false' as disabled", async () => {
    mockFindMany.mockResolvedValue([
      { key: "nominatim_enabled", value: "false" },
      { key: "viacep_enabled", value: "false" },
    ])
    const settings = await getGeoSettings()
    expect(settings.nominatimEnabled).toBe(false)
    expect(settings.viacepEnabled).toBe(false)
  })

  it("parses '1' as enabled, '0' as disabled", async () => {
    mockFindMany.mockResolvedValue([
      { key: "nominatim_enabled", value: "1" },
      { key: "viacep_enabled", value: "0" },
    ])
    const settings = await getGeoSettings()
    expect(settings.nominatimEnabled).toBe(true)
    expect(settings.viacepEnabled).toBe(false)
  })

  it("parses 'yes' as enabled, 'no' as disabled", async () => {
    mockFindMany.mockResolvedValue([
      { key: "nominatim_enabled", value: "yes" },
      { key: "viacep_enabled", value: "no" },
    ])
    const settings = await getGeoSettings()
    expect(settings.nominatimEnabled).toBe(true)
    expect(settings.viacepEnabled).toBe(false)
  })

  it("strips trailing slashes from URLs", async () => {
    mockFindMany.mockResolvedValue([
      { key: "nominatim_base_url", value: "https://custom.nominatim.org/" },
      { key: "viacep_base_url", value: "https://custom.viacep.com.br///" },
    ])
    const settings = await getGeoSettings()
    expect(settings.nominatimBaseUrl).toBe("https://custom.nominatim.org")
    expect(settings.viacepBaseUrl).toBe("https://custom.viacep.com.br")
  })

  it("builds userAgent from user_agent + email", async () => {
    mockFindMany.mockResolvedValue([
      { key: "nominatim_user_agent", value: "MyApp/2.0" },
      { key: "nominatim_email", value: "dev@example.com" },
    ])
    const settings = await getGeoSettings()
    expect(settings.userAgent).toBe("MyApp/2.0 (dev@example.com)")
  })

  it("uses default userAgent when only user_agent is set (no email)", async () => {
    mockFindMany.mockResolvedValue([{ key: "nominatim_user_agent", value: "MyApp/2.0" }])
    const settings = await getGeoSettings()
    expect(settings.userAgent).toBe("MyApp/2.0")
  })

  it("caches results for 30s (no re-read)", async () => {
    mockFindMany.mockResolvedValue([])
    await getGeoSettings()
    await getGeoSettings()
    expect(mockFindMany).toHaveBeenCalledTimes(1) // Only one DB read
  })

  it("resetGeoSettingsCache forces re-read", async () => {
    mockFindMany.mockResolvedValue([])
    await getGeoSettings()
    resetGeoSettingsCache()
    await getGeoSettings()
    expect(mockFindMany).toHaveBeenCalledTimes(2)
  })
})
