import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../card"

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText("Card content")).toBeInTheDocument()
  })

  it("renders with data-slot attribute", () => {
    const { container } = render(<Card>Card</Card>)
    expect(container.querySelector("[data-slot='card']")).toBeInTheDocument()
  })
})

describe("CardHeader", () => {
  it("renders children", () => {
    render(<CardHeader>Header</CardHeader>)
    expect(screen.getByText("Header")).toBeInTheDocument()
  })
})

describe("CardTitle", () => {
  it("renders heading element", () => {
    render(<CardTitle>Title</CardTitle>)
    expect(screen.getByText("Title")).toBeInTheDocument()
  })
})

describe("CardContent", () => {
  it("renders content", () => {
    render(<CardContent>Content</CardContent>)
    expect(screen.getByText("Content")).toBeInTheDocument()
  })
})

describe("CardFooter", () => {
  it("renders footer", () => {
    const { container } = render(<CardFooter>Footer</CardFooter>)
    const el = container.querySelector("[data-slot='card-footer']")
    expect(el).toBeInTheDocument()
    expect(el?.textContent).toBe("Footer")
  })
})

describe("Card composition", () => {
  it("renders a complete card with all subcomponents", () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card Description</CardDescription>
        </CardHeader>
        <CardContent>Main content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    )
    expect(container.querySelector("[data-slot='card']")).toBeInTheDocument()
    expect(container.querySelector("[data-slot='card-header']")).toBeInTheDocument()
    expect(container.querySelector("[data-slot='card-footer']")).toBeInTheDocument()
    expect(screen.getByText("Card Title")).toBeInTheDocument()
    expect(screen.getByText("Card Description")).toBeInTheDocument()
    expect(screen.getByText("Main content")).toBeInTheDocument()
  })
})
