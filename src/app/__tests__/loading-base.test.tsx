import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { shimmerCSS, ShimmerStyle, S, createContainer, createItem } from "../loading-base"

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

// ── createContainer ───────────────────────────────────────────────────────

describe("createContainer", () => {
  it("returns a Variants object with hidden and show states", () => {
    const variants = createContainer()
    expect(variants).toHaveProperty("hidden")
    expect(variants).toHaveProperty("show")
  })

  it("hidden state has opacity 0", () => {
    expect(createContainer().hidden).toEqual({ opacity: 0 })
  })

  it("show state has opacity 1 with stagger transition", () => {
    const show = createContainer().show
    expect(show).toHaveProperty("opacity", 1)
    expect(show).toHaveProperty("transition")
  })

  it("uses default stagger of 0.06", () => {
    const show = createContainer().show as { transition: { staggerChildren: number } }
    expect(show.transition.staggerChildren).toBe(0.06)
  })

  it("accepts custom stagger value", () => {
    const show = createContainer(0.1).show as { transition: { staggerChildren: number } }
    expect(show.transition.staggerChildren).toBe(0.1)
  })

  it("accepts zero stagger", () => {
    const show = createContainer(0).show as { transition: { staggerChildren: number } }
    expect(show.transition.staggerChildren).toBe(0)
  })
})

// ── createItem ────────────────────────────────────────────────────────────

describe("createItem", () => {
  it("returns a Variants object with hidden and show states", () => {
    const variants = createItem()
    expect(variants).toHaveProperty("hidden")
    expect(variants).toHaveProperty("show")
  })

  it("hidden state has opacity 0 and default y offset", () => {
    expect(createItem().hidden).toEqual({ opacity: 0, y: 12 })
  })

  it("show state has opacity 1 and y 0 with transition", () => {
    const show = createItem().show
    expect(show).toHaveProperty("opacity", 1)
    expect(show).toHaveProperty("y", 0)
    expect(show).toHaveProperty("transition")
  })

  it("uses default duration of 0.35 and easeOut", () => {
    const show = createItem().show as { transition: { duration: number; ease: string } }
    expect(show.transition.duration).toBe(0.35)
    expect(show.transition.ease).toBe("easeOut")
  })

  it("accepts custom y offset", () => {
    expect(createItem(24).hidden).toEqual({ opacity: 0, y: 24 })
  })

  it("accepts custom duration", () => {
    const show = createItem(12, 0.5).show as { transition: { duration: number } }
    expect(show.transition.duration).toBe(0.5)
  })

  it("accepts y=0 for no slide", () => {
    expect(createItem(0).hidden).toEqual({ opacity: 0, y: 0 })
  })
})
