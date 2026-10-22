import { describe, it, expect } from "vitest"
import * as React from "react"
import { render, screen } from "@/__tests__/test-utils"
import { QuotePricingHub } from "../quote-pricing-hub"
import { TrustShieldHub } from "../trust-shield-hub"

describe("Vitrine Dynamic Code-Splitting Hubs", () => {
  it("renderiza QuotePricingHub com abas dinâmicas e fallback limpo", () => {
    render(<QuotePricingHub initialTab="wizard" />)

    expect(screen.getByText("Orçamentômetro WhatsApp")).toBeDefined()
    expect(screen.getByText("Tabela FIPE dos Serviços GV")).toBeDefined()
    expect(screen.getByText("Prevenção vs Prejuízo")).toBeDefined()
  })

  it("renderiza TrustShieldHub com abas dinâmicas e selos de conformidade", () => {
    render(<TrustShieldHub initialTab="transparency" />)

    expect(screen.getByText("Central de Integridade GV")).toBeDefined()
    expect(screen.getByText("Contrato Digital & Recibo")).toBeDefined()
    expect(screen.getByText("Boca a Boca vs Severinno")).toBeDefined()
  })
})
