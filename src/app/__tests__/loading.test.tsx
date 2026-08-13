/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from "vitest"
import { render, within, cleanup } from "@/__tests__/test-utils"
import Loading from "../loading"

afterEach(cleanup)

describe("Root Loading (home page skeleton)", () => {
  it("renders shimmer style tag within component", () => {
    const { container } = render(<Loading />)
    const style = container.querySelector("style")
    expect(style).toBeInTheDocument()
    expect(style?.textContent).toContain("@keyframes shimmer")
  })

  it("renders shimmer divs throughout the page", () => {
    const { container } = render(<Loading />)
    const shimmers = container.querySelectorAll(".shimmer")
    expect(shimmers.length).toBeGreaterThan(10)
  })

  it("renders hero section with search bar", () => {
    const { container } = render(<Loading />)
    // Search bar: h-14 w-full rounded-xl — use attribute selector for class containment
    const searchBar = container.querySelector(
      '[class*="h-14"][class*="w-full"][class*="rounded-xl"]',
    )
    expect(searchBar).toBeInTheDocument()
  })

  it("renders hero section with title shimmers", () => {
    const { container } = render(<Loading />)
    // Title shimmers have h-9 class
    const titleShimmers = container.querySelectorAll('[class*="h-9"]')
    expect(titleShimmers.length).toBeGreaterThanOrEqual(1)
  })

  it("renders category showcase section with grid", () => {
    const { container } = render(<Loading />)
    // Category grid: lg:grid-cols-6 — use attribute selector
    const grid = container.querySelector('[class*="lg:grid-cols-6"]')
    expect(grid).toBeInTheDocument()
  })

  it("renders how it works section with steps", () => {
    const { container } = render(<Loading />)
    // Look for the HowItWorks container which has items with size-14 (icon placeholder)
    const iconShimmers = container.querySelectorAll('[class*="size-14"]')
    expect(iconShimmers.length).toBeGreaterThanOrEqual(3)
  })

  it("renders testimonials section with stars", () => {
    const { container } = render(<Loading />)
    // Testimonial star icons: size-4
    const starShimmers = container.querySelectorAll('[class*="size-4"]')
    // At least the 5 stars from one testimonial card
    expect(starShimmers.length).toBeGreaterThanOrEqual(5)
  })

  it("renders FAQ section with items", () => {
    const { container } = render(<Loading />)
    // FAQ items have space-y-3
    const faqContainer = container.querySelector('[class*="space-y-3"]')
    expect(faqContainer).toBeInTheDocument()
  })

  it("renders CTA banner section", () => {
    const { container } = render(<Loading />)
    // CTA has rounded-2xl background
    const cta = container.querySelector('[class*="rounded-2xl"]')
    expect(cta).toBeInTheDocument()
  })

  it("renders footer section", () => {
    const { container } = render(<Loading />)
    const footers = container.querySelectorAll("footer")
    expect(footers.length).toBeGreaterThanOrEqual(1)
  })

  it("renders social proof ticker section", () => {
    const { container } = render(<Loading />)
    // Social proof section: emerald gradient bg
    const tickerSection = container.querySelector('[class*="from-emerald-50"]')
    expect(tickerSection).toBeInTheDocument()
  })

  it("renders recently viewed providers section", () => {
    const { container } = render(<Loading />)
    // Recently viewed: border-slate-200
    const recentCard = container.querySelector('[class*="border-slate-200"]')
    expect(recentCard).toBeInTheDocument()
  })

  it("renders partners trust section with aria-label", () => {
    const { container } = render(<Loading />)
    const partnersSection = container.querySelector('[aria-label="Parceiros e imprensa"]')
    expect(partnersSection).toBeInTheDocument()
  })

  it("renders decorative blobs in hero section", () => {
    const { container } = render(<Loading />)
    const blurDivs = container.querySelectorAll('[class*="blur-3xl"]')
    expect(blurDivs.length).toBeGreaterThanOrEqual(2)
  })

  it("renders topbar with logo and navigation links", () => {
    const { container } = render(<Loading />)
    // Logo shimmer: h-7 w-28
    const logo = container.querySelector('[class*="h-7"][class*="w-28"]')
    expect(logo).toBeInTheDocument()
  })
})
