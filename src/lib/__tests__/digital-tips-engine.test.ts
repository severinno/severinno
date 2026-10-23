import { describe, it, expect } from "vitest"
import { calculateTipDistribution, processDigitalTip } from "../digital-tips-engine"

describe("digital-tips-engine", () => {
  it("garante que a taxa da plataforma sobre gorjeta é rigorosamente 0.00%", () => {
    const res = calculateTipDistribution(25.0)

    expect(res.isValid).toBe(true)
    expect(res.amount).toBe(25.0)
    expect(res.platformFee).toBe(0.0)
    expect(res.providerNetShare).toBe(25.0)
  })

  it("rejeita valores abaixo do mínimo (R$ 2,00) ou acima do teto (R$ 500,00)", () => {
    const under = calculateTipDistribution(1.5)
    expect(under.isValid).toBe(false)
    expect(under.error).toContain("mínimo")

    const over = calculateTipDistribution(600.0)
    expect(over.isValid).toBe(false)
    expect(over.error).toContain("máximo")
  })

  it("processa a gorjeta e gera o recibo digital com selo SHA-256 e payload Pix", () => {
    const receipt = processDigitalTip({
      bookingId: "booking-777",
      clientName: "Mariana Costa",
      providerName: "Roberto Chaveiro",
      providerPixKey: "roberto@chaveiro.com",
      amount: 20.0,
      message: "Chegou super rápido no Centro de GV, excelente serviço!",
    })

    expect(receipt.tipId).toMatch(/^tip_/)
    expect(receipt.amount).toBe(20.0)
    expect(receipt.platformFee).toBe(0.0)
    expect(receipt.providerNetShare).toBe(20.0)
    expect(receipt.receiptHash).toHaveLength(64) // SHA-256
    expect(receipt.pixTransferPayload.amountCents).toBe(2000)
    expect(receipt.pixTransferPayload.destinationKey).toBe("roberto@chaveiro.com")
    expect(receipt.whatsappNotification).toContain("R$ 20.00")
    expect(receipt.whatsappNotification).toContain("Mariana Costa")
  })
})
