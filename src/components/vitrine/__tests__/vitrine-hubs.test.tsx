import { describe, it, expect, vi, afterEach } from "vitest"
import * as React from "react"
import { render, screen, fireEvent, cleanup, waitFor } from "@/__tests__/test-utils"
import { QuotePricingHub } from "../quote-pricing-hub"
import { VisualProofHub } from "../visual-proof-hub"
import { TrustShieldHub } from "../trust-shield-hub"

afterEach(() => {
  cleanup()
})

describe("QuotePricingHub", () => {
  it("renders with default tab and navigates between wizard, fipe, and roi tabs", async () => {
    const onSearchMock = vi.fn()
    render(<QuotePricingHub onSearchService={onSearchMock} />)

    // Default tab: Orçamentômetro WhatsApp
    expect(
      screen.getByRole("region", {
        name: "Central de Cotação Inteligente e Preço Justo em Governador Valadares",
      }),
    ).toBeDefined()
    expect(screen.getByText("Orçamentômetro WhatsApp")).toBeDefined()
    await waitFor(() => {
      expect(screen.getByText("Eletricista")).toBeDefined()
    })

    // Switch to FIPE tab
    const fipeTab = screen.getByRole("tab", { name: /Tabela FIPE dos Serviços GV/i })
    fireEvent.click(fipeTab)
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Tabela FIPE dos Serviços de Governador Valadares" }),
      ).toBeDefined()
    })

    // Switch to ROI tab
    const roiTab = screen.getByRole("tab", { name: /Prevenção vs Prejuízo/i })
    fireEvent.click(roiTab)
    await waitFor(() => {
      expect(screen.getByText(/Manutenção Preventiva vs Prejuízo em GV/i)).toBeDefined()
    })
  })
})

describe("VisualProofHub", () => {
  it("renders with default reels tab and navigates between before/after and audio tabs", () => {
    render(<VisualProofHub />)

    expect(
      screen.getByRole("region", {
        name: "Central de Prova Visual e Transformações Reais em Governador Valadares",
      }),
    ).toBeDefined()
    expect(screen.getByRole("tab", { name: /Vídeos & Reels em GV/i })).toBeDefined()
    expect(screen.getByText(/Transformação Completa de Quadro Antigo/i)).toBeDefined()

    // Switch to Before & After tab
    const beforeAfterTab = screen.getByRole("tab", { name: /Antes & Depois/i })
    fireEvent.click(beforeAfterTab)
    expect(screen.getByText(/Transformações Reais: Antes & Depois/i)).toBeDefined()

    // Switch to WhatsApp Audios tab
    const audiosTab = screen.getByRole("tab", { name: /Depoimentos em Áudio/i })
    fireEvent.click(audiosTab)
    expect(screen.getByText(/Ouça o que os moradores de Valadares dizem/i)).toBeDefined()

    // Switch to 4th tab: Radar Ao Vivo (Bairros GV)
    const radarTab = screen.getByRole("tab", { name: /Radar Ao Vivo \(Bairros GV\)/i })
    fireEvent.click(radarTab)
    expect(
      screen.getByRole("region", {
        name: "Radar Ao Vivo de Técnicos em Governador Valadares",
      }),
    ).toBeDefined()
  })
})

describe("TrustShieldHub", () => {
  it("renders with default transparency tab and navigates between contract and comparison tabs", async () => {
    render(<TrustShieldHub />)

    expect(
      screen.getByRole("region", {
        name: "Central de Segurança Jurídica, Garantia e Integridade em Governador Valadares",
      }),
    ).toBeDefined()
    expect(screen.getByRole("tab", { name: /Central de Integridade GV/i })).toBeDefined()
    await waitFor(() => {
      expect(
        screen.getByRole("region", {
          name: "Central de Integridade e Transparência em Governador Valadares",
        }),
      ).toBeDefined()
    })

    // Switch to Contract tab
    const contractTab = screen.getByRole("tab", { name: /Contrato Digital & Recibo/i })
    fireEvent.click(contractTab)
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Gerador de Pré-Contrato Digital e Recibo Oficial" }),
      ).toBeDefined()
    })

    // Switch to Comparison tab
    const comparisonTab = screen.getByRole("tab", { name: /Boca a Boca vs Severinno/i })
    fireEvent.click(comparisonTab)
    await waitFor(() => {
      expect(
        screen.getByRole("region", {
          name: "Comparativo de Segurança",
        }),
      ).toBeDefined()
    })
  })
})

describe("GvLiveRadarMap", () => {
  it("renders live radar with district indicators and responds to district selection", async () => {
    const { GvLiveRadarMap } = await import("../gv-live-radar-map")
    const onSelectMock = vi.fn()
    render(<GvLiveRadarMap onSelectDistrict={onSelectMock} />)

    expect(
      screen.getByRole("region", {
        name: "Radar Ao Vivo de Técnicos em Governador Valadares",
      }),
    ).toBeDefined()
    expect(screen.getAllByText("Ilha dos Araújos")[0]).toBeDefined()
    expect(screen.getByText("Centro")).toBeDefined()

    // Select Centro district
    const centroBtn = screen.getByText("Centro")
    fireEvent.click(centroBtn)

    expect(screen.getByText(/Em rota na Av. Minas Gerais/i)).toBeDefined()
    const callBtn = screen.getByText("Ver Prestadores de Centro")
    fireEvent.click(callBtn)
    expect(onSelectMock).toHaveBeenCalledWith("Centro")
  })
})

describe("CategoryShowcase Turbo & HowItWorks Horizontal", () => {
  it("renders category counts, scroll arrows, and clear button when a category is active", async () => {
    const CategoryShowcase = (await import("../category-showcase")).default
    const onSelect = vi.fn()
    const categories = [
      {
        id: "cat-1",
        name: "Reparos e Instalações",
        slug: "reparos-e-instalacoes",
        level: 0,
        children: [],
      },
      {
        id: "cat-2",
        name: "Emergência 24h",
        slug: "emergencia-24h",
        level: 0,
        children: [],
      },
    ]

    render(<CategoryShowcase categories={categories} activeId="cat-1" onSelect={onSelect} />)

    expect(screen.getByText("48")).toBeDefined()
    expect(screen.getByText("14")).toBeDefined()
    expect(screen.getByLabelText("Rolar categorias para a esquerda")).toBeDefined()
    expect(screen.getByLabelText("Rolar categorias para a direita")).toBeDefined()

    const clearBtn = screen.getByLabelText("Limpar categoria selecionada")
    fireEvent.click(clearBtn)
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it("renders HowItWorks horizontal interactive steps with Escrow PIX and 90-day warranty highlights", async () => {
    const HowItWorks = (await import("../how-it-works")).default
    render(<HowItWorks />)

    expect(screen.getByText("Fluxo Blindado em 3 Passos")).toBeDefined()
    expect(screen.getByText("Garantia de 90 dias + Recibo Digital")).toBeDefined()
    expect(screen.getByText("100% Antecedentes e CPF/CNPJ Checados")).toBeDefined()
  })
})
