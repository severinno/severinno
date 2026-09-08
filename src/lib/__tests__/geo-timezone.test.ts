import { describe, it, expect } from "vitest"
import { getTimezoneFromCoords, getTimezoneInfo } from "../geo-timezone"

describe("geo-timezone.ts — Brazilian Timezone Detection", () => {
  it("detects America/Noronha (UTC-2) for Fernando de Noronha", () => {
    // Fernando de Noronha (~ -3.85, -32.42)
    expect(getTimezoneFromCoords(-3.854, -32.423)).toBe("America/Noronha")
    const info = getTimezoneInfo(-3.854, -32.423)
    expect(info.utcOffsetHours).toBe(-2)
  })

  it("detects America/Rio_Branco (UTC-5) for Acre and extreme western Amazonas", () => {
    // Rio Branco, AC (~ -9.97, -67.81)
    expect(getTimezoneFromCoords(-9.975, -67.81)).toBe("America/Rio_Branco")
    // Cruzeiro do Sul, AC (~ -7.63, -72.67)
    expect(getTimezoneFromCoords(-7.63, -72.67)).toBe("America/Rio_Branco")
    // Atalaia do Norte, AM (~ -4.37, -70.19)
    expect(getTimezoneFromCoords(-4.37, -70.19)).toBe("America/Rio_Branco")
    const info = getTimezoneInfo(-9.975, -67.81)
    expect(info.utcOffsetHours).toBe(-5)
  })

  it("detects America/Cuiaba (UTC-4) for Mato Grosso and Mato Grosso do Sul", () => {
    // Cuiabá, MT (~ -15.60, -56.09)
    expect(getTimezoneFromCoords(-15.601, -56.097)).toBe("America/Cuiaba")
    // Campo Grande, MS (~ -20.46, -54.62)
    expect(getTimezoneFromCoords(-20.469, -54.62)).toBe("America/Cuiaba")
  })

  it("detects America/Manaus (UTC-4) for Amazonas, Roraima and Rondônia", () => {
    // Manaus, AM (~ -3.11, -60.02)
    expect(getTimezoneFromCoords(-3.119, -60.021)).toBe("America/Manaus")
    // Boa Vista, RR (~ 2.82, -60.67)
    expect(getTimezoneFromCoords(2.823, -60.675)).toBe("America/Manaus")
    // Porto Velho, RO (~ -8.76, -63.90)
    expect(getTimezoneFromCoords(-8.761, -63.903)).toBe("America/Manaus")
  })

  it("detects America/Sao_Paulo (UTC-3) for Brasília and other states", () => {
    // São Paulo, SP (~ -23.55, -46.63)
    expect(getTimezoneFromCoords(-23.5505, -46.6333)).toBe("America/Sao_Paulo")
    // Rio de Janeiro, RJ (~ -22.90, -43.17)
    expect(getTimezoneFromCoords(-22.9068, -43.1729)).toBe("America/Sao_Paulo")
    // Brasília, DF (~ -15.79, -47.88)
    expect(getTimezoneFromCoords(-15.7939, -47.8828)).toBe("America/Sao_Paulo")
    // Salvador, BA (~ -12.97, -38.50)
    expect(getTimezoneFromCoords(-12.9777, -38.5016)).toBe("America/Sao_Paulo")
    // Curitiba, PR (~ -25.42, -49.27)
    expect(getTimezoneFromCoords(-25.429, -49.2671)).toBe("America/Sao_Paulo")
    // Belém, PA (~ -1.45, -48.49)
    expect(getTimezoneFromCoords(-1.4558, -48.4902)).toBe("America/Sao_Paulo")
    // Governador Valadares, MG (~ -18.85, -41.95)
    expect(getTimezoneFromCoords(-18.8566, -41.9455)).toBe("America/Sao_Paulo")
  })

  it("handles invalid coordinates gracefully by falling back to America/Sao_Paulo", () => {
    expect(getTimezoneFromCoords(NaN, NaN)).toBe("America/Sao_Paulo")
    expect(getTimezoneFromCoords(Infinity, -46)).toBe("America/Sao_Paulo")
  })
})
