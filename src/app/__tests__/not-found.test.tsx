import { describe, it, expect, afterEach, vi } from "vitest"
import { render, within, cleanup } from "@testing-library/react"

vi.mock("lucide-react", () => ({
  Search: () => <svg data-testid="icon-search" />,
  Home: () => <svg data-testid="icon-home" />,
}))

import NotFound from "../not-found"

afterEach(cleanup)

describe("NotFound (404 page)", () => {
  it("renders 404 badge", () => {
    const { container } = render(<NotFound />)
    expect(within(container).getByText("404")).toBeInTheDocument()
  })

  it("renders page title", () => {
    const { container } = render(<NotFound />)
    expect(within(container).getByText("Página não encontrada")).toBeInTheDocument()
  })

  it("renders description text", () => {
    const { container } = render(<NotFound />)
    expect(
      within(container).getByText(/O conteúdo que você procura não existe/),
    ).toBeInTheDocument()
  })

  it("renders primary action link to home", () => {
    const { container } = render(<NotFound />)
    const homeLink = within(container).getByText("Voltar ao início")
    expect(homeLink).toBeInTheDocument()
    expect(homeLink.closest("a")).toHaveAttribute("href", "/")
  })

  it("renders secondary action link to search", () => {
    const { container } = render(<NotFound />)
    const searchLink = within(container).getByText("Buscar profissionais")
    expect(searchLink).toBeInTheDocument()
    expect(searchLink.closest("a")).toHaveAttribute("href", "/busca")
  })

  it("renders footer with copyright", () => {
    const { container } = render(<NotFound />)
    const year = new Date().getFullYear().toString()
    expect(
      within(container).getByText(new RegExp(`©.*${year}.*Severinno`)),
    ).toBeInTheDocument()
  })

  it("renders Search and Home icons (SVGs)", () => {
    const { container } = render(<NotFound />)
    // lucide-react Search + Home icons render as SVGs
    const svgs = container.querySelectorAll("svg")
    expect(svgs.length).toBeGreaterThanOrEqual(2)
  })

  it("renders decorative blobs with blur-3xl", () => {
    const { container } = render(<NotFound />)
    const blurDivs = container.querySelectorAll(".blur-3xl")
    expect(blurDivs.length).toBe(2)
  })

  it("injects style tag with keyframes", () => {
    const { container } = render(<NotFound />)
    const style = container.querySelector("style")
    expect(style).toBeInTheDocument()
    expect(style?.textContent).toContain("@keyframes fadeSlideUp")
    expect(style?.textContent).toContain("@keyframes fadeIn")
  })

  it("has h1 with correct text", () => {
    const { container } = render(<NotFound />)
    const h1 = container.querySelector("h1")
    expect(h1).toBeInTheDocument()
    expect(h1?.textContent).toBe("Página não encontrada")
  })

  it("has main container with gradient background", () => {
    const { container } = render(<NotFound />)
    const mainDiv = container.querySelector(".min-h-screen")
    expect(mainDiv).toBeInTheDocument()
    expect(mainDiv?.className).toContain("bg-gradient-to-b")
  })

  it("has animated ping circle around icon", () => {
    const { container } = render(<NotFound />)
    const pingEl = container.querySelector(".animate-ping")
    expect(pingEl).toBeInTheDocument()
    expect(pingEl?.className).toContain("rounded-full")
  })
})
