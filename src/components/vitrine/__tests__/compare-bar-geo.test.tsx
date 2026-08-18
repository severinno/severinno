/**
 * compare-bar-geo.test.tsx
 *
 * Tests CompareBar — the sticky bottom bar with provider chips resolved
 * from the DOM data-attributes set by ProviderCard.
 *
 * Coverage:
 *   ✅ Bar hidden when no providers selected
 *   ✅ Chip shows formatted distance (data-compare-distance)
 *   ✅ "+próx" badge on the closest provider (data-compare-distance-km)
 *   ✅ "+próx" hidden when all providers lack distance
 *   ✅ No distance chip when distance is "—"
 *   ✅ Remove button calls remove(id)
 *   ✅ Clear button calls clear()
 *   ✅ "Comparar" disabled with 1 selection, enabled with ≥2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@/__tests__/test-utils"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCn = vi.hoisted(() => vi.fn((...c: unknown[]) => c.filter(Boolean).join(" ")))

let compareState: {
  ids: string[]
  clear: () => void
  remove: (id: string) => void
  openCompare: () => void
} = {
  ids: [],
  clear: vi.fn(),
  remove: vi.fn(),
  openCompare: vi.fn(),
}

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@/store/compare", () => ({
  useCompareStore: (selector: (s: typeof compareState) => unknown) => selector(compareState),
  MAX_COMPARE: 3,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: unknown[]) => mockCn(...c),
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: (p: any) => <div {...p} />,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("lucide-react", () => {
  const makeIcon = (name: string) => {
    const C = () => <span data-testid={`icon-${name}`} />
    C.displayName = name
    return C
  }
  return {
    GitCompare: makeIcon("git-compare"),
    X: makeIcon("x"),
    Trash2: makeIcon("trash"),
    ArrowRight: makeIcon("arrow-right"),
    Navigation: makeIcon("navigation"),
  }
})

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, variant, size, disabled, ...rest }: any) => (
    <button
      onClick={onClick}
      className={className}
      data-variant={variant}
      data-size={size}
      disabled={disabled}
      data-testid="button"
      {...rest}
    >
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: any) => (
    <span className={className} data-testid="badge">
      {children}
    </span>
  ),
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: (p: any) => <img data-testid="avatar-image" src={p.src} alt={p.alt} />,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import CompareBar from "../compare-bar"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a fake ProviderCard node into the DOM so CompareBar can resolve
 * its data-attributes (name, avatar, distance). */
function seedCard(id: string, name: string, distanceKm?: number) {
  const el = document.createElement("div")
  el.setAttribute("data-provider-id", id)
  el.setAttribute("data-compare-name", name)
  el.setAttribute("data-compare-avatar", "")
  const distance = distanceKm
    ? distanceKm < 1
      ? `${Math.round(distanceKm * 1000)} m`
      : `${String(distanceKm).replace(".", ",")} km`
    : ""
  el.setAttribute("data-compare-distance", distance || "—")
  el.setAttribute("data-compare-distance-km", distanceKm != null ? String(distanceKm) : "")
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  vi.clearAllMocks()
  compareState = {
    ids: [],
    clear: vi.fn(),
    remove: vi.fn(),
    openCompare: vi.fn(),
  }
})

afterEach(() => {
  document.body.querySelectorAll("[data-provider-id]").forEach((el) => el.remove())
  cleanup()
})

// ===========================================================================
// Visibility
// ===========================================================================

describe("CompareBar — visibility", () => {
  it("renders nothing when no providers are selected", () => {
    compareState.ids = []
    const { container } = render(<CompareBar />)
    expect(container.innerHTML).toBe("")
  })

  it("renders the bar when at least one provider is selected", () => {
    compareState.ids = ["p1"]
    seedCard("p1", "Maria Silva", 1.2)
    render(<CompareBar />)
    expect(screen.getByText("Comparar prestadores")).toBeTruthy()
  })

  it("shows the selection counter", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva", 1.2)
    seedCard("p2", "João Santos", 8.7)
    render(<CompareBar />)
    expect(screen.getByText(/2 de 3 selecionado\(s\)/)).toBeTruthy()
  })

  it("hints to select one more when only one is selected", () => {
    compareState.ids = ["p1"]
    seedCard("p1", "Maria Silva", 1.2)
    render(<CompareBar />)
    expect(screen.getByText(/selecione mais 1/)).toBeTruthy()
  })
})

// ===========================================================================
// Geo: distance chips + "+próx" badge
// ===========================================================================

describe("CompareBar — distance and '+próx' badge", () => {
  it("shows the formatted distance on each chip", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva", 1.2)
    seedCard("p2", "João Santos", 8.7)
    render(<CompareBar />)

    expect(screen.getByText("· 1,2 km")).toBeTruthy()
    expect(screen.getByText("· 8,7 km")).toBeTruthy()
  })

  it("shows distance in meters for sub-kilometer providers", () => {
    compareState.ids = ["p1"]
    seedCard("p1", "Maria Silva", 0.42)
    render(<CompareBar />)

    expect(screen.getByText("· 420 m")).toBeTruthy()
  })

  it("marks the closest provider with the '+próx' badge", () => {
    compareState.ids = ["p1", "p2", "p3"]
    seedCard("p1", "Maria Silva", 1.2)
    seedCard("p2", "João Santos", 0.5)
    seedCard("p3", "Ana Costa", 35)
    render(<CompareBar />)

    const badges = screen.getAllByText("+próx")
    expect(badges.length).toBe(1)
  })

  it("ties (equal distances) both get the '+próx' badge", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva", 2.0)
    seedCard("p2", "João Santos", 2.0)
    render(<CompareBar />)

    const badges = screen.getAllByText("+próx")
    expect(badges.length).toBe(2)
  })

  it("does not show '+próx' when no provider has a valid distance", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva")
    seedCard("p2", "João Santos")
    render(<CompareBar />)

    expect(screen.queryByText("+próx")).toBeNull()
  })

  it("ignores providers without distance when computing the closest", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva", 5)
    seedCard("p2", "João Santos") // no distance
    render(<CompareBar />)

    // Only p1 has a valid distance → it is the closest
    expect(screen.getByText("+próx")).toBeTruthy()
  })

  it("does not render a distance chip when distance is '—'", () => {
    compareState.ids = ["p1"]
    seedCard("p1", "Maria Silva")
    render(<CompareBar />)

    expect(screen.queryByText(/· —/)).toBeNull()
  })

  it("falls back to 'Prestador' name when no DOM element is found", () => {
    compareState.ids = ["ghost-id"]
    render(<CompareBar />)

    expect(screen.getByText("Prestador")).toBeTruthy()
  })
})

// ===========================================================================
// Interactions
// ===========================================================================

describe("CompareBar — interactions", () => {
  it("removes a provider when its X is clicked", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva", 1.2)
    seedCard("p2", "João Santos", 8.7)
    render(<CompareBar />)

    const removeButtons = screen.getAllByLabelText(/Remover.*da comparação/)
    act(() => {
      removeButtons[0].click()
    })

    expect(compareState.remove).toHaveBeenCalledWith("p1")
  })

  it("clears the selection when Limpar is clicked", () => {
    compareState.ids = ["p1"]
    seedCard("p1", "Maria Silva", 1.2)
    render(<CompareBar />)

    const clearButton = screen.getByLabelText("Limpar seleção")
    act(() => {
      clearButton.click()
    })

    expect(compareState.clear).toHaveBeenCalled()
  })

  it("disables Comparar with a single selection", () => {
    compareState.ids = ["p1"]
    seedCard("p1", "Maria Silva", 1.2)
    render(<CompareBar />)

    const compareButton = screen.getByRole("button", { name: /Comparar/ })
    expect((compareButton as HTMLButtonElement).disabled).toBe(true)
  })

  it("enables Comparar with two selections and opens the modal", () => {
    compareState.ids = ["p1", "p2"]
    seedCard("p1", "Maria Silva", 1.2)
    seedCard("p2", "João Santos", 8.7)
    render(<CompareBar />)

    const compareButton = screen.getByRole("button", { name: /Comparar/ })
    expect((compareButton as HTMLButtonElement).disabled).toBe(false)

    act(() => {
      compareButton.click()
    })
    expect(compareState.openCompare).toHaveBeenCalled()
  })
})
