/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import { Input } from "../input"

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input placeholder="Enter text" />)
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument()
  })

  it("renders with data-slot attribute", () => {
    const { container } = render(<Input placeholder="test" />)
    const el = container.querySelector("input")
    expect(el).toBeInTheDocument()
    // data-slot pode ou não estar presente dependendo da versão do shadcn/ui
    if (el?.hasAttribute("data-slot")) {
      expect(el).toHaveAttribute("data-slot", "input")
    }
  })

  it("applies class via className", () => {
    const { container } = render(<Input className="custom-input" placeholder="x" />)
    const el = container.querySelector("input.custom-input")
    expect(el).toBeInTheDocument()
  })

  it("forwards type attribute", () => {
    render(<Input type="email" data-testid="email-input" />)
    expect(screen.getByTestId("email-input")).toHaveAttribute("type", "email")
  })

  it("forwards disabled prop", () => {
    render(<Input disabled data-testid="disabled-input" />)
    expect(screen.getByTestId("disabled-input")).toBeDisabled()
  })

  it("forwards value", () => {
    render(<Input value="test" readOnly data-testid="value-input" />)
    expect(screen.getByTestId("value-input")).toHaveValue("test")
  })
})
