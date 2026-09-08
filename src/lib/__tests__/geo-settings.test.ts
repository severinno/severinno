import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────
const findMany = vi.fn()

vi.mock("@/lib/db", () => ({
  db: { setting: { findMany } },
}))

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { getGeoSettings, GEO_SETTINGS_DEFAULTS, resetGeoSettingsCache } from "@/lib/geo-settings"

beforeEach(() => {
  vi.resetModules()
  resetGeoSettingsCache()
  findMany.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Helpers ────────────────────────────────────────────────────────────────
function row(key: string, value: string) {
  return { key, value }
}

// ── GEO_SETTINGS_DEFAULTS ─────────────────────────────────────────────────
describe("GEO_SETTINGS_DEFAULTS", () => {
  it("has the expected shape with all five keys", () => {
    expect(GEO_SETTINGS_DEFAULTS).toEqual({
      nominatimEnabled: true,
      viacepEnabled: true,
      nominatimBaseUrl: "https://nominatim.openstreetmap.org",
      viacepBaseUrl: "https://viacep.com.br",
      userAgent: "SeverinnoMarketplace/1.0 (admin@severinno.com)",
    })
  })

  it("nominatimEnabled defaults to true", () => {
    expect(GEO_SETTINGS_DEFAULTS.nominatimEnabled).toBe(true)
  })

  it("viacepEnabled defaults to true", () => {
    expect(GEO_SETTINGS_DEFAULTS.viacepEnabled).toBe(true)
  })

  it("URLs have no trailing slash", () => {
    expect(GEO_SETTINGS_DEFAULTS.nominatimBaseUrl).not.toMatch(/\/$/)
    expect(GEO_SETTINGS_DEFAULTS.viacepBaseUrl).not.toMatch(/\/$/)
  })
})

// ── getGeoSettings ────────────────────────────────────────────────────────
describe("getGeoSettings", () => {
  // ── FAIL-OPEN ──────────────────────────────────────────────────────────
  describe("FAIL-OPEN (DB failure returns defaults)", () => {
    it("returns defaults when findMany throws", async () => {
      findMany.mockRejectedValue(new Error("connection refused"))

      const settings = await getGeoSettings()

      expect(settings).toEqual(GEO_SETTINGS_DEFAULTS)
    })

    it("returns defaults when findMany rejects with non-Error", async () => {
      findMany.mockRejectedValue("unexpected string")

      const settings = await getGeoSettings()

      expect(settings).toEqual(GEO_SETTINGS_DEFAULTS)
    })
  })

  // ── DB with values ────────────────────────────────────────────────────
  describe("returns correct settings when DB has values", () => {
    it("maps all five setting keys correctly", async () => {
      findMany.mockResolvedValue([
        row("nominatim_enabled", "false"),
        row("viacep_enabled", "false"),
        row("nominatim_base_url", "https://custom-nominatim.example.com"),
        row("viacep_base_url", "https://custom-viacep.example.com"),
        row("nominatim_user_agent", "MyApp/2.0"),
        row("nominatim_email", "dev@example.com"),
      ])

      const settings = await getGeoSettings()

      expect(settings).toEqual({
        nominatimEnabled: false,
        viacepEnabled: false,
        nominatimBaseUrl: "https://custom-nominatim.example.com",
        viacepBaseUrl: "https://custom-viacep.example.com",
        userAgent: "MyApp/2.0 (dev@example.com)",
      })
    })

    it("returns defaults when DB returns empty array", async () => {
      findMany.mockResolvedValue([])

      const settings = await getGeoSettings()

      expect(settings).toEqual(GEO_SETTINGS_DEFAULTS)
    })
  })

  // ── Caching ───────────────────────────────────────────────────────────
  describe("caching (30s TTL)", () => {
    it("second call returns cached result without hitting DB", async () => {
      findMany.mockResolvedValue([
        row("nominatim_enabled", "true"),
        row("viacep_enabled", "true"),
        row("nominatim_base_url", "https://a.com"),
        row("viacep_base_url", "https://b.com"),
        row("nominatim_user_agent", "Agent"),
        row("nominatim_email", "a@b.com"),
      ])

      const first = await getGeoSettings()
      const second = await getGeoSettings()

      expect(findMany).toHaveBeenCalledTimes(1)
      expect(first).toBe(second)
      expect(first).toEqual(second)
    })

    it("cache is shared between calls within TTL", async () => {
      findMany.mockResolvedValue([row("nominatim_enabled", "false")])

      const a = await getGeoSettings()
      const b = await getGeoSettings()
      const c = await getGeoSettings()

      expect(findMany).toHaveBeenCalledTimes(1)
      expect(a).toBe(b)
      expect(b).toBe(c)
    })
  })

  // ── resetGeoSettingsCache ─────────────────────────────────────────────
  describe("resetGeoSettingsCache forces fresh read", () => {
    it("after reset, DB is called again", async () => {
      findMany.mockResolvedValueOnce([row("nominatim_enabled", "false")])
      await getGeoSettings()
      expect(findMany).toHaveBeenCalledTimes(1)

      resetGeoSettingsCache()

      findMany.mockResolvedValueOnce([row("nominatim_enabled", "true")])
      const settings = await getGeoSettings()
      expect(findMany).toHaveBeenCalledTimes(2)
      expect(settings.nominatimEnabled).toBe(true)
    })

    it("returns different value after DB changes and cache reset", async () => {
      findMany.mockResolvedValueOnce([row("viacep_enabled", "true")])
      const first = await getGeoSettings()

      resetGeoSettingsCache()

      findMany.mockResolvedValueOnce([row("viacep_enabled", "false")])
      const second = await getGeoSettings()

      expect(first.viacepEnabled).toBe(true)
      expect(second.viacepEnabled).toBe(false)
    })
  })

  // ── Partial DB rows ───────────────────────────────────────────────────
  describe("handles partial DB rows (some keys missing)", () => {
    it("uses defaults for missing boolean keys", async () => {
      findMany.mockResolvedValue([row("nominatim_enabled", "false")])

      const settings = await getGeoSettings()

      expect(settings.nominatimEnabled).toBe(false)
      expect(settings.viacepEnabled).toBe(true)
    })

    it("uses defaults for missing URL keys", async () => {
      findMany.mockResolvedValue([row("nominatim_base_url", "https://custom.com")])

      const settings = await getGeoSettings()

      expect(settings.nominatimBaseUrl).toBe("https://custom.com")
      expect(settings.viacepBaseUrl).toBe(GEO_SETTINGS_DEFAULTS.viacepBaseUrl)
    })

    it("uses default userAgent when nominatim_user_agent is missing", async () => {
      findMany.mockResolvedValue([])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe(GEO_SETTINGS_DEFAULTS.userAgent)
    })

    it("uses default userAgent when nominatim_email is missing", async () => {
      findMany.mockResolvedValue([row("nominatim_user_agent", "MyAgent")])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe("MyAgent")
    })

    it("uses default userAgent when both nominatim_user_agent and nominatim_email are missing", async () => {
      findMany.mockResolvedValue([])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe(GEO_SETTINGS_DEFAULTS.userAgent)
    })
  })

  // ── toBool behavior (via getGeoSettings) ──────────────────────────────
  describe("toBool — interprets truthy string values", () => {
    it.each([
      ["true", true],
      ["True", true],
      ["TRUE", true],
      ["  true  ", true],
      ["1", true],
      ["yes", true],
      ["Yes", true],
      ["YES", true],
    ])('value "%s" → %s', async (raw, expected) => {
      findMany.mockResolvedValue([row("nominatim_enabled", raw)])

      const settings = await getGeoSettings()

      expect(settings.nominatimEnabled).toBe(expected)
    })

    it.each([
      ["false", false],
      ["False", false],
      ["0", false],
      ["no", false],
      ["No", false],
      ["", true], // empty string treated as missing → fallback
      ["something-else", false],
    ])('value "%s" → %s', async (raw, expected) => {
      findMany.mockResolvedValue([row("nominatim_enabled", raw)])

      const settings = await getGeoSettings()

      expect(settings.nominatimEnabled).toBe(expected)
    })

    it("undefined (missing key) uses fallback true", async () => {
      findMany.mockResolvedValue([])

      const settings = await getGeoSettings()

      expect(settings.nominatimEnabled).toBe(true)
    })
  })

  // ── Trailing slashes in URLs ──────────────────────────────────────────
  describe("handles trailing slashes in URLs (stripped)", () => {
    it("strips single trailing slash from nominatim_base_url", async () => {
      findMany.mockResolvedValue([row("nominatim_base_url", "https://example.com/")])

      const settings = await getGeoSettings()

      expect(settings.nominatimBaseUrl).toBe("https://example.com")
    })

    it("strips multiple trailing slashes from nominatim_base_url", async () => {
      findMany.mockResolvedValue([row("nominatim_base_url", "https://example.com///")])

      const settings = await getGeoSettings()

      expect(settings.nominatimBaseUrl).toBe("https://example.com")
    })

    it("strips trailing slash from viacep_base_url", async () => {
      findMany.mockResolvedValue([row("viacep_base_url", "https://viacep.custom.br/")])

      const settings = await getGeoSettings()

      expect(settings.viacepBaseUrl).toBe("https://viacep.custom.br")
    })

    it("leaves URLs without trailing slash untouched", async () => {
      findMany.mockResolvedValue([
        row("nominatim_base_url", "https://nominatim.example.com"),
        row("viacep_base_url", "https://viacep.example.com"),
      ])

      const settings = await getGeoSettings()

      expect(settings.nominatimBaseUrl).toBe("https://nominatim.example.com")
      expect(settings.viacepBaseUrl).toBe("https://viacep.example.com")
    })
  })

  // ── userAgent construction ────────────────────────────────────────────
  describe("builds userAgent from nominatim_user_agent + nominatim_email", () => {
    it("combines user_agent and email in parentheses", async () => {
      findMany.mockResolvedValue([
        row("nominatim_user_agent", "SeverinnoApp/3.0"),
        row("nominatim_email", "ops@severinno.com"),
      ])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe("SeverinnoApp/3.0 (ops@severinno.com)")
    })

    it("falls back to default userAgent when user_agent is present but email is missing", async () => {
      findMany.mockResolvedValue([row("nominatim_user_agent", "OnlyAgent")])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe("OnlyAgent")
    })

    it("falls back to default userAgent when email is present but user_agent is missing", async () => {
      findMany.mockResolvedValue([row("nominatim_email", "only@email.com")])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe(GEO_SETTINGS_DEFAULTS.userAgent)
    })

    it("falls back to default userAgent when both are missing", async () => {
      findMany.mockResolvedValue([])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe(GEO_SETTINGS_DEFAULTS.userAgent)
    })

    it("uses keys case-insensitively from DB", async () => {
      findMany.mockResolvedValue([
        row("NOMINATIM_USER_AGENT", "CaseAgent"),
        row("NOMINATIM_EMAIL", "case@email.com"),
      ])

      const settings = await getGeoSettings()

      expect(settings.userAgent).toBe("CaseAgent (case@email.com)")
    })
  })
})
