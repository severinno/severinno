import { describe, it, expect } from "vitest"
import { resolveRegionalContext, calculateLocalSolarContext } from "../engine"

describe("Regional Intelligence Engine (Brasil Continental)", () => {
  describe("Hub City Profiles & Macro-Regions", () => {
    it("resolves Governador Valadares with real neighborhoods and heatwave tendency", () => {
      const ctx = resolveRegionalContext({
        city: "Governador Valadares",
        state: "MG",
      })

      expect(ctx.city).toBe("Governador Valadares")
      expect(ctx.state).toBe("MG")
      expect(ctx.macroRegion).toBe("sudeste")
      expect(ctx.timezone).toBe("America/Sao_Paulo")
      expect(ctx.neighborhoods).toContain("Centro")
      expect(ctx.neighborhoods).toContain("Ilha dos Araújos")
      expect(ctx.neighborhoods).toContain("Grã-Duquesa")
      expect(ctx.tone.greetingPrefix).toBe("O que você precisa resolver hoje?")
    })

    it("resolves Salvador with Nordeste tone and Salvador neighborhoods", () => {
      const ctx = resolveRegionalContext({
        city: "Salvador",
        state: "BA",
      })

      expect(ctx.city).toBe("Salvador")
      expect(ctx.state).toBe("BA")
      expect(ctx.macroRegion).toBe("nordeste")
      expect(ctx.neighborhoods).toContain("Pituba")
      expect(ctx.neighborhoods).toContain("Barra")
      expect(ctx.tone.greetingPrefix).toBe("O que você precisa ajeitar hoje?")
    })

    it("resolves Curitiba with Sul macro-region and coldfront tendency", () => {
      const ctx = resolveRegionalContext({
        city: "Curitiba",
        state: "PR",
      })

      expect(ctx.city).toBe("Curitiba")
      expect(ctx.state).toBe("PR")
      expect(ctx.macroRegion).toBe("sul")
      expect(ctx.neighborhoods).toContain("Batel")
      expect(ctx.weather).toBe("coldfront")
    })

    it("resolves Manaus with Norte timezone (UTC-4) and neighborhoods", () => {
      const ctx = resolveRegionalContext({
        lat: -3.119,
        lng: -60.021,
        city: "Manaus",
        state: "AM",
      })

      expect(ctx.city).toBe("Manaus")
      expect(ctx.state).toBe("AM")
      expect(ctx.macroRegion).toBe("norte")
      expect(ctx.timezone).toBe("America/Manaus")
      expect(ctx.neighborhoods).toContain("Adrianópolis")
    })
  })

  describe("Weather Triggers & Adaptive Priority Services", () => {
    it("adapts priority service chips to heatwave conditions", () => {
      const ctx = resolveRegionalContext({
        city: "Governador Valadares",
        forcedWeather: "heatwave",
      })

      expect(ctx.weather).toBe("heatwave")
      const serviceIds = ctx.priorityServiceChips.map((s) => s.id)
      expect(serviceIds).toContain("ar-condicionado")
      expect(serviceIds).toContain("refrigeracao")
    })

    it("adapts priority service chips to rainstorm conditions", () => {
      const ctx = resolveRegionalContext({
        city: "São Paulo",
        forcedWeather: "rainstorm",
      })

      expect(ctx.weather).toBe("rainstorm")
      const serviceIds = ctx.priorityServiceChips.map((s) => s.id)
      expect(serviceIds).toContain("desentupidora")
      expect(serviceIds).toContain("curto-circuito")
    })

    it("adapts priority service chips to coldfront conditions", () => {
      const ctx = resolveRegionalContext({
        city: "Curitiba",
        forcedWeather: "coldfront",
      })

      expect(ctx.weather).toBe("coldfront")
      const serviceIds = ctx.priorityServiceChips.map((s) => s.id)
      expect(serviceIds).toContain("resistencia-chuveiro")
      expect(serviceIds).toContain("aquecedor-gas")
    })
  })

  describe("Solar Context & Timezone Calculations", () => {
    it("identifies night emergency mode for late hours", () => {
      // 22:30 UTC-3 is night
      const fixedDate = new Date("2026-10-15T22:30:00-03:00")
      const solar = calculateLocalSolarContext(fixedDate, "America/Sao_Paulo")
      expect(solar.solarPeriod).toBe("night_emergency")
      expect(solar.hours).toBe(22)
    })

    it("identifies weekend mode correctly", () => {
      // 2026-10-17 is Saturday
      const saturdayDate = new Date("2026-10-17T14:00:00-03:00")
      const solar = calculateLocalSolarContext(saturdayDate, "America/Sao_Paulo")
      expect(solar.solarPeriod).toBe("weekend")
      expect(solar.isWeekend).toBe(true)
    })

    it("handles UTC-4 Manaus timezone shift", () => {
      // 14:00 in UTC is 10:00 in Manaus (UTC-4)
      const dateUtc = new Date("2026-10-15T14:00:00Z")
      const solar = calculateLocalSolarContext(dateUtc, "America/Manaus")
      expect(solar.hours).toBe(10)
      expect(solar.solarPeriod).toBe("morning")
    })
  })
})
