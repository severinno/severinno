/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"

// Import shared mocks BEFORE the component
import "./test-setup"
import { LoginPageClient } from "../login/login-page-client"

afterEach(cleanup)

describe("LoginPage (/login)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the login form with title", () => {
    render(<LoginPageClient />)
    // "Entrar" existe no título (h2) e no botão de submit — usa role para
    // ser unívoco e não quebrar com múltiplos matches.
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeDefined()
    expect(screen.getByText("Acesse sua conta Severinno")).toBeDefined()
  })

  it("has email and password fields", () => {
    render(<LoginPageClient />)
    expect(screen.getByLabelText("E-mail")).toBeDefined()
    expect(screen.getByLabelText("Senha")).toBeDefined()
  })

  it("has a link to forgot password", () => {
    render(<LoginPageClient />)
    const forgotLink = screen.getByText("Esqueceu a senha?")
    expect(forgotLink).toBeDefined()
    expect(forgotLink.closest("a")).toHaveAttribute("href", "/auth/reset-password")
  })

  it("has a link to register page", () => {
    render(<LoginPageClient />)
    const registerLink = screen.getByText("Cadastre-se")
    expect(registerLink).toBeDefined()
    expect(registerLink.closest("a")).toHaveAttribute("href", "/register")
  })

  it("has a role toggle between CLIENT and PROVIDER", () => {
    render(<LoginPageClient />)
    expect(screen.getByText("Cliente")).toBeDefined()
    expect(screen.getByText("Prestador")).toBeDefined()
  })

  it("has a back to home link", () => {
    render(<LoginPageClient />)
    const backLink = screen.getByText("Voltar ao início")
    expect(backLink).toBeDefined()
    expect(backLink.closest("a")).toHaveAttribute("href", "/")
  })

  it("renders submit button", () => {
    render(<LoginPageClient />)
    expect(screen.getByRole("button", { name: /entrar/i })).toBeDefined()
  })
})
