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
import { render, screen, cleanup } from "@/__tests__/test-utils"
import { MetricCard } from "../admin-metric-card"

// ===========================================================================
// Helper: mock icon component
// ===========================================================================

const MockIcon = (props: { className?: string }) => (
  <svg data-testid="mock-icon" className={props.className} />
)
MockIcon.displayName = "MockIcon"

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
})
