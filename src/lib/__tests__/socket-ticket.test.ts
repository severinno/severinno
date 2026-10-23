/**
 * Testes de createSocketTicket (src/lib/auth.ts) — ticket SINGLE-USE para o
 * handshake do realtime. A identidade vem da SESSÃO (getSession injetável),
 * nunca do corpo; o ticket vive 60s no Redis compartilhado e é consumido com
 * GETDEL pelo mini-service (auth:socket-ticket:<ticket>).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const store = new Map<string, { value: unknown }>()

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async <T>(key: string): Promise<T | null> => {
    const hit = store.get(key)
    return hit ? (hit.value as T) : null
  }),
  cacheSet: vi.fn(async (key: string, value: unknown) => {
    store.set(key, { value })
  }),
  cacheInvalidate: vi.fn(async (key: string) => {
    store.delete(key)
  }),
}))

// Módulos de topo do auth.ts — nunca executados (getSession é injetado),
// mas precisam existir para o import do módulo.
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }))
vi.mock("@/lib/tracing", () => ({
  traceSpan: vi.fn(async (_name: string, fn: (s: unknown) => unknown) =>
    fn({ setAttribute: () => {} }),
  ),
}))
vi.mock("@/lib/demo-accounts", () => ({
  isDemoAccountsEnabled: vi.fn(() => true),
  isDemoAccountEmail: vi.fn(() => false),
}))

import {
  createSocketTicket,
  SOCKET_TICKET_PREFIX,
  SOCKET_TICKET_TTL_SECONDS,
  type SessionPayload,
} from "../auth"

const sessionOf = (userId: string, role: SessionPayload["role"]): SessionPayload => ({
  userId,
  role,
  sessionVersion: 0,
})

beforeEach(() => {
  store.clear()
})

describe("createSocketTicket", () => {
  it("emite ticket de 64 hex chars com a identidade da SESSÃO", async () => {
    const res = await createSocketTicket(async () => sessionOf("user-1", "CLIENT"))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.ticket).toMatch(/^[0-9a-f]{64}$/)
    expect(res.expiresIn).toBe(SOCKET_TICKET_TTL_SECONDS)
    const stored = store.get(`${SOCKET_TICKET_PREFIX}${res.ticket}`)?.value as {
      userId: string
      role: string
    }
    expect(stored).toEqual({ userId: "user-1", role: "CLIENT" })
  })

  it("grava no Redis com TTL de 60s", async () => {
    const { cacheSet } = await import("@/lib/redis")
    await createSocketTicket(async () => sessionOf("user-1", "CLIENT"))
    expect(cacheSet).toHaveBeenCalledWith(
      expect.stringContaining(SOCKET_TICKET_PREFIX),
      { userId: "user-1", role: "CLIENT" },
      60,
    )
  })

  it("sem sessão não emite ticket (e não toca o Redis)", async () => {
    const res = await createSocketTicket(async () => null)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBeTruthy()
    expect(store.size).toBe(0)
  })

  it("o role do ticket é o da SESSÃO, não um parâmetro chamável", async () => {
    const res = await createSocketTicket(async () => sessionOf("admin-9", "ADMIN"))
    if (!res.ok) throw new Error("deveria emitir")
    const stored = store.get(`${SOCKET_TICKET_PREFIX}${res.ticket}`)?.value as { role: string }
    expect(stored.role).toBe("ADMIN")
  })

  it("dois tickets emitidos são distintos (entropia de 32 bytes)", async () => {
    const a = await createSocketTicket(async () => sessionOf("user-1", "CLIENT"))
    const b = await createSocketTicket(async () => sessionOf("user-1", "CLIENT"))
    if (!a.ok || !b.ok) throw new Error("ambos deveriam emitir")
    expect(a.ticket).not.toBe(b.ticket)
  })
})
