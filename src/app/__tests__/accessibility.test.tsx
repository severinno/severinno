import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, fireEvent, cleanup } from "@testing-library/react"
import { axe } from "vitest-axe"
import NotFound from "../not-found"
import ErrorComponent from "../error"

// Suppress console.error during error boundary tests (expected logs)
let consoleSpy: ReturnType<typeof vi.spyOn>

afterEach(() => {
  cleanup()
  consoleSpy?.mockRestore()
  vi.useRealTimers()
})

// ── NotFound (404 page) ───────────────────────────────────────────────────

describe("NotFound (404 page) — accessibility", () => {
  it("should have no accessibility violations", async () => {
    const { container } = render(<NotFound />)
    const results = await axe(container)
    // Manual check: axe violations should be empty
    // Incomplete checks (e.g., color-contrast) are expected in jsdom
    expect(results.violations).toHaveLength(0)
  })

  it("has a meaningful h1 heading", () => {
    const { container } = render(<NotFound />)
    const h1 = container.querySelector("h1")
    expect(h1).toBeInTheDocument()
    expect(h1?.textContent).toBe("Página não encontrada")
  })

  it("links have accessible text and valid hrefs", () => {
    const { container } = render(<NotFound />)
    const links = container.querySelectorAll("a")
    expect(links.length).toBe(2)

    links.forEach((link) => {
      expect(link.textContent?.trim()).toBeTruthy()
      expect(link.getAttribute("href")).toBeTruthy()
    })

    // Link 1: home
    expect(links[0].textContent).toContain("Voltar ao início")
    expect(links[0].getAttribute("href")).toBe("/")

    // Link 2: search
    expect(links[1].textContent).toContain("Buscar profissionais")
    expect(links[1].getAttribute("href")).toBe("/busca")
  })

  it("footer has accessible text", () => {
    const { container } = render(<NotFound />)
    const footer = container.querySelector("footer")
    expect(footer).toBeInTheDocument()
    expect(footer?.textContent?.trim()).toBeTruthy()
  })

  it("status badge is present", () => {
    const { container } = render(<NotFound />)
    const badge = container.querySelector("span")
    expect(badge?.textContent).toContain("404")
  })
})

// ── ErrorBoundary (error.tsx) ─────────────────────────────────────────────

describe("ErrorComponent (ErrorBoundary) — accessibility", () => {
  const mockReset = vi.fn()

  beforeEach(() => {
    // Suppress the expected console.error from Error component
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("should have no accessibility violations with generic error", async () => {
    const error = new Error("Something went wrong")
    const { container } = render(
      <ErrorComponent error={error} reset={mockReset} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("should have no accessibility violations with not-found error", async () => {
    const error = new Error("Resource not found")
    const { container } = render(
      <ErrorComponent error={error} reset={mockReset} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("should have no accessibility violations with network error", async () => {
    const error = new Error("Network request failed")
    const { container } = render(
      <ErrorComponent error={error} reset={mockReset} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("should have no accessibility violations with error digest", async () => {
    const error = new Error("Database timeout")
    (error as any).digest = "abc123def456"
    const { container } = render(
      <ErrorComponent error={error} reset={mockReset} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renders correct heading for generic server error", () => {
    const { container } = render(
      <ErrorComponent
        error={new Error("Server error")}
        reset={mockReset}
      />,
    )
    const h1 = container.querySelector("h1")
    expect(h1).toBeInTheDocument()
    expect(h1?.textContent).toBe("Erro interno")
  })

  it("renders correct heading for not-found error", () => {
    const { container } = render(
      <ErrorComponent
        error={new Error("not found")}
        reset={mockReset}
      />,
    )
    const h1 = container.querySelector("h1")
    expect(h1).toBeInTheDocument()
    expect(h1?.textContent).toBe("Página não encontrada")
  })

  it("renders correct heading for network error", () => {
    const { container } = render(
      <ErrorComponent
        error={new Error("Network timeout")}
        reset={mockReset}
      />,
    )
    const h1 = container.querySelector("h1")
    expect(h1).toBeInTheDocument()
    expect(h1?.textContent).toBe("Erro de conexão")
  })

  it("has reset button with accessible text", () => {
    const { container } = render(
      <ErrorComponent
        error={new Error("Server error")}
        reset={mockReset}
      />,
    )
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(1)
    expect(buttons[0].textContent).toContain("Tentar novamente")
  })

  it("has home link with accessible text and correct href", () => {
    const { container } = render(
      <ErrorComponent
        error={new Error("Server error")}
        reset={mockReset}
      />,
    )
    const links = container.querySelectorAll("a")
    expect(links.length).toBe(1)
    expect(links[0].textContent).toContain("Voltar ao início")
    expect(links[0].getAttribute("href")).toBe("/")
  })

  it("shows error digest when available", () => {
    const error = new Error("Server error")
    (error as any).digest = "test-digest-123"
    const { container } = render(
      <ErrorComponent error={error} reset={mockReset} />,
    )
    expect(container.textContent).toContain("test-digest-123")
  })

  it("does not show digest section when digest is absent", () => {
    const { container } = render(
      <ErrorComponent
        error={new Error("Server error")}
        reset={mockReset}
      />,
    )
    expect(container.textContent).not.toContain("Ref:")
  })

  it("reset button schedules recovery on click", () => {
    vi.useFakeTimers()
    const { container } = render(
      <ErrorComponent
        error={new Error("Server error")}
        reset={mockReset}
      />,
    )
    const button = container.querySelector("button")
    expect(button).toBeInTheDocument()

    // Click the button - it sets isResetting=true and schedules reset()
    fireEvent.click(button!)

    // Button should show "Tentando…" text (isResetting = true)
    expect(button?.textContent).toContain("Tentando…")

    // Advance time past the 600ms timeout
    vi.advanceTimersByTime(600)
    expect(mockReset).toHaveBeenCalledTimes(1)

  })
})
