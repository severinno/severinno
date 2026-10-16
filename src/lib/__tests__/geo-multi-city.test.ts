import { describe, it, expect } from "vitest"
import {
  isCoordinateInsideCity,
  resolveMultiCityAddress,
  calculateMultiCityRoute,
} from "../geo-multi-city"
import { detectCityFromCep, getCityConfig } from "../cities"

describe("Geo Multi-City & Expansão Territorial", () => {
  it("valida coordenadas dentro dos limites territoriais das cidades registradas", () => {
    // Governador Valadares (Praça dos Pioneiros / Centro)
    expect(isCoordinateInsideCity(-18.8546, -41.9443, "governador-valadares")).toBe(true)

    // Ipatinga (Centro)
    expect(isCoordinateInsideCity(-19.4683, -42.5369, "ipatinga")).toBe(true)

    // Coronel Fabriciano (Centro)
    expect(isCoordinateInsideCity(-19.5214, -42.6322, "coronel-fabriciano")).toBe(true)

    // Teófilo Otoni (Centro)
    expect(isCoordinateInsideCity(-17.8575, -41.5056, "teofilo-otoni")).toBe(true)

    // Ponto em alto-mar (fora de qualquer cidade cadastrada)
    expect(isCoordinateInsideCity(-12.0, -35.0, "governador-valadares")).toBe(false)
    expect(isCoordinateInsideCity(-12.0, -35.0, "ipatinga")).toBe(false)
  })

  it("detecta cidades a partir de faixas de CEP de expansão do Vale do Rio Doce / MG", () => {
    // Governador Valadares
    expect(detectCityFromCep("35010-151")?.id).toBe("governador-valadares")
    expect(detectCityFromCep("35030-200")?.id).toBe("governador-valadares")

    // Ipatinga
    expect(detectCityFromCep("35160-001")?.id).toBe("ipatinga")
    expect(detectCityFromCep("35162-120")?.id).toBe("ipatinga")

    // Coronel Fabriciano
    expect(detectCityFromCep("35170-050")?.id).toBe("coronel-fabriciano")

    // Teófilo Otoni
    expect(detectCityFromCep("39800-100")?.id).toBe("teofilo-otoni")

    // Belo Horizonte
    expect(detectCityFromCep("30130-100")?.id).toBe("belo-horizonte")

    // CEP inválido / de outro estado não suportado
    expect(detectCityFromCep("70000-000")).toBeNull()
  })

  it("resolve endereços prediais em GV e cidades de expansão com fallback seguro", async () => {
    // Resolução em Governador Valadares
    const gvMatch = await resolveMultiCityAddress({
      cityId: "governador-valadares",
      street: "Rua Peçanha",
      number: "450",
    })
    expect(gvMatch).not.toBeNull()
    expect(gvMatch?.city).toBe("Governador Valadares")
    expect(gvMatch?.lat).toBeCloseTo(-18.853, 1)

    // Resolução em Ipatinga com coordenadas conhecidas
    const ipatingaMatch = await resolveMultiCityAddress({
      cityId: "ipatinga",
      lat: -19.4683,
      lng: -42.5369,
      street: "Avenida Brasil",
      number: "100",
    })
    expect(ipatingaMatch).not.toBeNull()
    expect(ipatingaMatch?.city).toBe("Ipatinga")
    expect(ipatingaMatch?.isEstimate).toBe(false)

    // Resolução sem coordenadas fornecidas (fallback para centro cívico)
    const centroidMatch = await resolveMultiCityAddress({
      cityId: "teofilo-otoni",
    })
    expect(centroidMatch).not.toBeNull()
    expect(centroidMatch?.city).toBe("Teófilo Otoni")
    expect(centroidMatch?.source).toBe("city-centroid")
    expect(centroidMatch?.isEstimate).toBe(true)
  })

  it("calcula rotas viárias com estimativa geodésica sinalizada por isEstimate: true", async () => {
    const origin = { lat: -19.4683, lng: -42.5369 }
    const destination = { lat: -19.48, lng: -42.55 }

    const route = await calculateMultiCityRoute({
      origin,
      destination,
      cityId: "ipatinga",
    })

    expect(route.distanceKm).toBeGreaterThan(0)
    expect(route.durationMinutes).toBeGreaterThan(0)
    expect(route.polyline.length).toBeGreaterThanOrEqual(2)
    expect(typeof route.isEstimate).toBe("boolean")
    expect(route.cityId).toBe("ipatinga")
  })
})
