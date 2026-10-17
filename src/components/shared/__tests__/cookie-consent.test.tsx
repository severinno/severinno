import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@/__tests__/test-utils"
import { CookieConsent } from "../cookie-consent"

// Mock framer-motion to avoid animation timing issues in jsdom
vi.mock("framer-motion", () => ({
  motion: {
    aside: ({ children, ...props }: any) => <aside {...props}>{children}</aside>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

const mockSetFromGPS = vi.fn().mockResolvedValue(undefined)
vi.mock("@/store/geo", () => ({
  useGeoStore: vi.fn((selector) => {
    const state = { setFromGPS: mockSetFromGPS }
    return selector ? selector(state) : state
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe("CookieConsent / SmartConsentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders after the 2.5s initial delay", () => {
    render(<CookieConsent />)

    // Initially not visible
    expect(screen.queryByText("Serviços perto de você em Valadares")).not.toBeInTheDocument()

    // Advance timer by 2.5s
    act(() => {
      vi.advanceTimersByTime(2500)
    })

    // Now visible
    expect(screen.getByText("Serviços perto de você em Valadares")).toBeInTheDocument()
    expect(
      screen.getByText(/Usamos sua localização para calcular distâncias reais de chegada/),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Permitir e continuar/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Agora não/i })).toBeInTheDocument()
  })

  it("does not render if consent has already been accepted", () => {
    localStorage.setItem("severinno:cookie-consent", "accepted")

    render(<CookieConsent />)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText("Serviços perto de você em Valadares")).not.toBeInTheDocument()
  })

  it("does not render if consent has already been dismissed", () => {
    localStorage.setItem("severinno:cookie-consent", "dismissed")

    render(<CookieConsent />)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText("Serviços perto de você em Valadares")).not.toBeInTheDocument()
  })

  it("handles 'Permitir e continuar' click by saving to localStorage, triggering GPS and closing", async () => {
    render(<CookieConsent />)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    const allowBtn = screen.getByRole("button", { name: /Permitir e continuar/i })

    await act(async () => {
      fireEvent.click(allowBtn)
    })

    expect(localStorage.getItem("severinno:cookie-consent")).toBe("accepted")
    expect(mockSetFromGPS).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Serviços perto de você em Valadares")).not.toBeInTheDocument()
  })

  it("handles 'Agora não' click by saving dismissal and closing without calling GPS", () => {
    render(<CookieConsent />)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    const dismissBtn = screen.getByRole("button", { name: /Agora não/i })

    act(() => {
      fireEvent.click(dismissBtn)
    })

    expect(localStorage.getItem("severinno:cookie-consent")).toBe("dismissed")
    expect(mockSetFromGPS).not.toHaveBeenCalled()
    expect(screen.queryByText("Serviços perto de você em Valadares")).not.toBeInTheDocument()
  })

  it("handles the close button [X] by dismissing without calling GPS", () => {
    render(<CookieConsent />)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    const closeBtn = screen.getByLabelText("Dispensar aviso")

    act(() => {
      fireEvent.click(closeBtn)
    })

    expect(localStorage.getItem("severinno:cookie-consent")).toBe("dismissed")
    expect(mockSetFromGPS).not.toHaveBeenCalled()
    expect(screen.queryByText("Serviços perto de você em Valadares")).not.toBeInTheDocument()
  })
})
