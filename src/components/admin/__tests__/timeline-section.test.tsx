/**
 * timeline-section.test.tsx
 *
 * Unit tests for the TimelineSection component (P50 / P95 / P99 historical
 * evolution chart).
 *
 * Covers:
 *   - Rendering com 3 snapshots (badge "3 snapshots" + info box)
 *   - Um card por serviço com as 3 linhas P50 / P95 / P99 (Recharts Line)
 *   - ReferenceLine de 2× baseline por serviço (quando baseline existe)
 *   - Serviço sem amostras (p50 zerado) é pulado (sem card/linhas)
 *   - Toggle de escala Log/Linear com persistência em localStorage
 *
 * Mocks:
 *   - recharts      — mock local com Line/ReferenceLine como spies
 *                     (vi.hoisted) para assertar props; demais são pass-through
 *                     (ResponsiveContainer/LineChart) ou leaves que renderizam
 *                     null (grid/eixos/tooltip/legend)
 *   - lucide-react  — MockIcon placeholder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { TimelineSection } from "../timeline-section"
import { COLOR_P50, COLOR_P95, COLOR_P99 } from "../admin-chart-theme"
import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"

// ===========================================================================
// Spies de Recharts (Line / ReferenceLine) — vi.hoisted para sobreviver ao
// hoisting do vi.mock
// ===========================================================================

// Assinatura tipada com as props (Record<string, unknown>): o vi.fn sem
// parâmetros inferiria `Parameters = []` e `args[0]` quebraria no tsc
// (TS2493/TS2352). O segundo arg que o React 19 passa (contexto legado,
// undefined) é ignorado — só o primeiro (props) interessa.
const { mockLine, mockReferenceLine } = vi.hoisted(() => ({
  mockLine: vi.fn((_props: Record<string, unknown>) => null),
  mockReferenceLine: vi.fn((_props: Record<string, unknown>) => null),
}))

vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return { LineChart: MockIcon, TrendingUp: MockIcon, TrendingDown: MockIcon }
})

vi.mock("recharts", () => {
  // Pass-through: renderiza children (permite que o conteúdo apareça no DOM)
  const PassThrough = ({ children }: any) => <div>{children}</div>
  // Leaf: renderiza null (elementos SVG sem conteúdo assertável no jsdom)
  const Leaf = () => null
  return {
    ResponsiveContainer: PassThrough,
    LineChart: PassThrough,
    CartesianGrid: Leaf,
    XAxis: Leaf,
    YAxis: Leaf,
    Tooltip: Leaf,
    Legend: Leaf,
    Line: mockLine,
    ReferenceLine: mockReferenceLine,
  }
})

// ===========================================================================
// Fixture — 3 snapshots, 2 serviços com amostras + 1 sem amostras (skip)
// ===========================================================================

type TimelineHistory = NonNullable<GeoMetricsResponse["history"]>

function buildHistory(): TimelineHistory {
  const now = Date.now()
  const mk = (p50: number, p95: number, p99: number, count = 10) => ({ p50, p95, p99, count })
  return [
    {
      timestamp: now - 2000,
      services: { postgis: mk(8, 12, 30), viacep: mk(50, 120, 300), nominatim: mk(0, 0, 0, 0) },
    },
    {
      timestamp: now - 1000,
      services: { postgis: mk(9, 15, 35), viacep: mk(55, 130, 320), nominatim: mk(0, 0, 0, 0) },
    },
    {
      timestamp: now,
      services: { postgis: mk(7, 11, 28), viacep: mk(45, 110, 280), nominatim: mk(0, 0, 0, 0) },
    },
  ]
}

const HISTORY = buildHistory()
const LABELS = { postgis: "PostGIS", viacep: "ViaCEP", nominatim: "Nominatim" }
const BASELINES = { postgis: 30, viacep: 250, nominatim: 400 }

// ===========================================================================
// Tests
// ===========================================================================

// React 19 invoca componentes como `type(props, ...rest)` — o segundo
// argumento (contexto legado) é sempre `undefined`. Por isso os spies de
// recharts registram chamadas com 2 args; estes helpers extraem apenas o
// primeiro (as props), tornando as assertions independentes desse detalhe.
// args[0] já é Record<string, unknown> (assinatura tipada dos spies acima) —
// sem necessidade de cast.
const lineProps = () => mockLine.mock.calls.map((args) => args[0])
const refProps = () => mockReferenceLine.mock.calls.map((args) => args[0])

describe("TimelineSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      // NotFoundError durante cleanup é artefato conhecido do React 19 +
      // jsdom + custom-render. Inofensivo — os testes passam.
    }
  })

  it("renderiza o header com badge de 3 snapshots e um card por serviço com amostras", () => {
    render(<TimelineSection history={HISTORY} labels={LABELS} baselines={BASELINES} />)

    expect(screen.getByText(/Evolução Temporal/)).toBeInTheDocument()
    expect(screen.getByText("3 snapshots")).toBeInTheDocument()
    expect(screen.getByText(/últimos 3 snapshots/)).toBeInTheDocument()

    // Cards dos serviços com amostras
    expect(screen.getByText(/PostGIS — P50 \/ P95 \/ P99/)).toBeInTheDocument()
    expect(screen.getByText(/ViaCEP — P50 \/ P95 \/ P99/)).toBeInTheDocument()

    // Serviço sem amostras não renderiza card
    expect(screen.queryByText(/Nominatim —/)).not.toBeInTheDocument()
  })

  it("renderiza as 3 linhas P50 / P95 / P99 para cada serviço (6 Line calls)", () => {
    render(<TimelineSection history={HISTORY} labels={LABELS} baselines={BASELINES} />)

    const calls = lineProps()
    expect(calls).toHaveLength(6)

    const cases: Array<[string, string, string]> = [
      ["postgis_p50", "P50", COLOR_P50],
      ["postgis_p95", "P95", COLOR_P95],
      ["postgis_p99", "P99", COLOR_P99],
      ["viacep_p50", "P50", COLOR_P50],
      ["viacep_p95", "P95", COLOR_P95],
      ["viacep_p99", "P99", COLOR_P99],
    ]
    for (const [dataKey, name, stroke] of cases) {
      expect(calls).toEqual(
        expect.arrayContaining([expect.objectContaining({ dataKey, name, stroke })]),
      )
    }

    // O serviço sem amostras não gera linhas
    expect(calls.some((p) => String(p.dataKey).startsWith("nominatim_"))).toBe(false)
  })

  it("adiciona ReferenceLine com 2× baseline para cada serviço com baseline", () => {
    render(<TimelineSection history={HISTORY} labels={LABELS} baselines={BASELINES} />)

    const calls = refProps()
    // postgis: 30 × 2 = 60 · viacep: 250 × 2 = 500
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ y: 60 })]))
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ y: 500 })]))

    // nominatim tem baseline (400 → 800), mas sem amostras o card é pulado →
    // nenhum ReferenceLine é renderizado para ele
    expect(calls.some((p) => p.y === 800)).toBe(false)
  })

  it("pula serviço sem amostras (nenhum card, linha ou ReferenceLine)", () => {
    render(<TimelineSection history={HISTORY} labels={LABELS} baselines={BASELINES} />)

    expect(screen.queryByText(/Nominatim/)).not.toBeInTheDocument()
    expect(lineProps().some((p) => String(p.dataKey).startsWith("nominatim_"))).toBe(false)
    expect(refProps().some((p) => p.y === 800)).toBe(false)
  })

  it("alterna a escala Log/Linear e persiste a preferência no localStorage", () => {
    render(<TimelineSection history={HISTORY} labels={LABELS} baselines={BASELINES} />)

    // Default: log (sem preferência salva)
    const toggle = screen.getByRole("switch")
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("Log")).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("Linear")).toBeInTheDocument()
    expect(localStorage.getItem("geo-scale-timeline")).toBe("false")
  })
})
