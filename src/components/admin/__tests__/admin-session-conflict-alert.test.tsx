/**
 * admin-session-conflict-alert.test.tsx
 *
 * Unit tests for the SessionConflictAlert banner (global session-conflict
 * alert on the admin dashboard). O banner aparece no topo do dashboard
 * quando QUALQUER usuário tem >1 socket simultâneo no realtime. Coberto:
 *   - Renderiza NADA sem dados (fetch ainda não resolveu)
 *   - Renderiza NADA com realtime fora do ar (ok: false)
 *   - Renderiza NADA sem conflitos (usersWithMultipleSockets === 0)
 *   - Renderiza o banner com a contagem quando há conflito(s)
 *   - CTA "Ver usuários" chama onNavigate("admin.users")
 *   - Sem onNavigate → banner sem botão (degradação graciosa)
 */

import { describe, it, expect, vi } from "vitest"
import React from "react"
import { render, screen, fireEvent } from "@/__tests__/test-utils"

vi.mock("lucide-react", () => ({
  AlertTriangle: () => <svg data-testid="icon-alert" />,
  ArrowRight: () => <svg data-testid="icon-arrow" />,
  Users: () => <svg data-testid="icon-users" />,
}))

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div data-testid="alert">{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="alert-title">{children}</h2>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="alert-desc">{children}</p>
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: { children: React.ReactNode; [k: string]: unknown }) => (
    <button data-testid="alert-cta" {...p}>
      {children}
    </button>
  ),
}))

import {
  SessionConflictAlert,
  type SessionConflictAlertData,
} from "../admin-session-conflict-alert"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSessions(overrides: Partial<SessionConflictAlertData> = {}): SessionConflictAlertData {
  return {
    ok: true,
    usersWithMultipleSockets: 0,
    conflicts: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionConflictAlert", () => {
  it("renders nothing when sessionsData is undefined (fetch ainda não resolveu)", () => {
    const { container } = render(<SessionConflictAlert sessionsData={undefined} />)
    expect(container.querySelector('[data-testid="alert"]')).toBeNull()
  })

  it("renders nothing when realtime is unavailable (ok: false)", () => {
    const { container } = render(
      <SessionConflictAlert sessionsData={makeSessions({ ok: false })} />,
    )
    expect(container.querySelector('[data-testid="alert"]')).toBeNull()
  })

  it("renders nothing when there are no conflicts (usersWithMultipleSockets === 0)", () => {
    const { container } = render(
      <SessionConflictAlert sessionsData={makeSessions()} onNavigate={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="alert"]')).toBeNull()
  })

  it("renders the alert with the conflict count when a user has >1 socket", () => {
    render(
      <SessionConflictAlert
        sessionsData={makeSessions({
          usersWithMultipleSockets: 1,
          conflicts: [{ userId: "u1", role: "PROVIDER", socketCount: 2, oldestAgeMs: 600_000 }],
        })}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByTestId("alert")).toBeInTheDocument()
    expect(screen.getByTestId("alert-title")).toHaveTextContent(
      "1 usuário com múltiplas sessões simultâneas no realtime",
    )
    expect(screen.getByTestId("alert-desc")).toHaveTextContent("2 sockets ativos no total")
  })

  it("pluralizes the count for multiple conflicting users", () => {
    render(
      <SessionConflictAlert
        sessionsData={makeSessions({
          usersWithMultipleSockets: 3,
          conflicts: [
            { userId: "u1", role: "PROVIDER", socketCount: 2, oldestAgeMs: 1 },
            { userId: "u2", role: "CLIENT", socketCount: 3, oldestAgeMs: 1 },
            { userId: "u3", role: "ADMIN", socketCount: 2, oldestAgeMs: 1 },
          ],
        })}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByTestId("alert-title")).toHaveTextContent(
      "3 usuários com múltiplas sessões simultâneas no realtime",
    )
    expect(screen.getByTestId("alert-desc")).toHaveTextContent("7 sockets ativos no total")
  })

  it("CTA 'Ver usuários' navigates to admin.users", () => {
    const onNavigate = vi.fn()
    render(
      <SessionConflictAlert
        sessionsData={makeSessions({
          usersWithMultipleSockets: 1,
          conflicts: [{ userId: "u1", role: "CLIENT", socketCount: 2, oldestAgeMs: 1 }],
        })}
        onNavigate={onNavigate}
      />,
    )

    fireEvent.click(screen.getByTestId("alert-cta"))
    expect(onNavigate).toHaveBeenCalledWith("admin.users")
  })

  it("hides the CTA when onNavigate is not provided (degradação graciosa)", () => {
    render(
      <SessionConflictAlert
        sessionsData={makeSessions({
          usersWithMultipleSockets: 1,
          conflicts: [{ userId: "u1", role: "CLIENT", socketCount: 2, oldestAgeMs: 1 }],
        })}
      />,
    )

    expect(screen.getByTestId("alert")).toBeInTheDocument()
    expect(screen.queryByTestId("alert-cta")).toBeNull()
  })
})
