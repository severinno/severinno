/**
 * Tests for GET /api/cron/revoke-inactive-sessions — batch revoke of realtime
 * sockets for inactive/deleted users.
 *
 * Covers:
 *   - Multi-page scan with cursor pagination (100/page)
 *   - dryRun=1 reports counts WITHOUT calling revokeUserSessions
 *   - Concurrency pool (revokeInactiveSessionsBatch direct): max 5 in-flight,
 *     failures counted separately
 *   - Cooldown active → skips execution (no db scan, no emit, no markCompleted)
 *   - 401 when CRON_SECRET is set and Bearer missing/wrong
 *   - Access allowed when CRON_SECRET is empty (no auth configured)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ── Hoisted mocks (vi.mock factories run before static imports resolve) ────

const {
  mockRevokeUserSessions,
  mockIsCooldownElapsed,
  mockMarkCompleted,
  mockCaptureMessage,
  mockRecordRevokeRun,
} = vi.hoisted(() => {
  const revoke = vi.fn().mockResolvedValue(undefined)
  const cooldown = vi.fn().mockResolvedValue(true)
  const mark = vi.fn().mockResolvedValue(undefined)
  const capture = vi.fn()
  const record = vi.fn().mockResolvedValue(undefined)
  return {
    mockRevokeUserSessions: revoke,
    mockIsCooldownElapsed: cooldown,
    mockMarkCompleted: mark,
    mockCaptureMessage: capture,
    mockRecordRevokeRun: record,
  }
})

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/auth", () => ({
  revokeUserSessions: mockRevokeUserSessions,
}))

vi.mock("@/lib/cron-cooldown", () => ({
  isCooldownElapsed: mockIsCooldownElapsed,
  markCompleted: mockMarkCompleted,
}))

vi.mock("@/lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
}))

vi.mock("@/lib/revoke-run-audit", () => ({
  recordRevokeRun: mockRecordRevokeRun,
  listRevokeRuns: vi.fn(),
}))

// ── Imports (must come after vi.mock) ──────────────────────────────────────

import { GET, revokeInactiveSessionsBatch } from "../cron/revoke-inactive-sessions/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

const CRON_URL = "http://localhost/api/cron/revoke-inactive-sessions"
const BEARER = { authorization: "Bearer my-cron-secret" }

function resetDbMocks() {
  ;(db.user as any) = { findMany: vi.fn(), updateMany: vi.fn() }
}

const _origCronSecret = process.env.CRON_SECRET

function usersOf(n: number, prefix = "u"): Array<{ id: string }> {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("revokeInactiveSessionsBatch — pool de concorrência (função pura)", () => {
  it("limita a concorrência ao pool (5) e revoga todos", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const revoke = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    const users = usersOf(12)

    const res = await revokeInactiveSessionsBatch(users, { dryRun: false, revoke })

    expect(res.revoked).toBe(12)
    expect(res.failed).toBe(0)
    expect(revoke).toHaveBeenCalledTimes(12)
    expect(maxInFlight).toBeLessThanOrEqual(5)
    expect(maxInFlight).toBeGreaterThan(1) // concorrência realmente usada
  })

  it("conta falhas separadamente quando revoke lança", async () => {
    const revoke = vi.fn().mockRejectedValue(new Error("emit down"))
    const users = usersOf(6)

    const res = await revokeInactiveSessionsBatch(users, { dryRun: false, revoke })

    expect(res.revoked).toBe(0)
    expect(res.failed).toBe(6)
    expect(revoke).toHaveBeenCalledTimes(6)
  })

  it("dryRun conta sem chamar revoke (batch)", async () => {
    const revoke = vi.fn()
    const users = usersOf(4)

    const res = await revokeInactiveSessionsBatch(users, { dryRun: true, revoke })

    expect(res.revoked).toBe(4)
    expect(res.failed).toBe(0)
    expect(revoke).not.toHaveBeenCalled()
  })
})

describe("GET /api/cron/revoke-inactive-sessions", () => {
  beforeEach(() => {
    resetDbMocks()
    process.env.CRON_SECRET = "my-cron-secret"
    mockRevokeUserSessions.mockClear()
    mockIsCooldownElapsed.mockClear().mockResolvedValue(true)
    mockMarkCompleted.mockClear()
    mockCaptureMessage.mockClear()
    mockRecordRevokeRun.mockClear()
  })

  afterAll(() => {
    process.env.CRON_SECRET = _origCronSecret
  })

  it("varre múltiplas páginas com cursor e revoga todos", async () => {
    vi.mocked(db.user.findMany)
      .mockResolvedValueOnce(usersOf(100) as any)
      .mockResolvedValueOnce(usersOf(100, "u2") as any)
      .mockResolvedValueOnce(usersOf(50, "u3") as any)

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.dryRun).toBe(false)
    expect(data.scanned).toBe(250)
    expect(data.revoked).toBe(250)
    expect(data.failed).toBe(0)
    expect(data.threshold.inactiveSince).toBeDefined()
    expect(data.threshold.passwordChangedSince).toBeDefined()

    // 1ª chamada: where com as 3 condições (inativo, deletado, troca de senha
    // once-only — exige revokedByCronAt: null)
    expect(db.user.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ active: false }),
            expect.objectContaining({
              deletedAt: expect.objectContaining({ lte: expect.any(Date) }),
            }),
            expect.objectContaining({
              passwordChangedAt: expect.objectContaining({ lte: expect.any(Date) }),
              revokedByCronAt: null,
            }),
          ]),
        }),
      }),
    )

    // Once-only marker: após cada página, grava revokedByCronAt nos revogados
    // (impede re-revogação diária de quem trocou a senha há N dias)
    expect(db.user.updateMany).toHaveBeenCalledTimes(3)
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: expect.any(Array) } }),
        data: expect.objectContaining({ revokedByCronAt: expect.any(Date) }),
      }),
    )

    // 3 páginas: cursor na 2ª e 3ª chamadas
    expect(db.user.findMany).toHaveBeenCalledTimes(3)
    expect(db.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ skip: 1, cursor: { id: "u-99" } }),
    )
    expect(db.user.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ skip: 1, cursor: { id: "u2-99" } }),
    )
    expect(mockRevokeUserSessions).toHaveBeenCalledTimes(250)
    expect(mockMarkCompleted).toHaveBeenCalledWith("revoke-inactive-sessions", expect.any(Number))
    // Audit registrado com status completed e os contadores reais
    expect(mockRecordRevokeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", dryRun: false, scanned: 250, revoked: 250 }),
    )
  })

  it("página vazia encerra a varredura sem chamar revoke", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([])

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.scanned).toBe(0)
    expect(data.revoked).toBe(0)
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
    expect(db.user.findMany).toHaveBeenCalledTimes(1)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it("dryRun reporta o que seria revogado sem emitir nada", async () => {
    vi.mocked(db.user.findMany).mockResolvedValueOnce(usersOf(3) as any)

    const res = await GET(new Request(`${CRON_URL}?dryRun=1`, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.dryRun).toBe(true)
    expect(data.scanned).toBe(3)
    expect(data.revoked).toBe(3)
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
    // Dry-run NÃO marca cooldown (não suprime o cron real por 23h)
    expect(mockMarkCompleted).not.toHaveBeenCalled()
    // Dry-run NÃO grava o once-only marker (não toca no banco)
    expect(db.user.updateMany).not.toHaveBeenCalled()
    expect(mockRecordRevokeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", dryRun: true, scanned: 3, revoked: 3 }),
    )
  })

  it("cooldown ativo → skip sem varrer nem emitir", async () => {
    mockIsCooldownElapsed.mockResolvedValueOnce(false)

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.status).toBe("skipped")
    expect(data.reason).toBe("cooldown")
    expect(db.user.findMany).not.toHaveBeenCalled()
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it("retorna 401 quando CRON_SECRET está setado e o Bearer falta", async () => {
    const res = await GET(new Request(CRON_URL))
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
    expect(db.user.findMany).not.toHaveBeenCalled()
  })

  it("retorna 401 quando o Bearer está errado", async () => {
    const res = await GET(new Request(CRON_URL, { headers: { authorization: "Bearer wrong" } }))
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
  })

  it("permite acesso quando CRON_SECRET é vazio (sem auth configurado)", async () => {
    process.env.CRON_SECRET = ""
    vi.mocked(db.user.findMany).mockResolvedValue([])

    const res = await GET(new Request(CRON_URL))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.scanned).toBe(0)
  })

  it("retorna 500 sem vazar a mensagem interna em erro", async () => {
    vi.mocked(db.user.findMany).mockRejectedValue(new Error("DB connection failed"))

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(500)
    // A rota usa handleError, que NÃO vaza mensagem de erro genérico
    // (segurança) — ao contrário do cron-settlements, que retorna e.message.
    expect(data.error).toBe("Erro interno do servidor")
    expect(data.error).not.toContain("DB connection failed")
    // Audit registra o erro antes de relançar
    expect(mockRecordRevokeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", dryRun: false }),
    )
  })
})
