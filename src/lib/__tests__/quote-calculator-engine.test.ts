import { describe, it, expect } from "vitest"
import { calculateSmartQuote } from "../quote-calculator-engine"

describe("quote-calculator-engine", () => {
  it("calcula orçamento com deslocamento de moto e taxa de plataforma de 15%", () => {
    const result = calculateSmartQuote({
      distanceOneWayKm: 10, // 20 km ida e volta
      estimatedLaborHours: 2, // 2h de trabalho
      hourlyRate: 50, // R$ 50/h = R$ 100 mão de obra
      vehicleType: "MOTO",
      fuelPricePerLiter: 6.0,
      complexity: "STANDARD",
      customMarginPercent: 20,
    })

    // 20 km / 35 km/L * R$ 6 = ~R$ 3.43 de combustível
    // Desgaste: 20 km * 0.15 = R$ 3.00
    // Total viagem = R$ 6.43
    expect(result.roundtripDistanceKm).toBe(20)
    expect(result.travelFuelCost).toBeCloseTo(3.43, 1)
    expect(result.travelWearCost).toBe(3.0)
    expect(result.totalTravelCost).toBeCloseTo(6.43, 1)

    // Mão de obra = R$ 100
    expect(result.laborBaseCost).toBe(100)

    // Custo direto = ~R$ 106.43
    expect(result.breakevenCost).toBeCloseTo(106.43, 1)

    // Preço sugerido cobre a margem de 20% e os 15% de taxa da plataforma
    expect(result.suggestedPrice).toBeGreaterThan(result.minSafePrice)
    expect(result.premiumPrice).toBeGreaterThan(result.suggestedPrice)

    // O prestador recebe um lucro líquido positivo
    expect(result.estimatedNetProfit).toBeGreaterThan(0)
    expect(result.profitMarginPercent).toBeGreaterThan(0)
  })

  it("calcula custo maior de deslocamento para carro do que moto", () => {
    const quoteMoto = calculateSmartQuote({
      distanceOneWayKm: 15,
      estimatedLaborHours: 1,
      vehicleType: "MOTO",
    })

    const quoteCar = calculateSmartQuote({
      distanceOneWayKm: 15,
      estimatedLaborHours: 1,
      vehicleType: "CAR",
    })

    expect(quoteCar.totalTravelCost).toBeGreaterThan(quoteMoto.totalTravelCost)
    expect(quoteCar.suggestedPrice).toBeGreaterThan(quoteMoto.suggestedPrice)
  })

  it("aplica multiplicador de urgência (URGENT = 1.5x) para serviços de emergência", () => {
    const standard = calculateSmartQuote({
      distanceOneWayKm: 5,
      estimatedLaborHours: 1,
      hourlyRate: 100,
      complexity: "STANDARD",
    })

    const urgent = calculateSmartQuote({
      distanceOneWayKm: 5,
      estimatedLaborHours: 1,
      hourlyRate: 100,
      complexity: "URGENT",
    })

    expect(urgent.complexityMultiplier).toBe(1.5)
    expect(urgent.laborBaseCost).toBe(150)
    expect(urgent.suggestedPrice).toBeGreaterThan(standard.suggestedPrice)
  })

  it("trata serviço sem deslocamento (0 km) graciosamente", () => {
    const result = calculateSmartQuote({
      distanceOneWayKm: 0,
      estimatedLaborHours: 1,
      hourlyRate: 80,
      vehicleType: "NONE",
    })

    expect(result.roundtripDistanceKm).toBe(0)
    expect(result.totalTravelCost).toBe(0)
    expect(result.laborBaseCost).toBe(80)
    expect(result.suggestedPrice).toBeGreaterThan(0)
  })
})
