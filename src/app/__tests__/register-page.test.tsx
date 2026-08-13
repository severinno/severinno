/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"

// Import shared mocks BEFORE the component
import "./test-setup"
import { RegisterPageClient } from "../register/register-page-client"

afterEach(cleanup)

describe("RegisterPage (/register)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the register form with title", () => {
    render(<RegisterPageClient />)
    expect(screen.getByText("Criar conta")).toBeDefined()
    expect(screen.getByText("Cadastre-se como cliente ou prestador de serviços")).toBeDefined()
  })

  it("has name, email, password and confirm password fields", () => {
    render(<RegisterPageClient />)
    expect(screen.getByLabelText("Nome completo")).toBeDefined()
    expect(screen.getByLabelText("E-mail")).toBeDefined()
    expect(screen.getByLabelText("Senha")).toBeDefined()
    expect(screen.getByLabelText("Confirmar senha")).toBeDefined()
  })

  it("has a role toggle between CLIENT and PROVIDER", () => {
    render(<RegisterPageClient />)
    expect(screen.getByText("Cliente")).toBeDefined()
    expect(screen.getByText("Prestador")).toBeDefined()
  })

  it("has a link to login page", () => {
    render(<RegisterPageClient />)
    const loginLink = screen.getByText("Faça login")
    expect(loginLink).toBeDefined()
    expect(loginLink.closest("a")).toHaveAttribute("href", "/login")
  })

  it("has a back to home link", () => {
    render(<RegisterPageClient />)
    const backLink = screen.getByText("Voltar ao início")
    expect(backLink).toBeDefined()
    expect(backLink.closest("a")).toHaveAttribute("href", "/")
  })

  it("renders submit button", () => {
    render(<RegisterPageClient />)
    expect(screen.getByRole("button", { name: /criar conta/i })).toBeDefined()
  })

  it("has password field with minLength of 6", () => {
    render(<RegisterPageClient />)
    const passwordInput = screen.getByLabelText("Senha") as HTMLInputElement
    expect(passwordInput.minLength).toBe(6)
  })
})
