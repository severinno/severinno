/**
 * Tests for src/lib/idempotency.ts — proteção contra cobrança duplicada.
 *
 * Contrato verificado (ver topo do idempotency.ts):
 *   - getIdempotencyKey: extração/validação do header (ausente → null;
 *     inválido → 400 IDEMPOTENCY_KEY_INVALID).
 *   - deriveIdempotencyKey: chave server-side determinística por booking.
 *   - acquireIdempotency: fresh / replay / in_flight / failed / conflict,
 *     expiração (recria) e corrida resolvida por P2002.
 *   - completeIdempotency / failIdempotency: nunca falham a requisição
 *     original (erros de update engolidos com log).
 *   - idempotencyErrorResponse: mapeamento dos estados → 409 com code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  idempotencyRecord: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import {
  getIdempotencyKey,
  deriveIdempotencyKey,
  acquireIdempotency,
  completeIdempotency,
  failIdempotency,
  idempotencyErrorResponse,
  pruneExpiredIdempotencyRecords,
  IdempotencyError,
} from "../idempotency"

function p2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  })
}

function req(headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/test", { method: "POST", headers })
}

// ── getIdempotencyKey ──────────────────────────────────────────────────────

describe("getIdempotencyKey", () => {
  it("retorna null quando o header está ausente", () => {
    expect(getIdempotencyKey(req())).toBeNull()
  })

  it("extrai o header (case-insensitive) e faz trim", () => {
    expect(getIdempotencyKey(req({ "Idempotency-Key": "  abc-DEF_123  " }))).toBe("abc-DEF_123")
  })

  it.each([
    ["curta demais", "abc"],
    ["com caracteres inválidos", "chave@com@arrouba!"],
    ["espaço interno", "chave com espaco"],
  ])("rejeita chave %s", (_label, key) => {
    try {
      getIdempotencyKey(req({ "Idempotency-Key": key }))
      expect.unreachable("deveria ter lançado")
    } catch (e) {
      expect(e).toBeInstanceOf(IdempotencyError)
      const err = e as IdempotencyError
      expect(err.status).toBe(400)
      expect(err.code).toBe("IDEMPOTENCY_KEY_INVALID")
    }
  })

  it("aceita limites do formato: 8 e 128 chars de [A-Za-z0-9_-]", () => {
    expect(getIdempotencyKey(req({ "Idempotency-Key": "a".repeat(8) }))).toBe("a".repeat(8))
    expect(getIdempotencyKey(req({ "Idempotency-Key": "b".repeat(128) }))).toBe("b".repeat(128))
  })
})

// ── deriveIdempotencyKey ───────────────────────────────────────────────────

describe("deriveIdempotencyKey", () => {
  it("deriva chave determinística por booking no escopo default", () => {
    expect(deriveIdempotencyKey("book-1")).toBe("srv:pay:create:book-1")
    expect(deriveIdempotencyKey("book-1")).toBe(deriveIdempotencyKey("book-1"))
  })

  it("aceita escopo customizado", () => {
    expect(deriveIdempotencyKey("book-1", "webhook:lytex")).toBe("srv:webhook:lytex:book-1")
  })
})

// ── acquireIdempotency ─────────────────────────────────────────────────────

describe("acquireIdempotency", () => {
  const CTX = { bookingId: "book-1", method: "PIX", amount: 200 }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.idempotencyRecord.findUnique.mockResolvedValue(null)
    mockDb.idempotencyRecord.create.mockResolvedValue({})
    mockDb.idempotencyRecord.deleteMany.mockResolvedValue({ count: 1 })
    mockDb.idempotencyRecord.update.mockResolvedValue({})
  })

  it("fresh: reserva a chave quando não existe registro", async () => {
    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "fresh" })
    expect(mockDb.idempotencyRecord.create).toHaveBeenCalledTimes(1)
    expect(mockDb.idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "key-12345678",
        scope: "pay:create",
        context: CTX,
        status: "processing",
      }),
    })
    // expiresAt ≈ agora + 24h
    const data = mockDb.idempotencyRecord.create.mock.calls[0][0].data
    const ttl = (data.expiresAt as Date).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })

  it("replay: registro completed com mesmo contexto devolve a resposta gravada", async () => {
    const saved = { paymentMethod: "PIX", status: "PENDING", qrCode: "pix-code" }
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "pay:create",
      status: "completed",
      context: CTX,
      response: saved,
      error: null,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "replay", response: saved })
    expect(mockDb.idempotencyRecord.create).not.toHaveBeenCalled()
  })

  it("in_flight: registro processing com mesmo contexto (request simultâneo)", async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "pay:create",
      status: "processing",
      context: CTX,
      response: null,
      error: null,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "in_flight" })
    expect(mockDb.idempotencyRecord.create).not.toHaveBeenCalled()
  })

  it("failed: registro failed devolve o erro original", async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "pay:create",
      status: "failed",
      context: CTX,
      response: null,
      error: "Lytex indisponível",
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "failed", error: "Lytex indisponível" })
    expect(mockDb.idempotencyRecord.create).not.toHaveBeenCalled()
  })

  it("conflict: mesma chave usada com contexto divergente (outro booking/valor)", async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "pay:create",
      status: "completed",
      context: { bookingId: "book-OUTRO", method: "PIX", amount: 999 },
      response: { ok: true },
      error: null,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result.kind).toBe("conflict")
    if (result.kind === "conflict") {
      expect(result.reason).toContain("outra operação")
    }
    expect(mockDb.idempotencyRecord.create).not.toHaveBeenCalled()
  })

  it("conflict: mesma chave usada em outro escopo", async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "webhook:lytex",
      status: "completed",
      context: CTX,
      response: { ok: true },
      error: null,
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result.kind).toBe("conflict")
  })

  it("expirado: apaga registro vencido e recria (fresh)", async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "pay:create",
      status: "completed",
      context: CTX,
      response: { old: true },
      error: null,
      expiresAt: new Date(Date.now() - 1000), // vencido
    })

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "fresh" })
    expect(mockDb.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { key: "key-12345678", expiresAt: { lte: expect.any(Date) } },
    })
    expect(mockDb.idempotencyRecord.create).toHaveBeenCalledTimes(1)
  })

  it("corrida: P2002 no INSERT quando dois requests reservam a mesma chave → in_flight", async () => {
    // findUnique não viu o registro (perdeu a corrida), mas o create fere o @unique.
    mockDb.idempotencyRecord.findUnique.mockResolvedValue(null)
    mockDb.idempotencyRecord.create.mockRejectedValue(p2002())

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "in_flight" })
  })

  it("corrida com expiração: se o vencedor apagou o registro antes do deleteMany, P2002 ainda vira in_flight (nunca executa duas vezes)", async () => {
    mockDb.idempotencyRecord.findUnique.mockResolvedValue({
      key: "key-12345678",
      scope: "pay:create",
      status: "completed",
      context: CTX,
      response: { old: true },
      error: null,
      expiresAt: new Date(Date.now() - 1000), // vencido
    })
    // O deleteMany só apaga se ainda vencido (guard no WHERE); simulando o
    // caso em que NÃO apagou (count 0) e o create fere o unique do vencedor.
    mockDb.idempotencyRecord.deleteMany.mockResolvedValue({ count: 0 })
    mockDb.idempotencyRecord.create.mockRejectedValue(p2002())

    const result = await acquireIdempotency("key-12345678", CTX)

    expect(result).toEqual({ kind: "in_flight" })
  })

  it("erro não-P2002 no create é rethrown (não vira in_flight silencioso)", async () => {
    mockDb.idempotencyRecord.create.mockRejectedValue(new Error("connection refused"))

    await expect(acquireIdempotency("key-12345678", CTX)).rejects.toThrow("connection refused")
  })
})

// ── completeIdempotency / failIdempotency ──────────────────────────────────

describe("completeIdempotency / failIdempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.idempotencyRecord.update.mockResolvedValue({})
  })

  it("complete grava status completed + response para replay", async () => {
    await completeIdempotency("key-12345678", { paymentMethod: "PIX", status: "PENDING" })

    expect(mockDb.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { key: "key-12345678" },
      data: {
        status: "completed",
        response: { paymentMethod: "PIX", status: "PENDING" },
        error: null,
      },
    })
  })

  it("complete NUNCA falha a requisição original (update rejeitado → só loga)", async () => {
    mockDb.idempotencyRecord.update.mockRejectedValue(new Error("db down"))

    await expect(completeIdempotency("key-12345678", { ok: true })).resolves.toBeUndefined()
  })

  it("fail grava status failed + mensagem de erro", async () => {
    await failIdempotency("key-12345678", "Lytex: erro 500")

    expect(mockDb.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { key: "key-12345678" },
      data: { status: "failed", error: "Lytex: erro 500" },
    })
  })

  it("fail NUNCA falha a requisição original", async () => {
    mockDb.idempotencyRecord.update.mockRejectedValue(new Error("db down"))

    await expect(failIdempotency("key-12345678", "boom")).resolves.toBeUndefined()
  })
})

// ── idempotencyErrorResponse ───────────────────────────────────────────────

describe("idempotencyErrorResponse", () => {
  it("fresh e replay → null (a rota continua/executa o replay)", () => {
    expect(idempotencyErrorResponse({ kind: "fresh" })).toBeNull()
    expect(idempotencyErrorResponse({ kind: "replay", response: {} })).toBeNull()
  })

  it("in_flight → 409 com IDEMPOTENCY_IN_FLIGHT", () => {
    const res = idempotencyErrorResponse({ kind: "in_flight" })
    expect(res?.status).toBe(409)
    expect(res?.body.code).toBe("IDEMPOTENCY_IN_FLIGHT")
  })

  it("failed → 409 com IDEMPOTENCY_FAILED e o erro original na mensagem", () => {
    const res = idempotencyErrorResponse({ kind: "failed", error: "Lytex caiu" })
    expect(res?.status).toBe(409)
    expect(res?.body.code).toBe("IDEMPOTENCY_FAILED")
    expect(String(res?.body.error)).toContain("Lytex caiu")
  })

  it("conflict → 409 com IDEMPOTENCY_CONFLICT e o motivo", () => {
    const res = idempotencyErrorResponse({ kind: "conflict", reason: "outro booking" })
    expect(res?.status).toBe(409)
    expect(res?.body.code).toBe("IDEMPOTENCY_CONFLICT")
    expect(String(res?.body.error)).toContain("outro booking")
  })
})

// ── pruneExpiredIdempotencyRecords ─────────────────────────────────────

describe("pruneExpiredIdempotencyRecords", () => {
  beforeEach(() => {
    // Relógio congelado (check-clock-bombs): o corte da poda vira EXATO.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z"))
    mockDb.idempotencyRecord.deleteMany.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("deleteMany com expiresAt <= AGORA e devolve o count do banco", async () => {
    mockDb.idempotencyRecord.deleteMany.mockResolvedValue({ count: 42 })

    const count = await pruneExpiredIdempotencyRecords()

    expect(count).toBe(42)
    expect(mockDb.idempotencyRecord.deleteMany).toHaveBeenCalledTimes(1)
    // Corte = o AGORA congelado — exato, não janela: um registro novo (TTL
    // de 24h, expiresAt no futuro) NÃO é tocado pela poda.
    expect(mockDb.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: new Date("2026-01-05T15:00:00.000Z") } },
    })
  })

  it("PROPAGA erro do banco — quem chama decide amaciar (no cron é secundária)", async () => {
    mockDb.idempotencyRecord.deleteMany.mockRejectedValue(new Error("db down"))
    await expect(pruneExpiredIdempotencyRecords()).rejects.toThrow("db down")
  })
})
