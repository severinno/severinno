/**
 * POST /api/sync/offline-batch — sincronização REAL do PWA offline.
 *
 * Regressão que estes testes travam: a rota antiga respondia
 * `{ success, processed, synced }` sem gravar nada, e o hook lia
 * `syncedIds` (inexistente) — a fila local nunca era limpa e a evidência de
 * campo (foto/check-in) era perdida em silêncio.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  booking: { findMany: vi.fn() },
  offlineEvidence: { findMany: vi.fn(), create: vi.fn() },
}))

const mockUploadBase64 = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ db: mockDb }))
vi.mock("@/lib/s3", () => ({ uploadBase64: mockUploadBase64 }))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "provider-1", role: "PROVIDER" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from "../sync/offline-batch/route"
import { callRoute } from "@/lib/__tests__/helpers/api-test-utils"

// ── Fixtures ───────────────────────────────────────────────────────────────

const BOOKING_ID = "booking-1"

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "off_1700000000_abcd",
    bookingId: BOOKING_ID,
    type: "CHECKIN",
    latitude: -18.85,
    longitude: -41.95,
    recordedAt: "2026-10-20T12:00:00.000Z",
    ...overrides,
  }
}

const ownedBooking = { id: BOOKING_ID, providerId: "provider-1" }
const foreignBooking = { id: "booking-2", providerId: "provider-2" }

function post(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/sync/offline-batch", body })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/sync/offline-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.booking.findMany.mockResolvedValue([ownedBooking])
    mockDb.offlineEvidence.findMany.mockResolvedValue([])
    mockDb.offlineEvidence.create.mockResolvedValue({ id: "ev-1" })
  })

  it("persiste a evidência do prestador autenticado e devolve syncedIds", async () => {
    const { res, data } = await post({ items: [item()] })

    expect(res.status).toBe(200)
    expect(data).toMatchObject({
      processed: 1,
      succeeded: 1,
      failed: 0,
      syncedIds: ["off_1700000000_abcd"],
      errors: [],
    })
    expect(mockDb.offlineEvidence.create).toHaveBeenCalledTimes(1)

    const createArgs = mockDb.offlineEvidence.create.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    // Identidade vem da SESSÃO, nunca do payload.
    expect(createArgs.data.providerId).toBe("provider-1")
    expect(createArgs.data.externalId).toBe("off_1700000000_abcd")
    expect(createArgs.data.type).toBe("CHECKIN")
  })

  it("ignora providerId vindo do corpo (não é campo de identidade)", async () => {
    const { res } = await post({ items: [item({ providerId: "attacker" })] })

    expect(res.status).toBe(200)
    const createArgs = mockDb.offlineEvidence.create.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data.providerId).toBe("provider-1")
  })

  it("recusa booking de outro prestador item a item (não derruba o lote)", async () => {
    mockDb.booking.findMany.mockResolvedValue([ownedBooking, foreignBooking])

    const { res, data } = await post({
      items: [
        item({ id: "off_1700000000_aaaa" }),
        item({ id: "off_1700000000_bbbb", bookingId: "booking-2" }),
      ],
    })

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ processed: 2, succeeded: 1, failed: 1 })
    expect(data.errors).toEqual([
      { id: "off_1700000000_bbbb", error: "Agendamento não pertence ao prestador" },
    ])
    expect(mockDb.offlineEvidence.create).toHaveBeenCalledTimes(1)
  })

  it("é idempotente: item já gravado conta como sucesso e não duplica", async () => {
    mockDb.offlineEvidence.findMany.mockResolvedValue([{ externalId: "off_1700000000_abcd" }])

    const { data } = await post({ items: [item()] })

    expect(data).toMatchObject({ succeeded: 1, failed: 0, syncedIds: ["off_1700000000_abcd"] })
    expect(mockDb.offlineEvidence.create).not.toHaveBeenCalled()
  })

  it("trata corrida no unique (P2002) como sucesso idempotente", async () => {
    mockDb.offlineEvidence.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    )

    const { res, data } = await post({ items: [item()] })

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it("faz upload da foto e guarda a URL", async () => {
    mockUploadBase64.mockResolvedValue({ url: "https://cdn.test/offline/b1/foto.jpg" })

    await post({
      items: [item({ type: "AFTER_PHOTO", photoBase64: "data:image/jpeg;base64,AAAA" })],
    })

    expect(mockUploadBase64).toHaveBeenCalledTimes(1)
    const createArgs = mockDb.offlineEvidence.create.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data.photoUrl).toBe("https://cdn.test/offline/b1/foto.jpg")
  })

  it("falha só o item cuja foto não subiu", async () => {
    mockUploadBase64.mockRejectedValueOnce(new Error("storage offline"))

    const { data } = await post({
      items: [item({ id: "off_1700000000_cccc", photoBase64: "data:image/jpeg;base64,AAAA" })],
    })

    expect(data).toMatchObject({ processed: 1, succeeded: 0, failed: 1 })
    expect(data.errors[0]).toMatchObject({ id: "off_1700000000_cccc", error: "storage offline" })
  })

  it("rejeita lote vazio com 400 (Zod)", async () => {
    const { res } = await post({ items: [] })
    expect(res.status).toBe(400)
  })

  it("rejeita lote acima do máximo com 400", async () => {
    const items = Array.from({ length: 21 }, (_, i) =>
      item({ id: `off_1700000000_${String(i).padStart(4, "0")}` }),
    )
    const { res } = await post({ items })
    expect(res.status).toBe(400)
  })

  it("exige autenticação (401)", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const { res } = await post({ items: [item()] })
    expect(res.status).toBe(401)
  })

  it("recusa cliente comum com 403", async () => {
    const { requireUser } = await import("@/lib/auth")
    vi.mocked(requireUser).mockResolvedValueOnce({ userId: "client-1", role: "CLIENT" } as never)

    const { res } = await post({ items: [item()] })
    expect(res.status).toBe(403)
  })
})
