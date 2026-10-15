import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@/__tests__/test-utils"
import { TrustPaymentPills } from "../trust-payment-pills"
import { WhatsappAudioTestimonials } from "../whatsapp-audio-testimonials"
import { PreventiveRoiBar } from "../preventive-roi-bar"

describe("Vitrine CRO Batch 7 Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe("Feature 2: Fast Emergency Duty Pill (Plantão Noturno & Domingo)", () => {
    it("renders the 🚨 Plantão Agora pill and triggers toggle callback", () => {
      const onToggle = vi.fn()
      render(<TrustPaymentPills activePills={[]} onTogglePill={onToggle} onClearPills={vi.fn()} />)

      const plantaoPill = screen.getByRole("checkbox", { name: /plantão/i })
      expect(plantaoPill).toBeInTheDocument()
      expect(screen.getByText(/Atendendo Agora \/ Plantão Noturno & Domingo/i)).toBeInTheDocument()

      fireEvent.click(plantaoPill)
      expect(onToggle).toHaveBeenCalledWith("plantao_agora")
    })

    it("displays active styling when plantao_agora is selected", () => {
      render(
        <TrustPaymentPills
          activePills={["plantao_agora"]}
          onTogglePill={vi.fn()}
          onClearPills={vi.fn()}
        />,
      )

      const plantaoPill = screen.getByRole("checkbox", { name: /plantão/i })
      expect(plantaoPill).toHaveAttribute("aria-checked", "true")
    })
  })

  describe("Feature 4: WhatsappAudioTestimonials (Prova Social Humanizada)", () => {
    it("renders authentic GV customer audio testimonials", () => {
      render(<WhatsappAudioTestimonials />)

      expect(screen.getByText("Dona Maria de Fátima")).toBeInTheDocument()
      expect(screen.getByText("Seu Geraldo Magela")).toBeInTheDocument()
      expect(screen.getByText("Dra. Fernanda Lima")).toBeInTheDocument()
      expect(screen.getByText("Rodrigo Andrade")).toBeInTheDocument()
      expect(screen.getByText("Ilha dos Araújos, GV")).toBeInTheDocument()
    })

    it("toggles play/pause state when clicking audio player button", () => {
      vi.useFakeTimers()
      render(<WhatsappAudioTestimonials />)

      const playButtons = screen.getAllByLabelText(/tocar áudio de depoimento/i)
      expect(playButtons.length).toBe(4)

      // Click play on first story (Dona Maria)
      fireEvent.click(playButtons[0])

      // Play button changes to pause
      expect(screen.getByLabelText(/pausar áudio/i)).toBeInTheDocument()

      // Advance simulated timer
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Click pause
      fireEvent.click(screen.getByLabelText(/pausar áudio/i))
      expect(screen.queryByLabelText(/pausar áudio/i)).not.toBeInTheDocument()
      vi.useRealTimers()
    })

    it("expands transcription and handles onQuoteService callback", () => {
      const onQuote = vi.fn()
      render(<WhatsappAudioTestimonials onQuoteService={onQuote} />)

      // Click transcription toggle for Dona Maria
      const toggleBtns = screen.getAllByRole("button", { name: /ler o que ela\(e\) falou/i })
      fireEvent.click(toggleBtns[0])

      expect(screen.getByText(/O Carlos da Severinno foi maravilhoso/i)).toBeInTheDocument()

      // Click "Pedir Orçamento Igual"
      const quoteBtns = screen.getAllByRole("button", { name: /pedir orçamento igual/i })
      fireEvent.click(quoteBtns[0])

      expect(onQuote).toHaveBeenCalledWith("Elétrica", "Ilha dos Araújos")
    })
  })

  describe("Feature 5: PreventiveRoiBar (Manutenção Preventiva vs Prejuízo)", () => {
    it("renders 4 preventive ROI cards with total calculated savings", () => {
      render(<PreventiveRoiBar />)

      expect(screen.getByText("Manutenção Preventiva vs Prejuízo em GV")).toBeInTheDocument()
      expect(screen.getByText("Até R$ 3.660")).toBeInTheDocument()
      expect(screen.getByText("Vazamento Oculto & Válvula de Descarga")).toBeInTheDocument()
      expect(screen.getByText("Disjuntor Aquecendo & Tomadas Frouxas")).toBeInTheDocument()
      expect(screen.getByText("Filtro de Ar Obstruído & Serpentina Suja")).toBeInTheDocument()
      expect(screen.getByText("Fechadura Engasgando & Trinco Desalinhado")).toBeInTheDocument()
    })

    it("triggers onSelectService when clicking Prevenir com Especialista", () => {
      const onSelect = vi.fn()
      render(<PreventiveRoiBar onSelectService={onSelect} />)

      const btns = screen.getAllByRole("button", { name: /prevenir com especialista/i })
      expect(btns.length).toBe(4)

      // Click first card (Vazamento -> Encanador)
      fireEvent.click(btns[0])
      expect(onSelect).toHaveBeenCalledWith("Encanador")

      // Click second card (Disjuntor -> Eletricista)
      fireEvent.click(btns[1])
      expect(onSelect).toHaveBeenCalledWith("Eletricista")
    })
  })
})
