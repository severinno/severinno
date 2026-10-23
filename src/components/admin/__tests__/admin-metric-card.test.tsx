/**
 * admin-metric-card.test.tsx
 *
 * Unit tests for the MetricCard component.
 *
 * MetricCard is a pure presentational component — no external API calls,
 * no async state, no complex dependencies. Tests are straightforward:
 *   - Renderização com icon como React.ElementType
 *   - Renderização com icon como ReactNode
 *   - className opcional aplicado ao container
 *   - Conteúdo children renderizado corretamente
 */

import { describe, it, expect, afterEach } from "vitest"
import React from "react"
import { BarChart3 } from "lucide-react"
import { render, screen, cleanup } from "@/__tests__/test-utils"
import { MetricCard, KpiCard } from "../admin-metric-card"

// ===========================================================================
// Helper: mock icon component
// ===========================================================================

const MockIcon = (props: { className?: string }) => (
  <svg data-testid="mock-icon" className={props.className} />
)
MockIcon.displayName = "MockIcon"

const ForwardRefIcon = React.forwardRef<SVGSVGElement, { className?: string }>((props, ref) => (
  <svg ref={ref} data-testid="forward-ref-icon" className={props.className} />
))
ForwardRefIcon.displayName = "ForwardRefIcon"

// ===========================================================================
// Tests
// ===========================================================================

describe("MetricCard", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container already cleaned up
    }
  })

  // ── Title ───────────────────────────────────────────────────────────

  it("renders the title text", () => {
    render(
      <MetricCard icon={MockIcon} title="Latência (ms)">
        <p>conteúdo</p>
      </MetricCard>,
    )

    expect(screen.getByText("Latência (ms)")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Latência (ms)")
  })

  // ── Icon as React.ElementType ──────────────────────────────────────

  it("renders icon as React.ElementType", () => {
    render(
      <MetricCard icon={MockIcon} title="Teste">
        <p>conteúdo</p>
      </MetricCard>,
    )

    // The icon component receives className="text-primary size-4" and
    // renders as an SVG with data-testid="mock-icon"
    const icon = screen.getByTestId("mock-icon")
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass("text-primary")
    expect(icon).toHaveClass("size-4")
  })

  // ── Icon as ReactNode ──────────────────────────────────────────────

  it("renders icon as ReactNode (inline element)", () => {
    render(
      <MetricCard icon={<span data-testid="node-icon">🔍</span>} title="Teste">
        <p>conteúdo</p>
      </MetricCard>,
    )

    const icon = screen.getByTestId("node-icon")
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveTextContent("🔍")
  })

  it("renders icon as ReactNode (SVG element)", () => {
    render(
      <MetricCard
        icon={
          <svg data-testid="svg-node" className="size-4">
            <circle cx="8" cy="8" r="4" />
          </svg>
        }
        title="Teste SVG"
      >
        <p>conteúdo</p>
      </MetricCard>,
    )

    const icon = screen.getByTestId("svg-node")
    expect(icon).toBeInTheDocument()
  })

  // ── Children ────────────────────────────────────────────────────────

  it("renders children content", () => {
    render(
      <MetricCard icon={MockIcon} title="Com filhos">
        <p data-testid="child">conteúdo filho</p>
        <span data-testid="child2">segundo filho</span>
      </MetricCard>,
    )

    expect(screen.getByTestId("child")).toHaveTextContent("conteúdo filho")
    expect(screen.getByTestId("child2")).toHaveTextContent("segundo filho")
  })

  it("renders complex children (charts, tables, etc.)", () => {
    render(
      <MetricCard icon={MockIcon} title="Dashboard">
        <div data-testid="chart-area">
          <div data-testid="chart" role="img" aria-label="Gráfico de barras">
            ██████
          </div>
          <div data-testid="table">
            <span>linha 1</span>
            <span>linha 2</span>
          </div>
        </div>
      </MetricCard>,
    )

    expect(screen.getByTestId("chart-area")).toBeInTheDocument()
    expect(screen.getByTestId("chart")).toBeInTheDocument()
    expect(screen.getByTestId("table")).toBeInTheDocument()
  })

  // ── Optional className ──────────────────────────────────────────────

  it("applies optional className to the outer container", () => {
    const { container } = render(
      <MetricCard icon={MockIcon} title="Com classe" className="extra-class mb-4">
        <p>conteúdo</p>
      </MetricCard>,
    )

    const rootDiv = container.firstChild as HTMLElement
    expect(rootDiv.className).toContain("border-border/50")
    expect(rootDiv.className).toContain("bg-card")
    expect(rootDiv.className).toContain("extra-class")
    expect(rootDiv.className).toContain("mb-4")
  })

  it("renders correctly without className", () => {
    const { container } = render(
      <MetricCard icon={MockIcon} title="Sem classe">
        <p>conteúdo</p>
      </MetricCard>,
    )

    const rootDiv = container.firstChild as HTMLElement
    expect(rootDiv.className).toContain("rounded-xl")
    // No extra classes beyond defaults
    expect(rootDiv.className).not.toMatch(/\bextra-\w+/)
  })

  // ── Lucide & ForwardRef icons (object with $$typeof / render) ──────

  it("renders React.forwardRef icon components without throwing Objects are not valid as React child", () => {
    render(
      <MetricCard icon={ForwardRefIcon} title="ForwardRef Test">
        <p>conteúdo</p>
      </MetricCard>,
    )

    const icon = screen.getByTestId("forward-ref-icon")
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass("text-primary")
    expect(icon).toHaveClass("size-4")
  })

  it("renders real Lucide icon components (BarChart3)", () => {
    const { container } = render(
      <MetricCard icon={BarChart3} title="Erros por Endpoint">
        <p>conteúdo de métricas</p>
      </MetricCard>,
    )

    expect(screen.getByText("Erros por Endpoint")).toBeInTheDocument()
    const svg = container.querySelector("svg")
    expect(svg).toBeInTheDocument()
    expect(svg?.getAttribute("class")).toContain("text-primary")
    expect(svg?.getAttribute("class")).toContain("size-4")
  })
})

describe("KpiCard", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container already cleaned up
    }
  })

  it("renders KPI label, value and Lucide icon", () => {
    render(<KpiCard icon={BarChart3} label="Endpoints Afetados" value="12" subtitle="3 em alta" />)

    expect(screen.getByText("Endpoints Afetados")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("3 em alta")).toBeInTheDocument()
  })

  it("renders trend and trendLabel", () => {
    render(
      <KpiCard
        icon={ForwardRefIcon}
        label="Total de Erros"
        value="150"
        trend="down"
        trendLabel="-15% vs período anterior"
      />,
    )

    expect(screen.getByText("Total de Erros")).toBeInTheDocument()
    expect(screen.getByText("150")).toBeInTheDocument()
    expect(screen.getByText("-15% vs período anterior")).toBeInTheDocument()
  })
})
