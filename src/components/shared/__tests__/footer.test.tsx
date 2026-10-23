import * as React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@/__tests__/test-utils"
import Footer from "../footer"

vi.mock("next/image", () => ({
  default: (props: any) => {
    return <img {...props} alt={props.alt || ""} />
  },
}))

describe("Footer Component", () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders the brand and description", () => {
    render(<Footer />)
    expect(screen.getByAltText("Severinno")).toBeInTheDocument()
    expect(screen.getByText(/Marketplace de serviços com geolocalização/i)).toBeInTheDocument()
  })

  it("renders the desktop column 'Chame o Severinno' with title and subtitle", () => {
    render(<Footer />)
    expect(screen.getByRole("heading", { name: /Chame o Severinno/i })).toBeInTheDocument()
    expect(screen.getByText(/Disponível para Android e iOS/i)).toBeInTheDocument()
  })

  it("renders both Google Play Store and Apple App Store badges with correct image sources and alt texts", () => {
    render(<Footer />)

    const googlePlayImg = screen.getByAltText("Disponível no Google Play")
    expect(googlePlayImg).toBeInTheDocument()
    expect(googlePlayImg).toHaveAttribute("src", "/images/google-play-badge.svg")

    const appStoreImg = screen.getByAltText("Baixar na App Store")
    expect(appStoreImg).toBeInTheDocument()
    expect(appStoreImg).toHaveAttribute("src", "/images/app-store-badge.svg")

    const googlePlayLink = screen.getByRole("link", {
      name: /Disponível no Google Play/i,
    })
    expect(googlePlayLink).toHaveAttribute("href", "https://play.google.com")
    expect(googlePlayLink).toHaveAttribute("target", "_blank")

    const appStoreLink = screen.getByRole("link", {
      name: /Baixar na App Store/i,
    })
    expect(appStoreLink).toHaveAttribute("href", "https://www.apple.com/app-store/")
    expect(appStoreLink).toHaveAttribute("target", "_blank")
  })

  it("renders social media links and contact column", () => {
    render(<Footer />)
    expect(screen.getByRole("list", { name: "Redes sociais" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /Contato/i })).toBeInTheDocument()
    expect(screen.getByText("Governador Valadares, MG — Brasil")).toBeInTheDocument()
  })
})
