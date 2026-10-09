/**
 * Severinno Marketplace SaaS — Edge Image Optimization & LQIP Engine
 *
 * Provides utilities for responsive image sizing, modern format selection
 * (AVIF / WebP / JPEG), and lightweight SVG shimmer data-URIs for
 * zero-CLS (Cumulative Layout Shift) image loading in Next.js.
 */

export type ThumbnailTarget = "avatar" | "thumb" | "card" | "hero"

export interface ThumbnailDimensions {
  width: number
  height: number
}

const TARGET_CONSTRAINTS: Record<ThumbnailTarget, { maxWidth: number; maxHeight: number }> = {
  avatar: { maxWidth: 150, maxHeight: 150 },
  thumb: { maxWidth: 300, maxHeight: 300 },
  card: { maxWidth: 600, maxHeight: 450 },
  hero: { maxWidth: 1200, maxHeight: 800 },
}

/**
 * Calculates proportional thumbnail dimensions fitting within target bounds.
 */
export function calculateThumbnailSize(
  origWidth: number,
  origHeight: number,
  target: ThumbnailTarget = "card",
): ThumbnailDimensions {
  if (origWidth <= 0 || origHeight <= 0) {
    const defaultConstraints = TARGET_CONSTRAINTS[target]
    return { width: defaultConstraints.maxWidth, height: defaultConstraints.maxHeight }
  }

  const { maxWidth, maxHeight } = TARGET_CONSTRAINTS[target]
  const ratio = Math.min(maxWidth / origWidth, maxHeight / origHeight, 1)

  return {
    width: Math.max(1, Math.round(origWidth * ratio)),
    height: Math.max(1, Math.round(origHeight * ratio)),
  }
}

/**
 * Determines optimal image format based on HTTP Accept header.
 */
export function getOptimalImageFormat(
  acceptHeader?: string | null,
): "image/avif" | "image/webp" | "image/jpeg" {
  if (!acceptHeader) return "image/webp"

  if (acceptHeader.includes("image/avif")) {
    return "image/avif"
  }
  if (acceptHeader.includes("image/webp")) {
    return "image/webp"
  }
  return "image/jpeg"
}

/**
 * Generates an animated SVG shimmer data-URI for smooth, zero-CLS image loading.
 */
export function generateShimmerSvg(width = 700, height = 475): string {
  const svg = `
<svg width="${width}" height="${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="g">
      <stop stop-color="#f3f4f6" offset="20%" />
      <stop stop-color="#e5e7eb" offset="50%" />
      <stop stop-color="#f3f4f6" offset="70%" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#f3f4f6" />
  <rect id="r" width="${width}" height="${height}" fill="url(#g)" />
  <animate xlink:href="#r" attributeName="x" from="-${width}" to="${width}" dur="1.2s" repeatCount="indefinite"  />
</svg>`.trim()

  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg).toString("base64")
      : typeof btoa !== "undefined"
        ? btoa(svg)
        : ""

  return `data:image/svg+xml;base64,${base64}`
}

/**
 * Generates a minimal monochrome SVG placeholder data-URI.
 */
export function generateLqipDataUrl(width = 10, height = 10, fillColor = "#e5e7eb"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fillColor}"/></svg>`
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg).toString("base64")
      : typeof btoa !== "undefined"
        ? btoa(svg)
        : ""

  return `data:image/svg+xml;base64,${base64}`
}
