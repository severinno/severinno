/**
 * Tests for POST /api/admin/realtime/sessions/revoke-orphans — admin manual
 * sweep of orphan realtime sockets (TTL-expired session OR user no longer in
 * the DB), proxied to the mini-service + audited in revoke-run-audit.
 *
 * Coverage:
 *   1. 401/403 when requireRole rejects (admin only)
 *   2. Fail-closed: no REALTIME_EMIT_TOKEN → ok:false (never crashes)
 *   3. Proxies to the realtime /revoke-orphans with Bearer + audits the run
 *      (recordRevokeRun source="admin", status completed, reason com counts)
 *   4. Realtime down (fetch TimeoutError) → ok:false degradação graciosa
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const { mockRequireRole, mockHandleError, mockRecordRevokeRun } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockHandleError: vi.fn(),
  mockRecordRevokeRun: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireRole: mockRequireRole,
}))
vi.mock("@/lib/api-server", () => ({
  handleError: mockHandleError,
}))
vi.mock("@/lib/revoke-run-audit", () => ({
  recordRevokeRun: mockRecordRevokeRun,
}))

import { POST } from "../revoke-orphans/route"

const ADMIN = { userId: "admin-1", role: "ADMIN" }

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
  )
}

function mockFetchFail() {
  // Em Bun, o DOMException do AbortSignal.timeout NÃO é instanceof Error —
  // o check por nome é o único caminho que chega à degradação graciosa.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue({ name: "TimeoutError", message: "timed out" }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  delete process.env.REALTIME_EMIT_TOKEN
  mockRecordRevokeRun.mockResolvedValue(undefined)
})

describe("POST /api/admin/realtime/sessions/revoke-orphans", () => {
  it("rejeita sem role ADMIN (requireRole lança → handleError)", async () => {
    mockRequireRole.mockRejectedValue(new Error("UNAUTHORIZED"))
    mockHandleError.mockReturnValue(NextResponse.json({ error: "Não autorizado" }, { status: 401 }))

    const res = await POST()
    expect(res.status).toBe(401)
    expect(mockHandleError).toHaveBeenCalled()
    expect(mockRecordRevokeRun).not.toHaveBeenCalled()
  })

  it("fail-closed: sem REALTIME_EMIT_TOKEN → ok:false, sem fetch, sem auditoria", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const res = await POST()
    const body = (await res.json()) as { ok: boolean; revoked: number; error?: string }

    expect(body.ok).toBe(false)
    expect(body.revoked).toBe(0)
    expect(body.error).toContain("REALTIME_EMIT_TOKEN")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockRecordRevokeRun).not.toHaveBeenCalled()
  })

  it("proxies ao realtime com Bearer + audita o run (source admin, completed, com counts)", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    process.env.REALTIME_EMIT_TOKEN = "test-token"
    mockFetchOk({ ok: true, revoked: 3, expired: 2, missingUser: 1, checkedUsers: 5 })

    const res = await POST()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      revoked: number
      expired: number
      missingUser: number
      checkedUsers: number
    }
    expect(body).toMatchObject({
      ok: true,
      revoked: 3,
      expired: 2,
      missingUser: 1,
      checkedUsers: 5,
    })

    // Proxy com Bearer + timeout
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/revoke-orphans")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token")
    expect(init.signal).toBeDefined()

    // Auditoria: source admin, completed, reason com os counts
    expect(mockRecordRevokeRun).toHaveBeenCalledTimes(1)
    const entry = mockRecordRevokeRun.mock.calls[0]![0] as {
      source: string
      status: string
      revoked: number
      reason: string
    }
    expect(entry.source).toBe("admin")
    expect(entry.status).toBe("completed")
    expect(entry.revoked).toBe(3)
    expect(entry.reason).toContain("expired=2")
    expect(entry.reason).toContain("missingUser=1")
  })

  it("audita como error quando o realtime responde não-ok", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    process.env.REALTIME_EMIT_TOKEN = "test-token"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 502 })))

    const res = await POST()
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain("502")

    const entry = mockRecordRevokeRun.mock.calls[0]![0] as { status: string; error?: string }
    expect(entry.status).toBe("error")
    expect(entry.error).toContain("502")
  })

  it("degradação: realtime fora do ar (fetch TimeoutError) → ok:false, nunca 500", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    process.env.REALTIME_EMIT_TOKEN = "test-token"
    mockFetchFail()

    const res = await POST()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; revoked: number; error?: string }
    expect(body.ok).toBe(false)
    expect(body.revoked).toBe(0)
    expect(body.error).toContain("Realtime não respondeu")
  })
})
