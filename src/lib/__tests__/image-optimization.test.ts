import { describe, it, expect } from "vitest"
import {
  calculateThumbnailSize,
  getOptimalImageFormat,
  generateShimmerSvg,
  generateLqipDataUrl,
} from "../image-optimization"

describe("Image Optimization Utilities (src/lib/image-optimization.ts)", () => {
  it("calculates proportional thumbnail sizes", () => {
    // 1200x800 -> avatar (max 150x150)
    const avatar = calculateThumbnailSize(1200, 800, "avatar")
    expect(avatar.width).toBe(150)
    expect(avatar.height).toBe(100)

    // 800x1200 -> card (max 600x450)
    const card = calculateThumbnailSize(800, 1200, "card")
    expect(card.height).toBe(450)
    expect(card.width).toBe(300)

    // Edge case: invalid dimensions returns default constraints
    const invalid = calculateThumbnailSize(0, 0, "thumb")
    expect(invalid.width).toBe(300)
    expect(invalid.height).toBe(300)
  })

  it("detects optimal image format from Accept header", () => {
    expect(getOptimalImageFormat("text/html,image/avif,image/webp,*/*")).toBe("image/avif")
    expect(getOptimalImageFormat("text/html,image/webp,*/*")).toBe("image/webp")
    expect(getOptimalImageFormat("image/jpeg,image/png")).toBe("image/jpeg")
    expect(getOptimalImageFormat(null)).toBe("image/webp")
  })

  it("generates valid SVG data-URIs for shimmer and LQIP", () => {
    const shimmer = generateShimmerSvg(400, 300)
    expect(shimmer).toMatch(/^data:image\/svg\+xml;base64,/)

    const lqip = generateLqipDataUrl(20, 20, "#3b82f6")
    expect(lqip).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})
