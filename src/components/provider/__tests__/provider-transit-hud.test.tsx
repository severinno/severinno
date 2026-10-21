import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@/__tests__/test-utils"
import { ProviderTransitHud } from "../provider-transit-hud"

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock haptics
vi.mock("@/lib/haptics", () => ({
  vibrateSuccess: vi.fn(),
  vibrateWarning: vi.fn(),
}))

describe("ProviderTransitHud", () => {
  let watchPositionMock: ReturnType<typeof vi.fn>
  let clearWatchMock: ReturnType<typeof vi.fn>
  let originalGeolocation: Geolocation

  const defaultProps = {
    bookingId: "book-123",
    clientName: "Maria da Silva",
    clientPhone: "33999998888",
    clientAddress: "Rua Israel Pinheiro, 2500 - Centro, Gov. Valadares",
    destinationLat: -18.8545,
    destinationLng: -41.956,
    serviceTitle: "Instalação Elétrica Residencial",
    onClose: vi.fn(),
    onCheckinSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    watchPositionMock = vi.fn()
    clearWatchMock = vi.fn()

    originalGeolocation = navigator.geolocation
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: watchPositionMock,
        clearWatch: clearWatchMock,
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: originalGeolocation,
      configurable: true,
      writable: true,
    })
  })

  it("renderiza o HUD com dados do agendamento e botões de navegação externa", () => {
    render(<ProviderTransitHud {...defaultProps} />)

    expect(screen.getByRole("dialog", { name: "Modo Trânsito HUD" })).toBeDefined()
    expect(screen.getByText("Instalação Elétrica Residencial")).toBeDefined()
    expect(screen.getByText("Rua Israel Pinheiro, 2500 - Centro, Gov. Valadares")).toBeDefined()
    expect(screen.getByText("Maria da Silva")).toBeDefined()

    // Links Waze, Google Maps e WhatsApp
    const wazeLink = screen.getByRole("link", { name: /waze/i })
    expect(wazeLink.getAttribute("href")).toContain("waze.com/ul?ll=-18.8545,-41.956")

    const mapsLink = screen.getByRole("link", { name: /maps/i })
    expect(mapsLink.getAttribute("href")).toContain(
      "google.com/maps/dir/?api=1&destination=-18.8545,-41.956",
    )

    const waLink = screen.getByRole("link", { name: /whatsapp/i })
    expect(waLink.getAttribute("href")).toContain("wa.me/33999998888")
  })

  it("atualiza a distância e badge de acurácia quando o GPS emite nova posição", async () => {
    let positionCallback: (pos: GeolocationPosition) => void = () => {}
    watchPositionMock.mockImplementation((cb) => {
      positionCallback = cb
      return 123
    })

    render(<ProviderTransitHud {...defaultProps} />)

    // Simula prestador a ~30 metros do destino (-18.8543, -41.9560)
    act(() => {
      positionCallback({
        coords: {
          latitude: -18.8543,
          longitude: -41.956,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })

    expect(screen.getByText(/GPS: ±10m/)).toBeDefined()
    expect(screen.getByText("CHEGUEI NO LOCAL (CONFIRMAR)")).toBeDefined()
  })

  it("executa check-in presencial com sucesso quando prestador está no perímetro", async () => {
    let positionCallback: (pos: GeolocationPosition) => void = () => {}
    watchPositionMock.mockImplementation((cb) => {
      positionCallback = cb
      return 123
    })

    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: "Check-in realizado com sucesso" }),
    })

    render(<ProviderTransitHud {...defaultProps} />)

    // Posição exatamente no local
    act(() => {
      positionCallback({
        coords: {
          latitude: -18.8545,
          longitude: -41.956,
          accuracy: 8,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })

    const checkinBtn = screen.getByRole("button", { name: /CHEGUEI NO LOCAL/i })
    fireEvent.click(checkinBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/checkin-escrow",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("checkin"),
        }),
      )
      expect(defaultProps.onCheckinSuccess).toHaveBeenCalled()
    })
  })

  it("aciona onClose ao clicar no botão de fechar o HUD", () => {
    render(<ProviderTransitHud {...defaultProps} />)

    const closeBtn = screen.getByRole("button", { name: "Fechar modo trânsito" })
    fireEvent.click(closeBtn)

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it("permite validação por token de presença quando GPS indisponível", async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { checkedInAt: "2026-01-01" } }),
    })

    render(<ProviderTransitHud {...defaultProps} />)

    const toggleBtn = screen.getByText(/Sem sinal GPS no subsolo ou prédio/i)
    fireEvent.click(toggleBtn)

    const tokenInput = screen.getByPlaceholderText("Código de 6 dígitos")
    fireEvent.change(tokenInput, { target: { value: "123456" } })

    const confirmBtn = screen.getByRole("button", { name: "Confirmar" })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/checkin-escrow",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("presence-checkin"),
        }),
      )
      expect(defaultProps.onCheckinSuccess).toHaveBeenCalled()
    })
  })
})
