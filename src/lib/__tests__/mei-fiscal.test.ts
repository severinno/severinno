import { describe, it, expect } from "vitest"
import {
  generateMEIAnnualReport,
  generateCorporateFiscalReceipt,
  renderCorporateFiscalReceiptHtml,
  generateDASNStepByStepGuide,
} from "../mei-fiscal"

describe("mei-fiscal module", () => {
  const mockBookings = [
    {
      completedAt: new Date("2026-03-10T14:00:00Z"),
      totalAmount: 300,
      distanceKm: 10,
      materialsCost: 20,
    },
    {
      completedAt: new Date("2026-03-25T16:00:00Z"),
      totalAmount: 500,
      distanceKm: 20,
      materialsCost: 50,
    },
    {
      completedAt: new Date("2026-07-15T10:00:00Z"),
      totalAmount: 1200,
      distanceKm: 15,
      materialsCost: 100,
    },
  ]

  it("calcula relatório anual MEI com faturamento e campos do DASN-SIMEI", () => {
    const report = generateMEIAnnualReport(
      "prov-123",
      "Carlos Eletricista MEI",
      2026,
      mockBookings,
      "12.345.678/0001-90",
    )

    expect(report.providerName).toBe("Carlos Eletricista MEI")
    expect(report.cnpj).toBe("12.345.678/0001-90")
    expect(report.annualSummary.totalGrossRevenue).toBe(2000)
    expect(report.annualSummary.totalBookings).toBe(3)
    expect(report.meiCompliance.isWithinLimit).toBe(true)
    expect(report.dasnSimeiData.campoReceitaServicos).toBe(2000)
    expect(report.dasnSimeiData.campoReceitaComercio).toBe(0)

    // Março teve 2 agendamentos: 300 + 500 = 800
    const march = report.monthlyBreakdown.find((m) => m.month === 3)
    expect(march?.grossRevenue).toBe(800)
    expect(march?.bookingCount).toBe(2)
  })

  it("gera recibo fiscal timbrado estruturado para condomínios e PJ com selo SHA-256", () => {
    const receipt = generateCorporateFiscalReceipt({
      bookingId: "book-abc-987",
      providerName: "Severino Eletricista MEI",
      providerCpfCnpj: "12.345.678/0001-90",
      clientName: "Condomínio Edifício Acácia",
      clientCnpj: "98.765.432/0001-10",
      serviceTitle: "Manutenção do quadro de bombas",
      serviceDate: "2026-10-15",
      grossAmount: 850.0,
      city: "Governador Valadares - MG",
    })

    expect(receipt.receiptNumber).toMatch(/^REC-2026-/)
    expect(receipt.grossAmount).toBe(850.0)
    expect(receipt.platformFee).toBe(127.5) // 15% de 850
    expect(receipt.netAmount).toBe(722.5) // 850 - 127.5
    expect(receipt.verificationHash).toHaveLength(64) // SHA-256
    expect(receipt.legalBasis).toContain("Lei Complementar nº 123/2006")
  })

  it("renderiza documento HTML seguro contra XSS com termos legais e layout de impressão", () => {
    const receipt = generateCorporateFiscalReceipt({
      bookingId: "book-xss",
      providerName: "João <script>alert(1)</script>",
      providerCpfCnpj: "123.456.789-00",
      clientName: "Empresa & Associados",
      clientCnpj: "00.111.222/0001-33",
      serviceTitle: "Pintura Comercial",
      serviceDate: "2026-10-16",
      grossAmount: 400.0,
    })

    const html = renderCorporateFiscalReceiptHtml(receipt)

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("Empresa &amp; Associados")
    expect(html).toContain("R$ 400.00")
    expect(html).toContain(receipt.verificationHash)
  })

  it("gera guia passo a passo da declaração DASN-SIMEI com instruções claras", () => {
    const report = generateMEIAnnualReport("prov-1", "Carlos", 2026, mockBookings)
    const guide = generateDASNStepByStepGuide(report)

    expect(guide.portalUrl).toContain("dasnsimei")
    expect(guide.deadline).toContain("2027")
    expect(guide.formValues.receitaServicos).toBe("2000,00")
    expect(guide.formValues.receitaComercioIndustria).toBe("0,00")
    expect(guide.instructions.length).toBeGreaterThanOrEqual(5)
  })
})
