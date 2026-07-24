import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProviderCardSkeleton } from "../provider-card"

describe("ProviderCardSkeleton", () => {
  it("renders without crashing", () => {
    const { container } = render(<ProviderCardSkeleton />)
    expect(container).toBeInTheDocument()
  })

  it("renders multiple skeleton elements (pulse animations)", () => {
    const { container } = render(<ProviderCardSkeleton />)
    const animatedElements = container.querySelectorAll(".animate-pulse")
    expect(animatedElements.length).toBeGreaterThanOrEqual(3)
  })

  it("renders inside a Card with rounded corners", () => {
    const { container } = render(<ProviderCardSkeleton />)
    const card = container.querySelector("[class*='rounded-xl']")
    expect(card).toBeInTheDocument()
  })
})
