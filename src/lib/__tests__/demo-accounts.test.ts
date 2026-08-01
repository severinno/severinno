/**
 * demo-accounts.test.ts
 *
 * Unit tests for the demo-accounts gate (isDemoAccountsEnabled) and the
 * server-side block helper (isDemoAccountEmail).
 *
 * Cobre o comportamento prod vs dev:
 *   - production → demo accounts DESABILITADAS (false)
 *   - development / test → habilitadas (true)
 *   - sem argumento → lê process.env.NODE_ENV em tempo de chamada
 *   - valor inesperado → tratado como não-produção (true, safe default)
 *
 * E o reconhecimento de emails demo (usado pelas rotas de auth):
 *   - admin/cliente/joao@severinno.com → true
 *   - normalização (trim + lowercase) → casa com rotas de auth
 *   - emails comuns → false
 *   - null/undefined/vazio → false
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { isDemoAccountsEnabled, isDemoAccountEmail, DEMO_ACCOUNT_EMAILS } from "../demo-accounts"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("isDemoAccountsEnabled", () => {
  it("desabilita contas demo em produção", () => {
    expect(isDemoAccountsEnabled("production")).toBe(false)
  })

  it("habilita contas demo em development", () => {
    expect(isDemoAccountsEnabled("development")).toBe(true)
  })

  it("habilita contas demo em test", () => {
    expect(isDemoAccountsEnabled("test")).toBe(true)
  })

  it("lê process.env.NODE_ENV quando chamado sem argumento", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(isDemoAccountsEnabled()).toBe(false)

    vi.stubEnv("NODE_ENV", "development")
    expect(isDemoAccountsEnabled()).toBe(true)
  })

  it("trata valores inesperados como não-produção (safe default)", () => {
    expect(isDemoAccountsEnabled("staging")).toBe(true)
    expect(isDemoAccountsEnabled("")).toBe(true)
  })
})

describe("isDemoAccountEmail", () => {
  it("reconhece os 3 emails demo", () => {
    expect(isDemoAccountEmail("admin@severinno.com")).toBe(true)
    expect(isDemoAccountEmail("cliente@severinno.com")).toBe(true)
    expect(isDemoAccountEmail("joao@severinno.com")).toBe(true)
  })

  it("normaliza trim + lowercase (como as rotas de auth)", () => {
    expect(isDemoAccountEmail("  ADMIN@Severinno.com  ")).toBe(true)
    expect(isDemoAccountEmail("Cliente@SEVERINNO.com")).toBe(true)
  })

  it("retorna false para emails comuns", () => {
    expect(isDemoAccountEmail("maria@severinno.com")).toBe(false)
    expect(isDemoAccountEmail("user@example.com")).toBe(false)
    expect(isDemoAccountEmail("admin@example.com")).toBe(false)
  })

  it("retorna false para null/undefined/vazio", () => {
    expect(isDemoAccountEmail(null)).toBe(false)
    expect(isDemoAccountEmail(undefined)).toBe(false)
    expect(isDemoAccountEmail("")).toBe(false)
  })

  it("DEMO_ACCOUNT_EMAILS contém exatamente os 3 emails normalizados", () => {
    expect(DEMO_ACCOUNT_EMAILS.size).toBe(3)
    expect(DEMO_ACCOUNT_EMAILS.has("admin@severinno.com")).toBe(true)
    expect(DEMO_ACCOUNT_EMAILS.has("cliente@severinno.com")).toBe(true)
    expect(DEMO_ACCOUNT_EMAILS.has("joao@severinno.com")).toBe(true)
  })
})
