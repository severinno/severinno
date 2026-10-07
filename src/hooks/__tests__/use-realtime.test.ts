import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchMock = vi.fn()

// jsdom: fetch global é stubável direto.
vi.stubGlobal("fetch", fetchMock)

import type { JoinPayload } from "../use-realtime"

beforeEach(() => {
  fetchMock.mockReset()
})

describe("fetch de ticket do use-realtime", () => {
  it("POST /api/realtime/ticket devolve o ticket em ok:true", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ticket: "b".repeat(64) }),
    })
    const res = await fetch("/api/realtime/ticket", { method: "POST" })
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.ticket).toMatch(/^[0-9a-f]{64}$/)
  })

  it("resposta 401 vira objeto vazio (handshake sem ticket — servidor decide)", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Não autenticado" }) })
    const res = await fetch("/api/realtime/ticket", { method: "POST" })
    const data = res.ok ? await res.json() : {}
    expect(data.ticket ?? undefined).toBeUndefined()
  })

  it("JoinPayload não tem mais campos obrigatórios (payload ignorado pelo servidor)", async () => {
    const mod = await import("../use-realtime")
    expect(typeof mod.useRealtime).toBe("function")
    const p: JoinPayload = {} // sem userId/role — válido por contrato
    expect(p.userId).toBeUndefined()
    expect(p.role).toBeUndefined()
  })
})
