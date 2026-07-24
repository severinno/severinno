import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Avatar, AvatarImage, AvatarFallback } from "../avatar"

describe("Avatar", () => {
  it("renders with fallback initials", () => {
    render(
      <Avatar>
        <AvatarImage src="/broken.jpg" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText("JD")).toBeInTheDocument()
  })

  it("renders children", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    )
    expect(container.querySelector("[data-slot='avatar']")).toBeInTheDocument()
  })

  it("applies className", () => {
    const { container } = render(
      <Avatar className="custom-avatar">
        <AvatarFallback>CD</AvatarFallback>
      </Avatar>,
    )
    const avatar = container.querySelector("[data-slot='avatar']")
    expect(avatar?.className).toContain("custom-avatar")
  })
})
