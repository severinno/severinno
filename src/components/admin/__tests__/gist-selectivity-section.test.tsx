/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * gist-selectivity-section.test.tsx
 *
 * Snapshot tests for the GiSTSelectivitySection component.
 *
 * Mocks Recharts at the module level to render testable placeholder elements
 * instead of actual SVG, since JSDOM doesn't support SVG measurement APIs.
 *
 * The test verifies that:
 *   - Selectivity tables render with correct values
 *   - Crossover table renders when data exists
 *   - Measured vs Model table renders with delta coloring
 *   - Analysis/Interpretation card renders
 *   - GiST degradation alert renders when P95 exceeds all model curves
 *   - Radius selector renders with presets
 *   - Cost-at-selectivity cards render with regime indicators
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { GiSTSelectivitySection } from "../gist-selectivity-section"

// ===========================================================================
// Mock Recharts — JSDOM does not support SVG measurement, so we render
// placeholder elements instead and verify structure / text content.
// ===========================================================================

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  XAxis: (p: any) => <div data-testid="xaxis" data-datakey={p.dataKey} />,
  YAxis: () => <div data-testid="yaxis" />,
  Tooltip: () => <div data-testid="recharts-tooltip" />,
  Legend: () => <div data-testid="legend" />,
  Line: (p: any) => (
    <div
      data-testid="chart-line"
      data-datakey={p.dataKey}
      data-name={p.name}
      data-stroke={p.stroke}
      data-strokewidth={p.strokeWidth}
    />
  ),
  ReferenceLine: (p: any) => (
    <div
      data-testid="reference-line"
      data-y={p.y}
      data-x={p.x}
      data-label={typeof p.label?.value === "string" ? p.label.value : undefined}
    />
  ),
  ReferenceArea: (p: any) => <div data-testid="reference-area" data-y1={p.y1} data-y2={p.y2} />,
  Customized: ({ component: Component }: any) =>
    Component ? <div data-testid="customized">{Component({})}</div> : null,
  Scatter: () => <div data-testid="recharts-scatter" />,
}))

// ===========================================================================
// Mock lucide-react — must include EVERY icon that admin-geo-metrics-
// dashboard.tsx imports at module level, because constants like
// SERVICE_ICONS reference them directly outside the component.
// ===========================================================================

vi.mock("lucide-react", () => {
  const Icon = ({ className }: any) => <span data-testid="lucide-icon" data-class={className} />
  Icon.displayName = "LucideIcon"
  return {
    Activity: Icon,
    AlertTriangle: Icon,
    Copy: Icon,
    BarChart3: Icon,
    Bell: Icon,
    CheckCircle2: Icon,
    Database: Icon,
    FileJson: Icon,
    GitCompareArrows: Icon,
    Globe: Icon,
    LineChart: Icon,
    MapPin: Icon,
    Microscope: Icon,
    RefreshCw: Icon,
    Search: Icon,
    Timer: Icon,
    TrendingDown: Icon,
    TrendingUp: Icon,
    Upload: Icon,
    Zap: Icon,
  }
})

// ===========================================================================
// Shared fixtures
// ===========================================================================

import {
  FIXTURE_BENCHMARK,
  FIXTURE_NORMAL_HISTORY,
  FIXTURE_DEGRADED_HISTORY,
  FIXTURE_BASELINES,
} from "./fixtures"

// ===========================================================================
// Helpers
// ===========================================================================

function renderGiST(props?: {
  history?: Array<{
    timestamp: number
    services: Record<string, { p50: number; p95: number; p99: number; count: number }>
  }> | null
  baselines?: Record<string, number>
}) {
  return render(
    <GiSTSelectivitySection
      benchmark={FIXTURE_BENCHMARK}
      history={props?.history ?? FIXTURE_NORMAL_HISTORY}
      baselines={props?.baselines ?? FIXTURE_BASELINES}
    />,
  )
}

// ===========================================================================
// Tests
// ===========================================================================

describe("GiSTSelectivitySection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container may already be cleaned up by React 19 + jsdom flushSync
    }
  })

  // ── Section Headers ─────────────────────────────────────────────────

  it("renders section title with GiST and Haversine heading", () => {
    renderGiST()
    expect(screen.getByText("Curva de Seletividade — GiST Index vs Haversine")).toBeInTheDocument()
  })

  // ── Radius Selector ─────────────────────────────────────────────────

  it("renders radius selector with slider and all 4 preset buttons", () => {
    renderGiST()

    const slider = screen.getByRole("slider", { name: /raio/i })
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute("min", "1")
    expect(slider).toHaveAttribute("max", "50")

    // 4 radius preset buttons (5, 15, 30, 50 km) — not density presets (which use /km²)
    const kmButtons = screen.getAllByRole("button").filter((btn) => {
      const text = btn.textContent ?? ""
      return text.includes("km") && !text.includes("/km²")
    })
    expect(kmButtons).toHaveLength(4)
    // Check each radius preset value is present across all buttons
    const allText = kmButtons.map((b) => b.textContent).join(" ")
    expect(allText).toMatch(/5/)
    expect(allText).toMatch(/15/)
    expect(allText).toMatch(/30/)
    expect(allText).toMatch(/50/)
  })

  it("shows selectivity percentage (9% at 15 km default)", () => {
    renderGiST()
    // At 15km with REFERENCE_RADIUS_KM=50: selectivity = (15/50)² = 0.09 → 9%
    expect(screen.getByText("9%")).toBeInTheDocument()
  })

  // ── Selectivity Chart (mocked Recharts) ──────────────────────────────

  it("renders chart container with scale toggle (default log)", () => {
    renderGiST()

    const containers = screen.getAllByTestId("recharts-container")
    expect(containers.length).toBeGreaterThan(0)

    const toggle = screen.getByRole("switch", { name: /alternar escala/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute("aria-checked", "true")
  })

  it("renders ReferenceLines for P95 band and 2× baseline PostGIS", () => {
    renderGiST()

    const refLines = screen.getAllByTestId("reference-line")
    expect(refLines.length).toBeGreaterThanOrEqual(2)

    const baselineLabels = refLines.filter((el) =>
      el.getAttribute("data-label")?.includes("baseline"),
    )
    expect(baselineLabels.length).toBeGreaterThan(0)
  })

  it("renders ReferenceArea for P95 min-max band when history has data", () => {
    renderGiST()

    const areas = screen.getAllByTestId("reference-area")
    expect(areas.length).toBeGreaterThan(0)

    expect(areas[0]).toHaveAttribute("data-y1")
    expect(areas[0]).toHaveAttribute("data-y2")
    expect(Number(areas[0].getAttribute("data-y1"))).toBeGreaterThan(0)
    expect(Number(areas[0].getAttribute("data-y2"))).toBeGreaterThan(0)
  })

  // ── PostGIS Filtered / Haversine Lines ──────────────────────────────

  it("renders PostGIS filtered chart lines for all 5 provider counts", () => {
    renderGiST()

    const pgLines = screen
      .getAllByTestId("chart-line")
      .filter((el) => el.getAttribute("data-datakey")?.startsWith("pg_"))

    expect(pgLines).toHaveLength(5) // 100, 500, 1000, 5000, 10000
  })

  it("renders Haversine reference chart lines for all 5 provider counts", () => {
    renderGiST()

    const havLines = screen
      .getAllByTestId("chart-line")
      .filter((el) => el.getAttribute("data-datakey")?.startsWith("hav_"))

    expect(havLines).toHaveLength(5) // 100, 500, 1000, 5000, 10000
  })

  // ── Cost at Selected Radius Table ──────────────────────────────────

  it("renders cost table with provider counts data", () => {
    renderGiST()

    // Table headers — "Providers" appears in both cost and crossover tables
    const providerHeaders = screen.getAllByText("Providers")
    expect(providerHeaders.length).toBeGreaterThanOrEqual(2)

    expect(screen.getByText("PostGIS (ms)")).toBeInTheDocument()
    expect(screen.getByText("Haversine (ms)")).toBeInTheDocument()
    expect(screen.getByText("Razão")).toBeInTheDocument()
    expect(screen.getByText("Regime")).toBeInTheDocument()

    // Provider count labels in cost table: 100, 300, 1k, 3k, 10k
    // (default totalProviders=10000 → [100, 300, 1000, 3000, 10000])
    // Each number may appear in multiple tables, use getAllByText
    const all100 = screen.getAllByText("100")
    expect(all100.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("300")).toBeInTheDocument()
    expect(screen.getByText("3k")).toBeInTheDocument()
    const all10k = screen.getAllByText("10k")
    expect(all10k.length).toBeGreaterThanOrEqual(1)
  })

  it("shows regime indicator badges (GiST vence / Haversine vence)", () => {
    renderGiST()

    expect(screen.getByText(/GiST vence em/)).toBeInTheDocument()
    expect(screen.getByText(/Haversine vence em/)).toBeInTheDocument()
  })

  // ── Crossover Table ────────────────────────────────────────────────

  it("renders crossover table with provider counts and equivalent radius", () => {
    renderGiST()

    expect(screen.getByText("Pontos de Crossover")).toBeInTheDocument()

    expect(screen.getByText("Raio equivalente*")).toBeInTheDocument()
    expect(screen.getByText("Seletividade")).toBeInTheDocument()

    // 10.000 appears in both crossover and measured tables
    const all10000 = screen.getAllByText("10.000")
    expect(all10000.length).toBeGreaterThanOrEqual(1)
  })

  // ── Measured vs Model Table ────────────────────────────────────────

  it("renders measured vs model table with delta values", () => {
    renderGiST()

    expect(screen.getByText("Modelo vs Medição (Full Scan)")).toBeInTheDocument()

    expect(screen.getByText("Modelo (ms)")).toBeInTheDocument()
    expect(screen.getByText("Medido (ms)")).toBeInTheDocument()
    expect(screen.getByText("Δ")).toBeInTheDocument()

    // Provider counts in measured table use toLocaleString
    // Already verified in crossover test above
  })

  // ── Analysis / Interpretation Card ─────────────────────────────────

  it("renders interpretation card with regime descriptions", () => {
    renderGiST()

    expect(screen.getByText("Interpretação")).toBeInTheDocument()
    expect(screen.getByText(/Regime GiST \(verde\)/)).toBeInTheDocument()
    expect(screen.getByText(/Regime Haversine/)).toBeInTheDocument()

    // "Crossover:" appears inside the interpretation paragraph alone
    const allCrossoverTexts = screen
      .getAllByText(/Crossover/)
      .filter((el) => el.textContent?.startsWith("Crossover:"))
    expect(allCrossoverTexts.length).toBeGreaterThan(0)
  })

  // ── No History (no P95 data) ──────────────────────────────────────

  it("renders without errors when history is null (no P95 band)", () => {
    const { asFragment } = render(
      <GiSTSelectivitySection
        benchmark={FIXTURE_BENCHMARK}
        history={null}
        baselines={FIXTURE_BASELINES}
      />,
    )

    expect(screen.getByText("Modelo vs Medição (Full Scan)")).toBeInTheDocument()

    const areas = screen.queryAllByTestId("reference-area")
    expect(areas).toHaveLength(0)

    expect(asFragment()).toMatchSnapshot("no-history")
  })

  it("renders without errors when history is empty array", () => {
    render(
      <GiSTSelectivitySection
        benchmark={FIXTURE_BENCHMARK}
        history={[]}
        baselines={FIXTURE_BASELINES}
      />,
    )

    expect(screen.getByText(/Curva de Seletividade/)).toBeInTheDocument()
    expect(screen.getByText("Pontos de Crossover")).toBeInTheDocument()
  })

  // ── GiST Degradation Alert ────────────────────────────────────────

  it("does NOT show degradation alert when P95 is below model curves (normal)", () => {
    renderGiST()

    expect(screen.queryByText(/Índice GiST degradado/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ultrapassou/)).not.toBeInTheDocument()
  })

  it("shows full degradation alert when P95 exceeds all model curves", () => {
    // The GiSTSelectivitySection uses a useRef buffer (size=5) that needs 5
    // consecutive renders before the degradation alert appears.  First render
    // only has 1 entry, so we re-render 4 more times to fill the buffer.
    const { rerender } = renderGiST({ history: FIXTURE_DEGRADED_HISTORY })

    const rerenderSame = () => {
      rerender(
        <GiSTSelectivitySection
          benchmark={FIXTURE_BENCHMARK}
          history={FIXTURE_DEGRADED_HISTORY}
          baselines={FIXTURE_BASELINES}
        />,
      )
    }

    for (let i = 0; i < 4; i++) rerenderSame()

    // Alert section heading
    expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()
    expect(screen.getByText(/performance degradada/)).toBeInTheDocument()
    expect(screen.getByText(/todas as escalas/)).toBeInTheDocument()
  })

  it("degradation alert shows exact P95 value (250ms) in message", () => {
    const { rerender } = renderGiST({ history: FIXTURE_DEGRADED_HISTORY })

    // Fill the 5-entry degradation buffer
    const rerenderSame = () => {
      rerender(
        <GiSTSelectivitySection
          benchmark={FIXTURE_BENCHMARK}
          history={FIXTURE_DEGRADED_HISTORY}
          baselines={FIXTURE_BASELINES}
        />,
      )
    }

    for (let i = 0; i < 4; i++) rerenderSame()

    // Verify the P95 value is mentioned by checking text across all elements
    const allEls = screen.getAllByText(/250ms|250 ms/)
    expect(allEls.length).toBeGreaterThan(0)
  })

  // ── 2× Baseline Reference Line ────────────────────────────────────

  it("renders 2× baseline reference line for PostGIS (60ms)", () => {
    renderGiST()

    const refLines = screen.getAllByTestId("reference-line")
    const baselineLine = refLines.find(
      (el) => el.getAttribute("data-label") === "2× baseline PostGIS (60ms)",
    )
    expect(baselineLine).toBeInTheDocument()
  })

  // ── Radius Preset Snapshots ──────────────────────────────────────────
  //
  //  4 radius presets (5, 15, 30, 50 km) with snapshot after clicking each
  //  button.  Each preset produces a different selectivity state that affects
  //  the cost table, regime indicators, and chart reference lines.
  //
  //  Expected selectivities (REFERENCE_RADIUS_KM=50):
  //    5 km  → (5/50)²  = 1%   → snapPct  0%
  //    15 km → (15/50)² = 9%   → snapPct 10%
  //    30 km → (30/50)² = 36%  → snapPct 35%
  //    50 km → (50/50)² = 100% → snapPct 100%

  it.each([5, 15, 30, 50])("renders snapshot at %d km radius preset", (radius) => {
    const { asFragment } = renderGiST()

    const btn = screen.getByRole("button", { name: `${radius} km` })
    fireEvent.click(btn)

    expect(asFragment()).toMatchSnapshot(`radius-${radius}km`)
  })

  // ── Full Snapshot ─────────────────────────────────────────────────

  it("renders full section without errors (snapshot)", () => {
    const { asFragment } = renderGiST()
    expect(asFragment()).toMatchSnapshot("gist-selectivity-section")
  })
})
