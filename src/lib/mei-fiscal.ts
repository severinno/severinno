/**
 * mei-fiscal.ts — MEI/DASN-SIMEI Fiscal Module for Service Providers
 *
 * Calculates provider earnings, deducts estimated operational costs (fuel,
 * materials, platform fees), and generates a structured annual declaration
 * report compatible with the Brazilian DASN-SIMEI (Declaração Anual do
 * Microempreendedor Individual).
 *
 * Creates lock-in: providers depend on Severinno for their entire fiscal life.
 * Cost: $0 — Pure TypeScript calculations + PDF-ready data structure
 */

export interface MonthlyEarning {
  month: number // 1-12
  year: number
  grossRevenue: number
  platformFee: number
  estimatedFuelCost: number
  estimatedMaterialsCost: number
  netRevenue: number
  bookingCount: number
  totalKmTraveled: number
}

export interface MEIAnnualReport {
  providerId: string
  providerName: string
  cnpj?: string
  year: number
  monthlyBreakdown: MonthlyEarning[]
  annualSummary: {
    totalGrossRevenue: number
    totalPlatformFees: number
    totalEstimatedFuelCost: number
    totalEstimatedMaterialsCost: number
    totalNetRevenue: number
    totalBookings: number
    totalKmTraveled: number
    averageMonthlyRevenue: number
    highestMonth: { month: number; revenue: number }
    lowestMonth: { month: number; revenue: number }
  }
  meiCompliance: {
    annualLimit: number
    percentUsed: number
    isWithinLimit: boolean
    remainingAllowance: number
    warning?: string
  }
  dasnSimeiData: {
    campoReceitaBrutaTotal: number
    campoReceitaComercio: number
    campoReceitaIndustria: number
    campoReceitaServicos: number
    temEmpregado: boolean
    recolheuDAS: boolean
  }
  generatedAt: string
}

const MEI_ANNUAL_LIMIT_2024 = 81000.00 // R$ 81.000,00 annual cap for MEI
const FUEL_COST_PER_KM = 0.85 // Estimated fuel cost per km (gasoline average BR)
const PLATFORM_FEE_RATE = 0.12 // 12% Severinno platform fee

/**
 * Generates a complete MEI annual fiscal report from booking history
 */
export function generateMEIAnnualReport(
  providerId: string,
  providerName: string,
  year: number,
  bookings: Array<{
    completedAt: Date
    totalAmount: number
    distanceKm: number
    materialsCost?: number
  }>,
  cnpj?: string
): MEIAnnualReport {
  // 1. Group bookings by month
  const monthlyMap = new Map<number, {
    gross: number
    platformFee: number
    fuel: number
    materials: number
    count: number
    km: number
  }>()

  for (let m = 1; m <= 12; m++) {
    monthlyMap.set(m, { gross: 0, platformFee: 0, fuel: 0, materials: 0, count: 0, km: 0 })
  }

  for (const booking of bookings) {
    const bookingDate = new Date(booking.completedAt)
    if (bookingDate.getFullYear() !== year) continue

    const month = bookingDate.getMonth() + 1
    const entry = monthlyMap.get(month)!

    entry.gross += booking.totalAmount
    entry.platformFee += booking.totalAmount * PLATFORM_FEE_RATE
    entry.fuel += booking.distanceKm * FUEL_COST_PER_KM
    entry.materials += booking.materialsCost || 0
    entry.count += 1
    entry.km += booking.distanceKm
  }

  // 2. Build monthly breakdown
  const monthlyBreakdown: MonthlyEarning[] = []
  for (let m = 1; m <= 12; m++) {
    const entry = monthlyMap.get(m)!
    monthlyBreakdown.push({
      month: m,
      year,
      grossRevenue: round2(entry.gross),
      platformFee: round2(entry.platformFee),
      estimatedFuelCost: round2(entry.fuel),
      estimatedMaterialsCost: round2(entry.materials),
      netRevenue: round2(entry.gross - entry.platformFee - entry.fuel - entry.materials),
      bookingCount: entry.count,
      totalKmTraveled: round2(entry.km),
    })
  }

  // 3. Compute annual summary
  const totalGrossRevenue = monthlyBreakdown.reduce((s, m) => s + m.grossRevenue, 0)
  const totalPlatformFees = monthlyBreakdown.reduce((s, m) => s + m.platformFee, 0)
  const totalEstimatedFuelCost = monthlyBreakdown.reduce((s, m) => s + m.estimatedFuelCost, 0)
  const totalEstimatedMaterialsCost = monthlyBreakdown.reduce((s, m) => s + m.estimatedMaterialsCost, 0)
  const totalNetRevenue = monthlyBreakdown.reduce((s, m) => s + m.netRevenue, 0)
  const totalBookings = monthlyBreakdown.reduce((s, m) => s + m.bookingCount, 0)
  const totalKmTraveled = monthlyBreakdown.reduce((s, m) => s + m.totalKmTraveled, 0)

  const activeMonths = monthlyBreakdown.filter((m) => m.grossRevenue > 0)
  const averageMonthlyRevenue = activeMonths.length > 0
    ? round2(totalGrossRevenue / activeMonths.length)
    : 0

  const highestMonth = monthlyBreakdown.reduce(
    (best, m) => (m.grossRevenue > best.revenue ? { month: m.month, revenue: m.grossRevenue } : best),
    { month: 1, revenue: 0 }
  )

  const lowestActiveMonth = activeMonths.length > 0
    ? activeMonths.reduce(
        (worst, m) => (m.grossRevenue < worst.revenue ? { month: m.month, revenue: m.grossRevenue } : worst),
        { month: activeMonths[0].month, revenue: activeMonths[0].grossRevenue }
      )
    : { month: 1, revenue: 0 }

  // 4. MEI compliance check
  const percentUsed = round2((totalGrossRevenue / MEI_ANNUAL_LIMIT_2024) * 100)
  const isWithinLimit = totalGrossRevenue <= MEI_ANNUAL_LIMIT_2024
  const remainingAllowance = round2(Math.max(0, MEI_ANNUAL_LIMIT_2024 - totalGrossRevenue))

  let warning: string | undefined
  if (percentUsed >= 100) {
    warning = "⚠️ ATENÇÃO: Faturamento ultrapassou o limite MEI de R$ 81.000. Migração para ME obrigatória."
  } else if (percentUsed >= 80) {
    warning = "⚡ Atenção: Faturamento próximo do limite MEI. Considere planejar migração para ME."
  }

  // 5. DASN-SIMEI fields
  const dasnSimeiData = {
    campoReceitaBrutaTotal: round2(totalGrossRevenue),
    campoReceitaComercio: 0,
    campoReceitaIndustria: 0,
    campoReceitaServicos: round2(totalGrossRevenue), // All revenue is service-based
    temEmpregado: false,
    recolheuDAS: true,
  }

  return {
    providerId,
    providerName,
    cnpj,
    year,
    monthlyBreakdown,
    annualSummary: {
      totalGrossRevenue: round2(totalGrossRevenue),
      totalPlatformFees: round2(totalPlatformFees),
      totalEstimatedFuelCost: round2(totalEstimatedFuelCost),
      totalEstimatedMaterialsCost: round2(totalEstimatedMaterialsCost),
      totalNetRevenue: round2(totalNetRevenue),
      totalBookings,
      totalKmTraveled: round2(totalKmTraveled),
      averageMonthlyRevenue,
      highestMonth,
      lowestMonth: lowestActiveMonth,
    },
    meiCompliance: {
      annualLimit: MEI_ANNUAL_LIMIT_2024,
      percentUsed,
      isWithinLimit,
      remainingAllowance,
      warning,
    },
    dasnSimeiData,
    generatedAt: new Date().toISOString(),
  }
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}
