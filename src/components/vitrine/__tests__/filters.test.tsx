/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Tests for Filters — vitrine sidebar filters.
 *
 * Coverage:
 *   ✅ "Mais próximos" disabled when hasGeo=false
 *   ✅ "Mais próximos" enabled when hasGeo=true
 *   ✅ Sort changes when clicking enabled sort option
 *   ✅ Calls onRequestGeo when clicking disabled "Mais próximos"
 *   ✅ aria-checked reflects active sort
 *   ✅ Cursor-not-allowed class when disabled
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@/__tests__/test-utils"
import type { Category } from "@/lib/api"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockCn = vi.hoisted(() => vi.fn((...c: any[]) => c.filter(Boolean).join(" ")))

const mockCategories: Category[] = [
  { id: "cat1", name: "Construção", slug: "construcao", level: 0, children: [] },
  { id: "cat2", name: "Limpeza", slug: "limpeza", level: 0, children: [] },
]

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => mockUseQuery(opts),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/lib/api", () => ({
  fetchCategories: vi.fn(),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => mockCn(...c),
}))

vi.mock("lucide-react", () => {
  const Icon = ({ className, ...rest }: any) => (
    <span data-testid="icon" className={className} {...rest} />
  )
  Icon.displayName = "Icon"
  return {
    Search: Icon,
    SlidersHorizontal: Icon,
    Star: Icon,
    X: Icon,
  }
})

// ---------------------------------------------------------------------------
// Mock shadcn/ui components
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} data-testid="button">
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, className }: any) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}))

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, id }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      id={id}
      data-testid="switch"
    />
  ),
}))

vi.mock("@/components/ui/slider", () => ({
  Slider: ({ value, onValueChange, min, max, step, "aria-label": ariaLabel }: any) => (
    <div data-testid="slider" data-value={value?.[0]}>
      <button
        onClick={() => onValueChange?.([Math.min(max, (value?.[0] ?? 0) + 10)])}
        data-testid="slider-up"
      >
        +
      </button>
    </div>
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div data-testid="select">{children}</div>,
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, className }: any) => (
    <button className={className} data-testid="select-trigger">
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}))

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, value, onValueChange }: any) => (
    <div data-testid="radio-group" data-value={value}>
      {children}
    </div>
  ),
  RadioGroupItem: ({ value, id, className }: any) => (
    <input type="radio" value={value} id={id} className={className} data-testid="radio-item" />
  ),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import Filters, { DEFAULT_FILTERS, type FiltersState } from "../filters"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProps(
  overrides?: Partial<{
    value: FiltersState
    onChange: ReturnType<typeof vi.fn>
    categories: Category[]
    hasGeo: boolean
    onRequestGeo: ReturnType<typeof vi.fn>
  }>,
): {
  value: FiltersState
  onChange: ReturnType<typeof vi.fn>
  categories: Category[]
  hasGeo: boolean
  onRequestGeo: ReturnType<typeof vi.fn>
} {
  return {
    value: { ...DEFAULT_FILTERS },
    onChange: vi.fn(),
    categories: mockCategories,
    hasGeo: false,
    onRequestGeo: vi.fn(),
    ...overrides,
  }
}

/** Find the sort radio button by its label text. */
function getSortButton(label: "Melhor avaliação" | "Mais próximos"): HTMLElement {
  const buttons = screen.getAllByRole("radio")
  return buttons.find((b) => b.textContent === label)!
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: categories query returns mockCategories
  mockUseQuery.mockReturnValue({ data: mockCategories, isLoading: false })
})

// ===========================================================================
// Tests — "Mais próximos" disabled state
// ===========================================================================

describe("Filters — 'Mais próximos' disabled state", () => {
  it("is disabled when hasGeo=false", () => {
    const props = createProps({ hasGeo: false })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    expect(btn.getAttribute("aria-checked")).toBe("false")
    expect(btn.getAttribute("aria-disabled")).toBe("true")
    expect(btn.className).toContain("cursor-not-allowed")
  })

  it("is enabled when hasGeo=true", () => {
    const props = createProps({ hasGeo: true })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    // Enabled buttons don't have cursor-not-allowed
    expect(btn.className).not.toContain("cursor-not-allowed")
  })

  it("has aria-checked=true when sort=distance and hasGeo=true", () => {
    const props = createProps({
      hasGeo: true,
      value: { ...DEFAULT_FILTERS, sort: "distance" },
    })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    expect(btn.getAttribute("aria-checked")).toBe("true")
  })

  it("has aria-checked=false when sort=rating even with hasGeo=true", () => {
    const props = createProps({
      hasGeo: true,
      value: { ...DEFAULT_FILTERS, sort: "rating" },
    })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    expect(btn.getAttribute("aria-checked")).toBe("false")
  })
})

// ===========================================================================
// Tests — Interaction
// ===========================================================================

describe("Filters — 'Mais próximos' interaction", () => {
  it("calls onRequestGeo when clicking disabled button", () => {
    const onRequestGeo = vi.fn()
    const props = createProps({ hasGeo: false, onRequestGeo })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    act(() => {
      btn.click()
    })

    expect(onRequestGeo).toHaveBeenCalledTimes(1)
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it("calls onChange with sort=distance when clicking enabled button", () => {
    const onChange = vi.fn()
    const props = createProps({ hasGeo: true, onChange })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    act(() => {
      btn.click()
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort: "distance" }))
  })

  it("calls onChange with sort=rating when clicking Melhor avaliação", () => {
    const onChange = vi.fn()
    const props = createProps({
      hasGeo: true,
      value: { ...DEFAULT_FILTERS, sort: "distance" },
      onChange,
    })
    render(<Filters {...props} />)

    const btn = getSortButton("Melhor avaliação")
    act(() => {
      btn.click()
    })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort: "rating" }))
  })
})

// ===========================================================================
// Tests — Title attribute
// ===========================================================================

describe("Filters — 'Mais próximos' title", () => {
  it("shows GPS hint as title when disabled", () => {
    const props = createProps({ hasGeo: false })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    expect(btn.getAttribute("title")).toBe("Compartilhe sua localização para ordenar por distância")
  })

  it("has no title when enabled", () => {
    const props = createProps({ hasGeo: true })
    render(<Filters {...props} />)

    const btn = getSortButton("Mais próximos")
    expect(btn.hasAttribute("title")).toBe(false)
  })
})
