import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRecordTimezoneLookup = vi.hoisted(() => vi.fn())

vi.mock("@/lib/geo-observability", () => ({
  recordTimezoneLookup: mockRecordTimezoneLookup,
}))

import { getTimezoneFromCoords, getTimezoneInfo } from "../geo-timezone"

describe("geo-timezone.ts — Brazilian Timezone Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("detects America/Noronha (UTC-2) for Fernando de Noronha", () => {
    expect(getTimezoneFromCoords(-3.854, -32.423)).toBe("America/Noronha")
    const info = getTimezoneInfo(-3.854, -32.423)
    expect(info.utcOffsetHours).toBe(-2)
  })

  it("detects America/Rio_Branco (UTC-5) for Acre and extreme western Amazonas", () => {
    expect(getTimezoneFromCoords(-9.975, -67.81)).toBe("America/Rio_Branco")
    expect(getTimezoneFromCoords(-7.63, -72.67)).toBe("America/Rio_Branco")
    expect(getTimezoneFromCoords(-4.37, -70.19)).toBe("America/Rio_Branco")
    const info = getTimezoneInfo(-9.975, -67.81)
    expect(info.utcOffsetHours).toBe(-5)
  })

  it("detects America/Cuiaba (UTC-4) for Mato Grosso and Mato Grosso do Sul", () => {
    expect(getTimezoneFromCoords(-15.601, -56.097)).toBe("America/Cuiaba")
    expect(getTimezoneFromCoords(-20.469, -54.62)).toBe("America/Cuiaba")
  })

  it("detects America/Manaus (UTC-4) for Amazonas, Roraima and Rondônia", () => {
    expect(getTimezoneFromCoords(-3.119, -60.021)).toBe("America/Manaus")
    expect(getTimezoneFromCoords(2.823, -60.675)).toBe("America/Manaus")
    expect(getTimezoneFromCoords(-8.761, -63.903)).toBe("America/Manaus")
  })

  it("detects America/Sao_Paulo (UTC-3) for Brasília and other states", () => {
    expect(getTimezoneFromCoords(-23.5505, -46.6333)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(-22.9068, -43.1729)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(-15.7939, -47.8828)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(-12.9777, -38.5016)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(-25.429, -49.2671)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(-1.4558, -48.4902)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(-18.8566, -41.9455)).toBe("America/Sao_Paulo")
  })

  it("handles invalid coordinates gracefully by falling back to America/Sao_Paulo", () => {
    expect(getTimezoneFromCoords(NaN, NaN)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(Infinity, -46)).toBe("America/Sao_Paulo")
  })

  describe("observability recording", () => {
    it("calls recordTimezoneLookup for each call", () => {
      getTimezoneFromCoords(-23.55, -46.63) // São Paulo
      getTimezoneFromCoords(-3.12, -60.02) // Manaus
      expect(mockRecordTimezoneLookup).toHaveBeenCalledTimes(2)
    })

    it("records non-fallback timezone with isFallback=false", () => {
      getTimezoneFromCoords(-3.85, -32.42) // Noronha
      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Noronha", false)
    })

    it("records fallback to São Paulo with isFallback=true", () => {
      getTimezoneFromCoords(NaN, NaN)
      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Sao_Paulo", true)
    })

    it("records each timezone variant correctly", () => {
      getTimezoneFromCoords(-3.85, -32.42) // Noronha
      getTimezoneFromCoords(-9.97, -67.81) // Rio Branco
      getTimezoneFromCoords(-15.6, -56.1) // Cuiabá
      getTimezoneFromCoords(-3.12, -60.02) // Manaus
      getTimezoneFromCoords(-23.55, -46.63) // São Paulo

      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Noronha", false)
      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Rio_Branco", false)
      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Cuiaba", false)
      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Manaus", false)
      expect(mockRecordTimezoneLookup).toHaveBeenCalledWith("America/Sao_Paulo", false)
    })
  })
})
