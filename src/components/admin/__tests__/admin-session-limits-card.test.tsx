/**
 * admin-session-limits-card.test.tsx
 *
 * Unit tests for the SessionLimitsCard status card (admin dashboard).
 *
 * O card reflete a config ATUAL de limites de sessões simultâneas por role
 * do realtime (default global + max resolvido por CLIENT/PROVIDER/ADMIN) —
 * exposto pelo realtime no GET /sessions (`limits`) e repassado pelo
 * dashboard. Coberto:
 *   - Degradação graciosa: sem limits OU realtime fora (available: false) →
 *     card renderiza NADA (nunca quebra o dashboard)
 *   - Renderiza default + os 3 roles com o max resolvido
 *   - Role sem override no perRole → usa o default (fallback)
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import React from "react"
import { render, screen, cleanup } from "@/__tests__/test-utils"

vi.mock("lucide-react", () => ({
  CircleUser: () => <svg data-testid="icon-client" />,
  HardHat: () => <svg data-testid="icon-provider" />,
  ShieldCheck: () => <svg data-testid="icon-admin" />,
}))

import SessionLimitsCard, { type SessionLimitsInfo } from "../admin-session-limits-card"

const LIMITS: SessionLimitsInfo = {
  default: 1,
  perRole: { CLIENT: 1, PROVIDER: 2, ADMIN: 5 },
}

const renderCard = (limits: SessionLimitsInfo | undefined, available: boolean) =>
  render(<SessionLimitsCard limits={limits} available={available} />)

describe("SessionLimitsCard", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container already cleaned up
    }
  })

  it("renders nothing when limits is undefined (fetch ainda não resolveu)", () => {
    const { container } = renderCard(undefined, true)
    expect(container.querySelector("[data-testid]")).toBeNull()
  })

  it("renders nothing when realtime is unavailable (available: false)", () => {
    const { container } = renderCard(LIMITS, false)
    expect(container.querySelector("[data-testid]")).toBeNull()
  })

  it("renders the default + the max resolved per role", () => {
    renderCard(LIMITS, true)

    expect(screen.getByText("Limites de sessão (realtime)")).toBeInTheDocument()
    expect(screen.getByText("default 1")).toBeInTheDocument()
    // Labels dos 3 roles
    expect(screen.getByText("Clientes")).toBeInTheDocument()
    expect(screen.getByText("Prestadores")).toBeInTheDocument()
    expect(screen.getByText("Administradores")).toBeInTheDocument()
    // max resolvido por role
    expect(screen.getByText("1")).toBeInTheDocument() // CLIENT
    expect(screen.getByText("2")).toBeInTheDocument() // PROVIDER
    expect(screen.getByText("5")).toBeInTheDocument() // ADMIN
  })

  it("falls back to the default when a role has no per-role override", () => {
    const partial: SessionLimitsInfo = { default: 1, perRole: { PROVIDER: 2 } }
    renderCard(partial, true)

    // CLIENT e ADMIN sem override → default (1); PROVIDER → 2.
    expect(screen.getByText("default 1")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    // "1" aparece duas vezes (default + fallback) — só verifica que o card renderizou.
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza o override por PLANO quando perPlan está configurado", () => {
    const withPlan: SessionLimitsInfo = {
      default: 1,
      perRole: { CLIENT: 1, PROVIDER: 2, ADMIN: 5 },
      perPlan: { FREE: 1, PREMIUM: 5 },
    }
    renderCard(withPlan, true)

    expect(screen.getByText("FREE")).toBeInTheDocument()
    expect(screen.getByText("PREMIUM")).toBeInTheDocument()
    // "5" aparece 2x (ADMIN role + PREMIUM plano); "1" 2x (CLIENT + FREE — o
    // "default 1" é um texto único "default 1", não casa com "1").
    expect(screen.getAllByText("5").length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2)
    // Chips de plano: título de tooltip documenta a precedência plano > role
    // (1 por chip — FREE e PREMIUM — getAllByTitle).
    expect(screen.getAllByTitle(/Override por plano/).length).toBeGreaterThanOrEqual(2)
  })

  it("sem perPlan (env não configurado) → nenhum chip de plano, roles intactos", () => {
    renderCard(LIMITS, true)

    expect(screen.queryByText("FREE")).toBeNull()
    expect(screen.queryByText("PREMIUM")).toBeNull()
    expect(screen.getByText("Prestadores")).toBeInTheDocument()
  })
})
