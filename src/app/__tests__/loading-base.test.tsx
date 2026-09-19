import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { shimmerCSS, ShimmerStyle, S, staggerDelay } from "../loading-base"

afterEach(cleanup)

// ── shimmerCSS ────────────────────────────────────────────────────────────

describe("shimmerCSS", () => {
  it("contains shimmer keyframe definition", () => {
    expect(shimmerCSS).toContain("@keyframes shimmer")
  })

  it("contains fadeSlideUp keyframe definition", () => {
    expect(shimmerCSS).toContain("@keyframes fadeSlideUp")
  })

  it("contains fadeIn keyframe definition", () => {
    expect(shimmerCSS).toContain("@keyframes fadeIn")
  })

  it("contains shimmer class definition", () => {
    expect(shimmerCSS).toContain(".shimmer")
  })

  it("contains background-size for shimmer animation", () => {
    expect(shimmerCSS).toContain("background-size: 200% 100%")
  })

  it("contains fadeSlideUp translateY(12px)", () => {
    expect(shimmerCSS).toContain("translateY(12px)")
  })
})

// ── ShimmerStyle ──────────────────────────────────────────────────────────

describe("ShimmerStyle", () => {
  it("renders a style element", () => {
    const { container } = render(<ShimmerStyle />)
    expect(container.querySelector("style")).toBeInTheDocument()
  })

  it("injects shimmerCSS as text content", () => {
    const { container } = render(<ShimmerStyle />)
    const style = container.querySelector("style")
    expect(style?.textContent).toContain("@keyframes shimmer")
    expect(style?.textContent).toContain("@keyframes fadeSlideUp")
  })
})

// ── S (shimmer div) ───────────────────────────────────────────────────────

describe("S", () => {
  it("renders a div", () => {
    const { container } = render(<S />)
    expect(container.querySelector("div")).toBeInTheDocument()
  })

  it("has shimmer CSS class", () => {
    const { container } = render(<S />)
    expect(container.querySelector("div")?.className).toContain("shimmer")
  })

  it("has rounded CSS class", () => {
    const { container } = render(<S />)
    expect(container.querySelector("div")?.className).toContain("rounded")
  })

  it("applies custom className", () => {
    const { container } = render(<S className="h-8 w-48" />)
    expect(container.querySelector("div")?.className).toContain("h-8")
    expect(container.querySelector("div")?.className).toContain("w-48")
  })

  it("merges default shimmer with custom className", () => {
    const { container } = render(<S className="custom-class" />)
    const cn = container.querySelector("div")?.className ?? ""
    expect(cn).toContain("shimmer")
    expect(cn).toContain("rounded")
    expect(cn).toContain("custom-class")
  })

  it("renders without className prop", () => {
    const { container } = render(<S />)
    const cn = container.querySelector("div")?.className ?? ""
    expect(cn).toContain("shimmer")
    expect(cn).toContain("rounded")
  })
})

// ── staggerDelay ──────────────────────────────────────────────────────────

describe("staggerDelay", () => {
  it("returns animation-delay style for index 0", () => {
    const style = staggerDelay(0)
    expect(style).toHaveProperty("animationDelay", "0s")
  })

  it("returns animation-delay style for index 1", () => {
    const style = staggerDelay(1)
    expect(style).toHaveProperty("animationDelay", "0.06s")
  })

  it("uses default stagger of 0.06", () => {
    const style = staggerDelay(2)
    expect(style).toHaveProperty("animationDelay", "0.12s")
  })

  it("accepts custom stagger value", () => {
    const style = staggerDelay(1, 0.1)
    expect(style).toHaveProperty("animationDelay", "0.1s")
  })

  it("accepts zero stagger", () => {
    const style = staggerDelay(5, 0)
    expect(style).toHaveProperty("animationDelay", "0s")
  })
})
