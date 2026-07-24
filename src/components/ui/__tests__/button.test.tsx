import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Button } from "../button"

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText("Click me")).toBeInTheDocument()
  })

  it("applies default variant classes", () => {
    render(<Button>Default</Button>)
    const btn = screen.getByRole("button", { name: "Default" })
    expect(btn.className).toContain("bg-primary")
  })

  it("applies destructive variant", () => {
    render(<Button variant="destructive">Delete</Button>)
    const btn = screen.getByText("Delete")
    expect(btn.className).toContain("bg-destructive")
  })

  it("forwards onClick", () => {
    let clicked = false
    render(<Button onClick={() => { clicked = true }}>Click</Button>)
    screen.getByText("Click").click()
    expect(clicked).toBe(true)
  })

  it("renders as child when asChild is true", () => {
    render(
      <Button asChild>
        <a href="/test">Link</a>
      </Button>,
    )
    const link = screen.getByText("Link")
    expect(link.tagName).toBe("A")
    expect(link).toHaveAttribute("href", "/test")
  })
})
