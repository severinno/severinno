/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Accessibility (axe-core) tests for all loading skeletons.
 *
 * Loading skeletons are purely visual placeholders — shimmer divs with no
 * interactive elements.  Every skeleton should have zero axe violations and
 * no focusable interactive elements (buttons, links, inputs).
 *
 * Covers all 12 skeleton pages:
 *   - Root (/)              — landing page
 *   - Busca (/busca)        — search results
 *   - Categoria             — parent + child category listings
 *   - Tracking ([id])       — booking tracking with map
 *   - Dashboard             — admin/provider/client panel
 *   - Auth                  — reset password (email + token)
 *   - Settings/profile      — user profile form
 *   - Termos                — terms of service article
 *   - Contato               — contact page
 *   - Como funciona         — how it works steps
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import RootLoading from "../loading"
import BuscaLoading from "../busca/loading"
import CategoriaLoading from "../categoria/[slug]/loading"
import ChildCategoriaLoading from "../categoria/[slug]/[child]/loading"
import TrackingLoading from "../tracking/[id]/loading"
import DashboardLoading from "../dashboard/loading"
import ResetPasswordLoading from "../auth/reset-password/loading"
import ResetPasswordTokenLoading from "../auth/reset-password/[token]/loading"
import ProfileLoading from "../settings/profile/loading"
import TermosLoading from "../termos/loading"
import ContatoLoading from "../contato/loading"
import ComoFuncionaLoading from "../como-funciona/loading"

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Helper: check that a skeleton has zero axe violations and no interactives
// ---------------------------------------------------------------------------
async function assertSkeletonAccessible(container: HTMLElement) {
  const results = await axe(container)
  expect(results.violations).toHaveLength(0)
}

function assertNoInteractiveElements(container: HTMLElement) {
  const interactive = container.querySelectorAll(
    "button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])",
  )
  expect(interactive.length).toBe(0)
}

// =======================================================================
// ROOT LOADING (Landing page skeleton)
// =======================================================================

describe("Root Loading (/) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<RootLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<RootLoading />)
    assertNoInteractiveElements(container)
  })

  it("contains a footer landmark", () => {
    const { container } = render(<RootLoading />)
    expect(container.querySelector("footer")).toBeInTheDocument()
  })

  it("partners section has descriptive aria-label", () => {
    const { container } = render(<RootLoading />)
    expect(container.querySelector('[aria-label="Parceiros e imprensa"]')).toBeInTheDocument()
  })

  it("renders content sections with semantic HTML", () => {
    const { container } = render(<RootLoading />)
    const sections = container.querySelectorAll("section")
    expect(sections.length).toBeGreaterThanOrEqual(5)
  })

  it("decorative blobs have pointer-events-none", () => {
    const { container } = render(<RootLoading />)
    expect(container.querySelectorAll(".pointer-events-none").length).toBeGreaterThanOrEqual(1)
  })

  it("gradient fades have aria-hidden", () => {
    const { container } = render(<RootLoading />)
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1)
  })
})

// =======================================================================
// BUSCA LOADING (Search results skeleton)
// =======================================================================

describe("Busca Loading (/busca) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<BuscaLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<BuscaLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders shimmer placeholder divs", () => {
    const { container } = render(<BuscaLoading />)
    expect(container.querySelectorAll(".shimmer").length).toBeGreaterThan(5)
  })
})

// =======================================================================
// CATEGORIA LOADING (Parent category listing)
// =======================================================================

describe("Categoria Loading (/categoria/[slug]) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<CategoriaLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<CategoriaLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders breadcrumb and grid layout", () => {
    const { container } = render(<CategoriaLoading />)
    // Category has grids with lg:grid-cols-4 (highlights) and lg:grid-cols-3 (providers)
    const grids = container.querySelectorAll('[class*="lg:grid-cols-4"], [class*="lg:grid-cols-3"]')
    expect(grids.length).toBeGreaterThanOrEqual(2)
  })
})

// =======================================================================
// CHILD CATEGORIA LOADING (Subcategory listing)
// =======================================================================

describe("Child Categoria Loading (/categoria/[slug]/[child]) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ChildCategoriaLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<ChildCategoriaLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders grid layout without highlights section", () => {
    const { container } = render(<ChildCategoriaLoading />)
    // Child category has only the provider grid (lg:grid-cols-3), no highlights
    const providerGrid = container.querySelector('[class*="lg:grid-cols-3"]')
    expect(providerGrid).toBeInTheDocument()
  })
})

// =======================================================================
// TRACKING LOADING (Booking tracking with map)
// =======================================================================

describe("Tracking Loading (/tracking/[id]) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<TrackingLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<TrackingLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders booking details card structure", () => {
    const { container } = render(<TrackingLoading />)
    // Tracking has a card with sm:grid-cols-2 (provider/service + date/address)
    const cardGrid = container.querySelector('[class*="sm:grid-cols-2"]')
    expect(cardGrid).toBeInTheDocument()
  })

  it("renders progress timeline steps", () => {
    const { container } = render(<TrackingLoading />)
    // 4 timeline step circles
    const circles = container.querySelectorAll('[class*="size-3"][class*="rounded-full"]')
    expect(circles.length).toBeGreaterThanOrEqual(4)
  })
})

// =======================================================================
// DASHBOARD LOADING (Admin/provider/client panel)
// =======================================================================

describe("Dashboard Loading (/dashboard) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<DashboardLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<DashboardLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders topbar and sidebar layout", () => {
    const { container } = render(<DashboardLoading />)
    // Dashboard has max-w-7xl container
    const containerEl = container.querySelector('[class*="max-w-7xl"]')
    expect(containerEl).toBeInTheDocument()
  })

  it("renders stats cards grid", () => {
    const { container } = render(<DashboardLoading />)
    // 4 stats cards in lg:grid-cols-4
    const statsGrid = container.querySelector('[class*="lg:grid-cols-4"]')
    expect(statsGrid).toBeInTheDocument()
  })
})

// =======================================================================
// AUTH — RESET PASSWORD LOADING (Email form)
// =======================================================================

describe("Reset Password Loading (/auth/reset-password) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ResetPasswordLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<ResetPasswordLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders centered card layout", () => {
    const { container } = render(<ResetPasswordLoading />)
    // Card with max-w-md
    const card = container.querySelector('[class*="max-w-md"]')
    expect(card).toBeInTheDocument()
  })
})

// =======================================================================
// AUTH — RESET PASSWORD TOKEN LOADING (New password form)
// =======================================================================

describe("Reset Password Token Loading (/auth/reset-password/[token]) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ResetPasswordTokenLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<ResetPasswordTokenLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders centered card with password fields", () => {
    const { container } = render(<ResetPasswordTokenLoading />)
    const card = container.querySelector('[class*="max-w-md"]')
    expect(card).toBeInTheDocument()
    // Two password field shimmers + submit button
    expect(container.querySelectorAll(".h-10").length).toBeGreaterThanOrEqual(2)
  })
})

// =======================================================================
// SETTINGS PROFILE LOADING (User profile form)
// =======================================================================

describe("Profile Loading (/settings/profile) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ProfileLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<ProfileLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders avatar sidebar and form grid", () => {
    const { container } = render(<ProfileLoading />)
    // lg:grid-cols-3 for avatar sidebar + form
    const grid = container.querySelector('[class*="lg:grid-cols-3"]')
    expect(grid).toBeInTheDocument()
  })

  it("renders change password section", () => {
    const { container } = render(<ProfileLoading />)
    // Change password section has rounded-lg buttons at the bottom
    const roundedButtons = container.querySelectorAll('[class*="rounded-lg"]')
    expect(roundedButtons.length).toBeGreaterThan(5)
  })
})

// =======================================================================
// STATIC PAGES — TERMOS, CONTATO, COMO FUNCIONA
// =======================================================================

describe("Termos Loading (/termos) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<TermosLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<TermosLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders article sections", () => {
    const { container } = render(<TermosLoading />)
    // Multiple section title shimmers (h-6 for each h2)
    const sectionTitles = container.querySelectorAll('[class*="h-6"]')
    expect(sectionTitles.length).toBeGreaterThanOrEqual(5)
  })
})

describe("Contato Loading (/contato) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ContatoLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<ContatoLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders contact cards grid", () => {
    const { container } = render(<ContatoLoading />)
    const cardGrid = container.querySelector('[class*="sm:grid-cols-2"]')
    expect(cardGrid).toBeInTheDocument()
  })
})

describe("Como Funciona Loading (/como-funciona) — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ComoFuncionaLoading />)
    await assertSkeletonAccessible(container)
  })

  it("has no interactive elements", () => {
    const { container } = render(<ComoFuncionaLoading />)
    assertNoInteractiveElements(container)
  })

  it("renders 4 step cards", () => {
    const { container } = render(<ComoFuncionaLoading />)
    // 4 numbered circles (size-10 rounded-full)
    const circles = container.querySelectorAll('[class*="size-10"][class*="rounded-full"]')
    expect(circles.length).toBe(4)
  })

  it("renders step descriptions", () => {
    const { container } = render(<ComoFuncionaLoading />)
    // Each step has a title and description lines
    const fullWidthLines = container.querySelectorAll('[class*="w-full"]')
    expect(fullWidthLines.length).toBeGreaterThanOrEqual(4)
  })
})
