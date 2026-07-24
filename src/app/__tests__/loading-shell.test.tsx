import { describe, it, expect, afterEach } from "vitest"
import { render, within, cleanup } from "@testing-library/react"
import { LoadingShell, StaggerContainer, StaggerItem, S } from "../loading-shell"

afterEach(cleanup)

// ── LoadingShell ──────────────────────────────────────────────────────────

describe("LoadingShell", () => {
  it("renders children", () => {
    const { container } = render(
      <LoadingShell>
        <div data-testid="child">Hello</div>
      </LoadingShell>,
    )
    expect(within(container).getByText("Hello")).toBeInTheDocument()
    expect(within(container).getByTestId("child")).toBeInTheDocument()
  })

  it("renders ShimmerStyle (injects style tag)", () => {
    const { container } = render(
      <LoadingShell>
        <span>test</span>
      </LoadingShell>,
    )
    const style = container.querySelector("style")
    expect(style).toBeInTheDocument()
    expect(style?.textContent).toContain("@keyframes shimmer")
  })

  it("renders with multiple children", () => {
    const { container } = render(
      <LoadingShell>
        <span data-testid="a">A</span>
        <span data-testid="b">B</span>
      </LoadingShell>,
    )
    expect(within(container).getByTestId("a")).toBeInTheDocument()
    expect(within(container).getByTestId("b")).toBeInTheDocument()
  })
})

// ── StaggerContainer ──────────────────────────────────────────────────────

describe("StaggerContainer", () => {
  it("renders children", () => {
    const { container } = render(
      <StaggerContainer>
        <span>Content</span>
      </StaggerContainer>,
    )
    expect(within(container).getByText("Content")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(
      <StaggerContainer className="flex gap-2">
        <span>Item</span>
      </StaggerContainer>,
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("flex")
    expect(el.className).toContain("gap-2")
  })

  it("renders with default stagger (0.06)", () => {
    const { container } = render(
      <StaggerContainer>
        <span>Default stagger</span>
      </StaggerContainer>,
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it("renders with custom stagger", () => {
    const { container } = render(
      <StaggerContainer stagger={0.1}>
        <span>Custom stagger</span>
      </StaggerContainer>,
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it("renders with multiple children", () => {
    const { container } = render(
      <StaggerContainer>
        <span>First</span>
        <span>Second</span>
        <span>Third</span>
      </StaggerContainer>,
    )
    expect(within(container).getByText("First")).toBeInTheDocument()
    expect(within(container).getByText("Second")).toBeInTheDocument()
    expect(within(container).getByText("Third")).toBeInTheDocument()
  })
})

// ── StaggerItem ───────────────────────────────────────────────────────────

describe("StaggerItem", () => {
  it("renders children", () => {
    const { container } = render(
      <StaggerItem>
        <span>Hello from StaggerItem</span>
      </StaggerItem>,
    )
    expect(within(container).getByText("Hello from StaggerItem")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(
      <StaggerItem className="mt-4">
        <span>Styled</span>
      </StaggerItem>,
    )
    expect((container.firstChild as HTMLElement).className).toContain("mt-4")
  })

  it("renders with default y={12} and duration={0.35}", () => {
    const { container } = render(
      <StaggerItem>
        <span>Defaults test</span>
      </StaggerItem>,
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it("renders with custom y and duration", () => {
    const { container } = render(
      <StaggerItem y={24} duration={0.5}>
        <span>Custom params</span>
      </StaggerItem>,
    )
    expect(container.firstChild).toBeInTheDocument()
  })

  it("renders nested StaggerContainer inside StaggerItem", () => {
    const { container } = render(
      <StaggerContainer>
        <StaggerItem>
          <StaggerContainer stagger={0.05}>
            <StaggerItem>
              <span>Nested deep</span>
            </StaggerItem>
          </StaggerContainer>
        </StaggerItem>
      </StaggerContainer>,
    )
    expect(within(container).getByText("Nested deep")).toBeInTheDocument()
  })

  it("wraps S component properly", () => {
    const { container } = render(
      <StaggerContainer>
        <StaggerItem>
          <S className="h-8 w-48" />
        </StaggerItem>
      </StaggerContainer>,
    )
    const shimmer = container.querySelector(".shimmer")
    expect(shimmer).toBeInTheDocument()
    expect(shimmer?.className).toContain("h-8")
    expect(shimmer?.className).toContain("w-48")
  })
})

// ── LoadingShell + StaggerContainer + StaggerItem composition ─────────────

describe("LoadingShell composition", () => {
  it("renders full loading section with header and items", () => {
    const { container } = render(
      <LoadingShell>
        <StaggerContainer stagger={0.07}>
          <StaggerItem y={14} duration={0.4}>
            <S className="h-7 w-28" />
          </StaggerItem>
          <StaggerItem y={14} duration={0.4}>
            <S className="h-4 w-48" />
          </StaggerItem>
        </StaggerContainer>
      </LoadingShell>,
    )

    // Verify style tag is injected
    const style = container.querySelector("style")
    expect(style).toBeInTheDocument()
    expect(style?.textContent).toContain("@keyframes shimmer")

    // Verify shimmer divs exist (scoped to container)
    const shimmers = container.querySelectorAll(".shimmer")
    expect(shimmers.length).toBe(2)
    expect(shimmers[0].className).toContain("h-7")
    expect(shimmers[1].className).toContain("h-4")
  })
})
