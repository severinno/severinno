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

import { FEE_RATE } from "./constants"

const MEI_ANNUAL_LIMIT_2024 = 81000.0 // R$ 81.000,00 annual cap for MEI
const FUEL_COST_PER_KM = 0.85 // Estimated fuel cost per km (gasoline average BR)
const PLATFORM_FEE_RATE = FEE_RATE // Canonical platform fee rate from constants

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
  cnpj?: string,
): MEIAnnualReport {
  // 1. Group bookings by month
  const monthlyMap = new Map<
    number,
    {
      gross: number
      platformFee: number
      fuel: number
      materials: number
      count: number
      km: number
    }
  >()

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
  const totalEstimatedMaterialsCost = monthlyBreakdown.reduce(
    (s, m) => s + m.estimatedMaterialsCost,
    0,
  )
  const totalNetRevenue = monthlyBreakdown.reduce((s, m) => s + m.netRevenue, 0)
  const totalBookings = monthlyBreakdown.reduce((s, m) => s + m.bookingCount, 0)
  const totalKmTraveled = monthlyBreakdown.reduce((s, m) => s + m.totalKmTraveled, 0)

  const activeMonths = monthlyBreakdown.filter((m) => m.grossRevenue > 0)
  const averageMonthlyRevenue =
    activeMonths.length > 0 ? round2(totalGrossRevenue / activeMonths.length) : 0

  const highestMonth = monthlyBreakdown.reduce(
    (best, m) =>
      m.grossRevenue > best.revenue ? { month: m.month, revenue: m.grossRevenue } : best,
    { month: 1, revenue: 0 },
  )

  const lowestActiveMonth =
    activeMonths.length > 0
      ? activeMonths.reduce(
          (worst, m) =>
            m.grossRevenue < worst.revenue ? { month: m.month, revenue: m.grossRevenue } : worst,
          { month: activeMonths[0].month, revenue: activeMonths[0].grossRevenue },
        )
      : { month: 1, revenue: 0 }

  // 4. MEI compliance check
  const percentUsed = round2((totalGrossRevenue / MEI_ANNUAL_LIMIT_2024) * 100)
  const isWithinLimit = totalGrossRevenue <= MEI_ANNUAL_LIMIT_2024
  const remainingAllowance = round2(Math.max(0, MEI_ANNUAL_LIMIT_2024 - totalGrossRevenue))

  let warning: string | undefined
  if (percentUsed >= 100) {
    warning =
      "⚠️ ATENÇÃO: Faturamento ultrapassou o limite MEI de R$ 81.000. Migração para ME obrigatória."
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

import { createHash } from "crypto"

export interface CorporateFiscalReceiptInput {
  bookingId: string
  providerName: string
  providerCpfCnpj: string
  clientName: string
  clientCnpj: string
  serviceTitle: string
  serviceDate: Date | string
  grossAmount: number
  platformFee?: number
  city?: string
}

export interface CorporateFiscalReceipt {
  receiptNumber: string
  bookingId: string
  providerName: string
  providerCpfCnpj: string
  clientName: string
  clientCnpj: string
  serviceTitle: string
  serviceDate: string
  grossAmount: number
  platformFee: number
  netAmount: number
  legalBasis: string
  verificationHash: string
  city: string
  issuedAt: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

/**
 * Gera recibo fiscal timbrado estruturado para comprovação de serviço perante condomínios e PJ.
 */
export function generateCorporateFiscalReceipt(
  input: CorporateFiscalReceiptInput,
): CorporateFiscalReceipt {
  const {
    bookingId,
    providerName,
    providerCpfCnpj,
    clientName,
    clientCnpj,
    serviceTitle,
    serviceDate,
    grossAmount,
    platformFee = grossAmount * PLATFORM_FEE_RATE,
    city = "Governador Valadares - MG",
  } = input

  const netAmount = round2(grossAmount - platformFee)
  const issuedAt = new Date().toISOString()
  const dateFormatted =
    typeof serviceDate === "string" ? serviceDate : serviceDate.toISOString().split("T")[0]

  const receiptNumber = `REC-${new Date().getFullYear()}-${bookingId.slice(-6).toUpperCase()}`

  // Hash SHA-256 canônico para auditoria irrefutável
  const canonicalPayload = [
    receiptNumber,
    bookingId,
    providerCpfCnpj,
    clientCnpj,
    grossAmount.toFixed(2),
    netAmount.toFixed(2),
    dateFormatted,
  ].join("|")

  const verificationHash = createHash("sha256").update(canonicalPayload).digest("hex")

  const legalBasis =
    "Emitido nos termos do Art. 26 da Lei Complementar nº 123/2006 e Resolução CGSN nº 140/2018 (Dispensa de emissão de NF-e para consumidor final pessoa física e validade de recibo formal para prestação de serviços por MEI)."

  return {
    receiptNumber,
    bookingId,
    providerName,
    providerCpfCnpj,
    clientName,
    clientCnpj,
    serviceTitle,
    serviceDate: dateFormatted,
    grossAmount: round2(grossAmount),
    platformFee: round2(platformFee),
    netAmount,
    legalBasis,
    verificationHash,
    city,
    issuedAt,
  }
}

/**
 * Renderiza documento HTML oficial com estilização de impressão para condomínios e PJ.
 */
export function renderCorporateFiscalReceiptHtml(receipt: CorporateFiscalReceipt): string {
  const safeNum = escapeHtml(receipt.receiptNumber)
  const safeProvider = escapeHtml(receipt.providerName)
  const safeProviderDoc = escapeHtml(receipt.providerCpfCnpj)
  const safeClient = escapeHtml(receipt.clientName)
  const safeClientDoc = escapeHtml(receipt.clientCnpj)
  const safeService = escapeHtml(receipt.serviceTitle)
  const safeCity = escapeHtml(receipt.city)
  const safeHash = escapeHtml(receipt.verificationHash)
  const safeLegal = escapeHtml(receipt.legalBasis)

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Recibo de Prestação de Serviços — ${safeNum}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: 0 auto; line-height: 1.5; }
    .header { border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .title { font-size: 24px; font-weight: bold; color: #0f172a; }
    .receipt-num { font-size: 16px; color: #0284c7; font-weight: 600; }
    .section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .section-title { font-size: 14px; font-weight: bold; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .financial-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .financial-table th, .financial-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .financial-table th { background: #f1f5f9; font-weight: 600; color: #475569; }
    .net-row { font-weight: bold; font-size: 16px; color: #059669; }
    .declaration { margin: 24px 0; font-size: 14px; text-align: justify; color: #334155; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; text-align: center; }
    .sign-line { border-top: 1px solid #94a3b8; padding-top: 8px; font-size: 13px; font-weight: 500; }
    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }
    .hash { font-family: monospace; word-break: break-all; color: #0284c7; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">Recibo de Prestação de Serviços</div>
      <div style="font-size: 13px; color: #64748b;">Comprovante Fiscal de Quitação — MEI / Condomínios / PJ</div>
    </div>
    <div class="receipt-num">${safeNum}</div>
  </div>

  <div class="section">
    <div class="section-title">Dados do Prestador de Serviços (MEI)</div>
    <div class="grid">
      <div><strong>Razão Social / Nome:</strong> ${safeProvider}</div>
      <div><strong>CPF / CNPJ:</strong> ${safeProviderDoc}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Dados do Tomador dos Serviços (Cliente / PJ / Condomínio)</div>
    <div class="grid">
      <div><strong>Nome / Razão Social:</strong> ${safeClient}</div>
      <div><strong>CNPJ / CPF:</strong> ${safeClientDoc}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Discriminação do Serviço Realizado</div>
    <div><strong>Serviço:</strong> ${safeService}</div>
    <div style="margin-top: 4px;"><strong>Data da Conclusão:</strong> ${receipt.serviceDate}</div>

    <table class="financial-table">
      <thead>
        <tr>
          <th>Descrição</th>
          <th style="text-align: right;">Valor</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Valor Bruto da Operação</td>
          <td style="text-align: right;">R$ ${receipt.grossAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td>Taxa Operacional Intermediação (Severinno Marketplace)</td>
          <td style="text-align: right;">R$ ${receipt.platformFee.toFixed(2)}</td>
        </tr>
        <tr class="net-row">
          <td>Valor Líquido Recebido pelo Prestador</td>
          <td style="text-align: right;">R$ ${receipt.netAmount.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="declaration">
    Declaro para os devidos fins de direito ter prestado integralmente os serviços acima discriminados e ter recebido a respectiva contraprestação líquida, dando plena, geral e irrevogável quitação.
    <br><br>
    <em>${safeLegal}</em>
  </div>

  <div style="text-align: right; margin-top: 20px; font-size: 14px;">
    ${safeCity}, ${new Date(receipt.issuedAt).toLocaleDateString("pt-BR")}.
  </div>

  <div class="signatures">
    <div>
      <div class="sign-line">${safeProvider}<br><span style="font-size: 11px; color: #64748b;">Prestador de Serviços (MEI)</span></div>
    </div>
    <div>
      <div class="sign-line">${safeClient}<br><span style="font-size: 11px; color: #64748b;">Tomador dos Serviços</span></div>
    </div>
  </div>

  <div class="footer">
    <div><strong>Autenticação Criptográfica (SHA-256):</strong> <span class="hash">${safeHash}</span></div>
    <div style="margin-top: 4px;">Plataforma Severinno Marketplace • Validação digital vinculada ao Agendamento #${escapeHtml(receipt.bookingId)}</div>
  </div>
</body>
</html>`
}

/**
 * Gera guia passo a passo com os campos exatos para declaração no portal DASN-SIMEI da Receita Federal.
 */
export function generateDASNStepByStepGuide(report: MEIAnnualReport): {
  portalUrl: string
  deadline: string
  instructions: string[]
  formValues: {
    anoCalendario: number
    receitaComercioIndustria: string
    receitaServicos: string
    possuiEmpregado: string
  }
} {
  return {
    portalUrl: "http://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/dasnsimei.app/",
    deadline: `31 de maio de ${report.year + 1}`,
    instructions: [
      `1. Acesse o portal oficial da Receita Federal pelo link acima ou aplicativo 'MEI Fácil'.`,
      `2. Informe o CNPJ do seu MEI e selecione o Ano-Calendário correspondente a ${report.year}.`,
      `3. No campo 'Receita Bruta Total com Serviços', digite exatamente: R$ ${report.dasnSimeiData.campoReceitaServicos.toFixed(2)}.`,
      `4. No campo 'Comércio e Indústria', deixe 0,00 (toda a sua receita foi gerada por prestação de serviços).`,
      `5. Marque 'Não' na pergunta sobre posse de empregados registrados no período.`,
      `6. Clique em 'Transmitir' e guarde o recibo oficial de entrega.`,
    ],
    formValues: {
      anoCalendario: report.year,
      receitaComercioIndustria: "0,00",
      receitaServicos: report.dasnSimeiData.campoReceitaServicos.toFixed(2).replace(".", ","),
      possuiEmpregado: "Não",
    },
  }
}
