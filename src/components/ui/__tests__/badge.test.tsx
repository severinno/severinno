import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "../badge"

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>New</Badge>)
    expect(screen.getByText("New")).toBeInTheDocument()
  })

  it("renders with data-slot attribute", () => {
    const { container } = render(<Badge>Default</Badge>)
    expect(container.querySelector("[data-slot='badge']")).toBeInTheDocument()
  })

  it("renders with default variant", () => {
    const { container } = render(<Badge>Default</Badge>)
    const badge = container.querySelector("[data-slot='badge']")
    expect(badge).toBeInTheDocument()
  })

  it("renders with secondary variant", () => {
    render(<Badge variant="secondary">Secondary</Badge>)
    expect(screen.getByText("Secondary")).toBeInTheDocument()
  })

  it("renders with destructive variant", () => {
    render(<Badge variant="destructive">Destructive</Badge>)
    expect(screen.getByText("Destructive")).toBeInTheDocument()
  })

  it("renders with outline variant", () => {
    render(<Badge variant="outline">Outline</Badge>)
    expect(screen.getByText("Outline")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(<Badge className="custom-badge">Custom</Badge>)
    const badge = container.querySelector("[data-slot='badge']")
    expect(badge?.className).toContain("custom-badge")
  })
})
