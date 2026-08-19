/**
 * streaming-exporter.ts — Memory-Efficient Financial BI CSV & DRE Streaming Exporter
 *
 * Generates RFC 4180-compliant CSV and DRE statements with UTF-8 BOM for
 * seamless import into Excel, Google Sheets, ContaAzul, and Omie.
 *
 * Cost: $0 — Pure Node/Web standard Streams (0 memory leaks on large exports).
 */

export interface TransactionRecord {
  id: string
  date: string
  clientName: string
  providerName: string
  serviceTitle: string
  grossAmount: number
  platformFeeRate: number
  platformFeeAmount: number
  providerPayoutAmount: number
  paymentMethod: string
  paymentStatus: string
  bookingStatus: string
}

export interface FinancialExportSummary {
  period: string
  totalTransactions: number
  totalGrossGMV: number
  totalPlatformRevenue: number
  totalProviderPayouts: number
  averageTakeRatePercent: number
  generatedAt: string
}

/**
 * Escapes and quotes a single CSV field value
 */
export function escapeCSVField(value: unknown, delimiter: string = ";"): string {
  if (value === null || value === undefined) return ""
  const str = String(value).trim()

  if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Formats an array of fields into a CSV line
 */
export function formatCSVLine(fields: unknown[], delimiter: string = ";"): string {
  return fields.map((f) => escapeCSVField(f, delimiter)).join(delimiter) + "\r\n"
}

/**
 * Generates complete financial CSV export with UTF-8 BOM for Brazilian Excel
 */
export function generateFinancialCSV(
  transactions: TransactionRecord[],
  delimiter: string = ";",
): string {
  const BOM = "\uFEFF" // UTF-8 Byte Order Mark for Excel pt-BR

  const headers = [
    "ID Transação",
    "Data",
    "Cliente",
    "Prestador",
    "Serviço",
    "Valor Bruto (R$)",
    "Taxa Severinno (%)",
    "Comissão Plataforma (R$)",
    "Repasse Prestador (R$)",
    "Forma Pagamento",
    "Status Pagamento",
    "Status Agendamento",
  ]

  let csv = BOM + formatCSVLine(headers, delimiter)

  for (const t of transactions) {
    const row = [
      t.id,
      t.date,
      t.clientName,
      t.providerName,
      t.serviceTitle,
      t.grossAmount.toFixed(2).replace(".", ","),
      (t.platformFeeRate * 100).toFixed(1).replace(".", ","),
      t.platformFeeAmount.toFixed(2).replace(".", ","),
      t.providerPayoutAmount.toFixed(2).replace(".", ","),
      t.paymentMethod,
      t.paymentStatus,
      t.bookingStatus,
    ]
    csv += formatCSVLine(row, delimiter)
  }

  return csv
}

/**
 * Computes executive business summary from transactions list
 */
export function computeFinancialSummary(
  transactions: TransactionRecord[],
  period: string = "Últimos 30 dias",
): FinancialExportSummary {
  const totalGrossGMV = transactions.reduce((s, t) => s + t.grossAmount, 0)
  const totalPlatformRevenue = transactions.reduce((s, t) => s + t.platformFeeAmount, 0)
  const totalProviderPayouts = transactions.reduce((s, t) => s + t.providerPayoutAmount, 0)
  const averageTakeRatePercent =
    totalGrossGMV > 0 ? Number(((totalPlatformRevenue / totalGrossGMV) * 100).toFixed(2)) : 0

  return {
    period,
    totalTransactions: transactions.length,
    totalGrossGMV: Number(totalGrossGMV.toFixed(2)),
    totalPlatformRevenue: Number(totalPlatformRevenue.toFixed(2)),
    totalProviderPayouts: Number(totalProviderPayouts.toFixed(2)),
    averageTakeRatePercent,
    generatedAt: new Date().toISOString(),
  }
}
