import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import { Skeleton } from "../skeleton"

describe("Skeleton", () => {
  it("renders a div with skeleton slot", () => {
    const { container } = render(<Skeleton />)
    expect(container.querySelector("[data-slot='skeleton']")).toBeInTheDocument()
  })

  it("applies className", () => {
    const { container } = render(<Skeleton className="h-8 w-48" />)
    expect(container.querySelector("[data-slot='skeleton']")?.className).toContain("h-8")
    expect(container.querySelector("[data-slot='skeleton']")?.className).toContain("w-48")
  })

  it("merges default skeleton classes with custom", () => {
    const { container } = render(<Skeleton className="custom" />)
    const className = container.querySelector("[data-slot='skeleton']")?.className ?? ""
    expect(className).toContain("animate-pulse")
    expect(className).toContain("custom")
  })

  it("renders children", () => {
    render(<Skeleton>carregando</Skeleton>)
    expect(screen.getByText("carregando")).toBeInTheDocument()
  })
})
