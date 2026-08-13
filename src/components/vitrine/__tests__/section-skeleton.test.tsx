// @ts-nocheck
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { axe } from "vitest-axe"
import fs from "node:fs"
import path from "node:path"
import * as React from "react"

import { SectionSkeleton } from "../section-skeleton"

/**
 * section-skeleton.test.tsx
 *
 * Two contracts:
 *   1. SectionSkeleton renders a role="status" live region with sr-only text
 *      and decorative pulse blocks, for all 5 shape variants.
 *   2. Shape guard (house style): EVERY next/dynamic call in vitrine.tsx has
 *      a loading fallback - so the null flash during SPA view switches can
 *      never regress. A new dynamic section without a fallback fails here
 *      with the count mismatch named.
 */

// ============================================================================
// SectionSkeleton rendering
// ============================================================================

describe("SectionSkeleton", () => {
  it("renders the section variant (default) with a status live region, sr-only text and pulse blocks", () => {
    const { container } = render(<SectionSkeleton />)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector(".sr-only")?.textContent).toBe(
      "Carregando conteúdo",
    )
    // heading bar + 3 grid blocks (plus sr-only)
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4)
  })

  it.each(["bar", "pill", "widget", "banner"] as const)(
    "renders the %s variant as a fixed slot with status + pulse block",
    (variant) => {
      const { container } = render(<SectionSkeleton variant={variant} />)
      expect(container.querySelector('[role="status"]')).not.toBeNull()
      expect(container.querySelector(".sr-only")?.textContent).toBe(
        "Carregando conteúdo",
      )
      const fixed = container.querySelector(".fixed")
      expect(fixed).not.toBeNull()
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(1)
    },
  )

  it("has no axe violations (section variant)", async () => {
    const { container } = render(<SectionSkeleton />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ============================================================================
// Shape guard - every vitrine dynamic has a loading fallback
// ============================================================================

describe("vitrine dynamic sections - loading fallback contract", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/components/vitrine/vitrine.tsx"),
    "utf8",
  )

  it("every next/dynamic call has a loading fallback (no null flash)", () => {
    const dynamics = (src.match(/dynamic\(\s*\(\s*\)\s*=>\s*import\(/g) ?? [])
      .length
    const loadings = (src.match(/loading:/g) ?? []).length
    expect(dynamics).toBe(16)
    expect(loadings).toBe(dynamics)
  })

  it("CompareModal uses an explicit null fallback (closed modal is invisible)", () => {
    // The declaration spans multiple lines - slice from the CompareModal
    // declaration to the next one and assert the block carries the null fallback.
    const start = src.indexOf("const CompareModal = dynamic(")
    const end = src.indexOf("const BackToTop = dynamic(")
    const block = src.slice(start, end)
    expect(block).toContain("loading: () => null")
  })
})
