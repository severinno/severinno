import { describe, it, expect } from "vitest"
import { lookupCnefeGV } from "../geo-cnefe"

describe("CNEFE / IBGE Geocoding — Governador Valadares (MG)", () => {
  it("resolves exact rooftop coordinate for known street and building number", () => {
    const match = lookupCnefeGV({
      street: "Avenida Minas Gerais",
      number: 250,
    })

    expect(match).not.toBeNull()
    expect(match?.city).toBe("Governador Valadares")
    expect(match?.state).toBe("MG")
    expect(match?.district).toBe("Centro")
    expect(match?.source).toBe("cnefe-ibge-rooftop")
    expect(match?.lat).toBeLessThan(-18.85)
    expect(match?.lat).toBeGreaterThan(-18.855)
    expect(match?.lng).toBeLessThan(-41.94)
    expect(match?.lng).toBeGreaterThan(-41.946)
  })

  it("resolves by CEP and interpolates along street for given number", () => {
    const match = lookupCnefeGV({
      cep: "35010-140", // Rua Marechal Floriano
      number: 500,
    })

    expect(match).not.toBeNull()
    expect(match?.street).toBe("Rua Marechal Floriano")
    expect(match?.district).toBe("Centro")
    expect(match?.number).toBe("500")
    expect(match?.confidence).toBeGreaterThan(0.9)
  })

  it("resolves street-level center when number is omitted", () => {
    const match = lookupCnefeGV({
      street: "Rua Israel Pinheiro",
    })

    expect(match).not.toBeNull()
    expect(match?.street).toBe("Rua Israel Pinheiro")
    expect(match?.source).toBe("cnefe-ibge-street")
    expect(match?.number).toBeNull()
  })

  it("resolves rooftop addresses in peripheral neighborhoods like Ilha dos Araújos and São Pedro", () => {
    const ilhaMatch = lookupCnefeGV({
      street: "Avenida Piracicaba",
      number: 300,
    })

    expect(ilhaMatch).not.toBeNull()
    expect(ilhaMatch?.district).toBe("Ilha dos Araújos")
    expect(ilhaMatch?.source).toBe("cnefe-ibge-rooftop")

    const saoPedroMatch = lookupCnefeGV({
      cep: "35041-000",
      number: 600,
    })

    expect(saoPedroMatch).not.toBeNull()
    expect(saoPedroMatch?.district).toBe("São Pedro")
  })

  it("returns null for non-Valadares addresses", () => {
    const match = lookupCnefeGV({
      street: "Avenida Paulista",
      number: 1000,
    })

    expect(match).toBeNull()
  })
})
