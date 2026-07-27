import { describe, it, expect } from "vitest"
import React from "react"
import { render, screen } from "@testing-library/react"

function SimpleComponent() {
  const [count] = React.useState(0)
  return <div data-testid="simple">{count}</div>
}

describe("Simple test", () => {
  it("renders with hooks", () => {
    render(<SimpleComponent />)
    expect(screen.getByTestId("simple")).toBeInTheDocument()
  })
})
