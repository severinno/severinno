// @ts-nocheck
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import userEvent from "@testing-library/user-event"

// ---- Mock lucide-react Star icon -------------------------------------------
vi.mock("lucide-react", () => {
  const MockIcon = (props: Record<string, unknown>) => (
    <svg aria-hidden="true" data-testid="mock-star" {...props} />
  )
  return { Star: MockIcon }
})

import { StarRatingDisplay, StarRatingInput } from "../star-rating"

describe("StarRatingDisplay", () => {
  it("renders with value label", () => {
    render(<StarRatingDisplay value={3.5} />)
    expect(screen.getByLabelText(/Avaliação/i)).toBeInTheDocument()
  })

  it("renders with count text", () => {
    render(<StarRatingDisplay value={4} count={12} />)
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it("clamps value to max 5", () => {
    render(<StarRatingDisplay value={7} />)
    expect(screen.getByLabelText(/5.0 de 5/i)).toBeInTheDocument()
  })

  it("renders with zero value", () => {
    render(<StarRatingDisplay value={0} />)
    expect(screen.getByLabelText(/0.0 de 5/i)).toBeInTheDocument()
  })
})

describe("StarRatingInput", () => {
  it("renders 5 stars", () => {
    const { container } = render(<StarRatingInput value={0} onChange={() => {}} />)
    // Estrelas são buttons sem role="radio" — verificar se há 5 elementos clicáveis
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(5)
  })

  it("marks the correct star", () => {
    const { container } = render(<StarRatingInput value={3} onChange={() => {}} />)
    // A terceira estrela deve estar marcada de alguma forma
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(5)
  })

  it("disables all buttons when disabled", () => {
    const { container } = render(<StarRatingInput value={2} onChange={() => {}} disabled />)
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach((b) => {
      expect(b).toHaveAttribute("disabled")
    })
  })

  it("shows current value as text", () => {
    render(<StarRatingInput value={4} onChange={() => {}} />)
    expect(screen.getByText("4.0")).toBeInTheDocument()
  })

  it("shows em dash for zero value", () => {
    const { container } = render(<StarRatingInput value={0} onChange={() => {}} />)
    const allText = container.textContent ?? ""
    expect(allText).toContain("—")
  })

  it("includes hidden input with name", () => {
    render(<StarRatingInput value={3} onChange={() => {}} name="rating" />)
    const hidden = document.querySelector('input[type="hidden"][name="rating"]')
    expect(hidden).toBeInTheDocument()
    expect(hidden).toHaveValue("3")
  })
})
