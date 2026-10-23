/**
 * quote-calculator-engine.ts — Calculadora Inteligente de Orçamento com Margem & Deslocamento
 *
 * Motor de precificação justa para o prestador de serviços:
 * 1. Calcula custo de deslocamento de ida e volta (combustível real + depreciação do veículo).
 * 2. Estima a mão de obra técnica baseada no tempo de execução e complexidade da tarefa.
 * 3. Incorpora com exatidão a taxa de plataforma Severinno (15%).
 * 4. Sugere 3 faixas de preço claras:
 *    - Mínimo Seguro (breakeven — sem tomar prejuízo)
 *    - Sugerido (margem saudável de 20-30%)
 *    - Premium (urgência / alta complexidade)
 */

import { FEE_RATE } from "@/lib/constants"

export type VehicleType = "MOTO" | "CAR" | "VAN" | "BICYCLE" | "NONE"
export type ServiceComplexity = "STANDARD" | "HIGH" | "URGENT"

export interface SmartQuoteInput {
  distanceOneWayKm: number
  estimatedLaborHours: number
  hourlyRate?: number // Taxa horária técnica (default: R$ 60/h)
  vehicleType?: VehicleType // Default: MOTO
  fuelPricePerLiter?: number // Preço médio do combustível (default: R$ 5.95)
  complexity?: ServiceComplexity // Default: STANDARD
  materialsCost?: number // Custo de materiais/peças a serem ressarcidos (default: 0)
  customMarginPercent?: number // Margem de lucro desejada (default: 25%)
}

export interface VehicleEfficiency {
  kmPerLiter: number
  wearPerKm: number // Pneus, óleo, manutenção por km
}

export const VEHICLE_PROFILES: Record<VehicleType, VehicleEfficiency> = {
  MOTO: { kmPerLiter: 35, wearPerKm: 0.15 },
  CAR: { kmPerLiter: 11, wearPerKm: 0.35 },
  VAN: { kmPerLiter: 8, wearPerKm: 0.55 },
  BICYCLE: { kmPerLiter: 0, wearPerKm: 0.05 },
  NONE: { kmPerLiter: 0, wearPerKm: 0 },
}

export const COMPLEXITY_MULTIPLIERS: Record<ServiceComplexity, number> = {
  STANDARD: 1.0,
  HIGH: 1.25, // +25% de esforço técnico
  URGENT: 1.5, // +50% plantão / emergência
}

export interface SmartQuoteResult {
  roundtripDistanceKm: number
  travelFuelCost: number
  travelWearCost: number
  totalTravelCost: number
  laborBaseCost: number
  materialsCost: number
  breakevenCost: number
  platformFeeRate: number
  platformFeeAmount: number
  suggestedPrice: number
  minSafePrice: number
  premiumPrice: number
  estimatedNetProfit: number
  profitMarginPercent: number
  complexityMultiplier: number
}

/**
 * Executa o cálculo analítico do orçamento inteligente.
 */
export function calculateSmartQuote(input: SmartQuoteInput): SmartQuoteResult {
  const distanceOneWay = Math.max(0, input.distanceOneWayKm || 0)
  const roundtripDistanceKm = Number((distanceOneWay * 2).toFixed(1))
  const laborHours = Math.max(0.5, input.estimatedLaborHours || 1)
  const hourlyRate = Math.max(10, input.hourlyRate ?? 60)
  const vehicle = input.vehicleType ?? "MOTO"
  const fuelPrice = Math.max(1, input.fuelPricePerLiter ?? 5.95)
  const complexity = input.complexity ?? "STANDARD"
  const materialsCost = Math.max(0, input.materialsCost ?? 0)
  const marginPercent = Math.min(100, Math.max(5, input.customMarginPercent ?? 25))

  const vehicleProfile = VEHICLE_PROFILES[vehicle] || VEHICLE_PROFILES.MOTO
  const complexityMult = COMPLEXITY_MULTIPLIERS[complexity] || 1.0

  // 1. Custo de Deslocamento
  let travelFuelCost = 0
  if (vehicleProfile.kmPerLiter > 0 && roundtripDistanceKm > 0) {
    travelFuelCost = Number(
      ((roundtripDistanceKm / vehicleProfile.kmPerLiter) * fuelPrice).toFixed(2),
    )
  }
  const travelWearCost = Number((roundtripDistanceKm * vehicleProfile.wearPerKm).toFixed(2))
  const totalTravelCost = Number((travelFuelCost + travelWearCost).toFixed(2))

  // 2. Custo de Mão de Obra Técnica
  const laborBaseCost = Number((laborHours * hourlyRate * complexityMult).toFixed(2))

  // 3. Custo Real (Breakeven) antes da margem e taxas
  const directCost = Number((totalTravelCost + laborBaseCost + materialsCost).toFixed(2))

  // 4. Preço com Margem
  // Preço Bruto = Custo / (1 - FEE_RATE) para cobrir a taxa de 15% da plataforma
  const minSafePrice = Number((directCost / (1 - FEE_RATE)).toFixed(2))

  const marginFactor = 1 + marginPercent / 100
  const suggestedPrice = Number(((directCost * marginFactor) / (1 - FEE_RATE)).toFixed(2))

  // Preço Premium: 35% de margem ou multiplicador de alta demanda
  const premiumPrice = Number(((directCost * 1.35) / (1 - FEE_RATE)).toFixed(2))

  // 5. Lucro Líquido Estimado no bolso do prestador (Preço sugerido - Taxa Plataforma - Custos Diretos)
  const platformFeeAmount = Number((suggestedPrice * FEE_RATE).toFixed(2))
  const providerGrossPayout = Number((suggestedPrice - platformFeeAmount).toFixed(2))
  const estimatedNetProfit = Number(
    (providerGrossPayout - totalTravelCost - materialsCost).toFixed(2),
  )

  const profitMarginPercent = Number(((estimatedNetProfit / suggestedPrice) * 100).toFixed(1))

  return {
    roundtripDistanceKm,
    travelFuelCost,
    travelWearCost,
    totalTravelCost,
    laborBaseCost,
    materialsCost,
    breakevenCost: directCost,
    platformFeeRate: FEE_RATE,
    platformFeeAmount,
    suggestedPrice,
    minSafePrice,
    premiumPrice,
    estimatedNetProfit,
    profitMarginPercent,
    complexityMultiplier: complexityMult,
  }
}
