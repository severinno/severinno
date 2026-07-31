/**
 * benchmark-section-snapshot.test.tsx
 *
 * Snapshot test for the BenchmarkSection component (Haversine JS vs PostGIS).
 *
 * Mocks Recharts at the module level to render testable placeholder elements
 * instead of actual SVG, since JSDOM does not support SVG measurement APIs.
 * Mocks benchmark-data.ts to isolate the component from its data pipeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { BenchmarkSection } from "../benchmark-section"

// ===========================================================================
// Mock Recharts — JSDOM does not support SVG measurement
// ===========================================================================

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="recharts-container">{children}</div>
  ),
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  XAxis: (p: any) => <div data-testid="xaxis" data-datakey={p.dataKey} data-scale={p.scale} />,
  YAxis: () => <div data-testid="yaxis" />,
  Tooltip: () => <div data-testid="recharts-tooltip" />,
  Legend: () => <div data-testid="legend" />,
  Bar: (p: any) => (
    <div data-testid="chart-bar" data-datakey={p.dataKey} data-name={p.name} data-fill={p.fill} />
  ),
  Cell: () => <div data-testid="chart-cell" />,
}))

// ===========================================================================
// Mock lucide-react — must include all icons from admin-geo-metrics-dashboard
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

import { FIXTURE_BENCHMARK, FIXTURE_BAR_DATA } from "./fixtures"

vi.mock("@/lib/benchmark-data", () => ({
  buildBenchmarkBarData: vi.fn(() => FIXTURE_BAR_DATA),
  getMaxPostgisLatency: vi.fn(() => 222000),
  ratioColor: vi.fn(() => "hsl(0, 72%, 51%)"),
  generateBenchmarkCsv: vi.fn(() => "mock-csv-content"),
  downloadFile: vi.fn(),
  printBenchmarkReport: vi.fn(),
}))

// ===========================================================================
// Tests
// ===========================================================================

describe("BenchmarkSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      /* container already cleaned up */
    }
  })

  // ── Section Header ─────────────────────────────────────────────────

  it("renders section title and description", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    expect(screen.getByText("Benchmark Real — Haversine JS vs PostGIS")).toBeInTheDocument()
  })

  it("renders export buttons (CSV, PDF, scale toggle)", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    expect(screen.getByLabelText("Exportar CSV")).toBeInTheDocument()
    expect(screen.getByLabelText("Exportar PDF")).toBeInTheDocument()

    const toggle = screen.getByRole("switch", { name: /alternar escala/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute("aria-checked", "true")
  })

  // ── Metric Cards ───────────────────────────────────────────────────

  it("renders the latency metric card with Haversine JS and PostGIS bars", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    expect(screen.getByText(/Latência Média/)).toBeInTheDocument()

    const bars = screen.getAllByTestId("chart-bar")
    const haversineBars = bars.filter((b) => b.getAttribute("data-name") === "Haversine JS")
    expect(haversineBars.length).toBeGreaterThan(0)

    const postgisBars = bars.filter((b) => b.getAttribute("data-name") === "PostGIS")
    expect(postgisBars.length).toBeGreaterThan(0)
  })

  it("renders the throughput (ops/sec) metric card", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    expect(screen.getByText("Throughput (ops/sec)")).toBeInTheDocument()
  })

  it("renders the ratio card with analysis note", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    expect(screen.getByText(/Razão PostGIS/)).toBeInTheDocument()

    expect(screen.getByText(/Haversine JS é significativamente mais rápido/)).toBeInTheDocument()
  })

  it("shows benchmark metadata (platform, nodeVersion, center) in footer", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    expect(screen.getByText(/win32/)).toBeInTheDocument()
    expect(screen.getByText(/v22.14.0/)).toBeInTheDocument()
    expect(screen.getByText(/-23.5505, -46.6333/)).toBeInTheDocument()
  })

  // ── Scale Toggle ──────────────────────────────────────────────────

  it("toggles scale from Log to Linear on click", () => {
    render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)

    const toggle = screen.getByRole("switch", { name: /alternar escala/i })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-checked", "false")
  })

  // ── Full Snapshot ─────────────────────────────────────────────────

  it("matches snapshot", () => {
    const { asFragment } = render(<BenchmarkSection benchmark={FIXTURE_BENCHMARK} />)
    expect(asFragment()).toMatchSnapshot("benchmark-section")
  })
})
