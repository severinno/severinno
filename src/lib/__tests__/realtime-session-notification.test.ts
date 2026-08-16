/**
 * Tests for mini-services/realtime/session-notification.ts
 *
 * Quando o limite de sessões derruba um socket antigo, o realtime persiste uma
 * notificação in-app (type SESSION_LIMIT) na tabela Notification — a mesma que
 * o /api/notifications do app lê para o sino. O pool é duck-typed e injetado,
 * então estes testes nunca tocam pg.
 *
 * Cobre:
 *   - SQL insere na tabela "Notification" com type SESSION_LIMIT e read=false
 *   - Retorna { id, createdAt } quando o insert tem RETURNING
 *   - Fail-open: sem pool / loader throw / query reject → null (kick não quebra)
 *   - Título/corpo humanizados (padrão BOOKING_CREATED)
 */

import { describe, it, expect, vi } from "vitest"
import {
  SESSION_LIMIT_NOTIFICATION_SQL,
  SESSION_LIMIT_TYPE,
  SESSION_LIMIT_TITLE,
  SESSION_LIMIT_BODY,
  createSessionLimitNotifier,
} from "../../../mini-services/realtime/session-notification"
import type { PoolLike, PoolLoader } from "../../../mini-services/realtime/booking-participant"

type MockPool = PoolLike & { query: ReturnType<typeof vi.fn> }

function fakePool(
  rows: Array<Record<string, unknown>> | null = [
    { id: "n-1", createdAt: "2026-08-16T10:00:00.000Z" },
  ],
): MockPool {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: rows?.length ?? 0, rows }),
  } as unknown as MockPool
}

function loader(pool: PoolLike | null): PoolLoader {
  return () => Promise.resolve(pool)
}

describe("SESSION_LIMIT_NOTIFICATION_SQL", () => {
  it("insere na tabela Notification com type SESSION_LIMIT e read=false", () => {
    expect(SESSION_LIMIT_NOTIFICATION_SQL).toContain('INSERT INTO "Notification"')
    expect(SESSION_LIMIT_NOTIFICATION_SQL).toContain('"userId"')
    expect(SESSION_LIMIT_NOTIFICATION_SQL).toContain('"type"')
    expect(SESSION_LIMIT_NOTIFICATION_SQL).toContain("read")
    expect(SESSION_LIMIT_NOTIFICATION_SQL).toContain("false")
    expect(SESSION_LIMIT_NOTIFICATION_SQL).toContain('RETURNING "id", "createdAt"')
    // 6 parâmetros ÚNICOS: id, userId, type, title, body, now — createdAt e
    // updatedAt reutilizam $6 (por isso 7 ocorrências no SQL, 6 placeholders).
    const params = new Set(SESSION_LIMIT_NOTIFICATION_SQL.match(/\$(\d+)/g) ?? [])
    expect(params.size).toBe(6)
  })

  it("expõe título/corpo humanizados no padrão BOOKING_CREATED", () => {
    expect(SESSION_LIMIT_TYPE).toBe("SESSION_LIMIT")
    expect(SESSION_LIMIT_TITLE).toBe("Sua sessão foi encerrada em outro dispositivo")
    expect(SESSION_LIMIT_BODY.length).toBeGreaterThan(10)
  })
})

describe("createSessionLimitNotifier", () => {
  it("insere a notificação e retorna { id, createdAt } do RETURNING", async () => {
    const pool = fakePool()
    const notify = createSessionLimitNotifier(loader(pool))
    const result = await notify("user-1")

    expect(result).toEqual({ id: "n-1", createdAt: "2026-08-16T10:00:00.000Z" })
    expect(pool.query).toHaveBeenCalledTimes(1)
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toBe(SESSION_LIMIT_NOTIFICATION_SQL)
    // [id, userId, type, title, body, now]
    expect(values?.[1]).toBe("user-1")
    expect(values?.[2]).toBe("SESSION_LIMIT")
    expect(values?.[3]).toBe(SESSION_LIMIT_TITLE)
    expect(values?.[4]).toBe(SESSION_LIMIT_BODY)
  })

  it("retorna null quando o INSERT não devolve rows (fail-open)", async () => {
    const notify = createSessionLimitNotifier(loader(fakePool(null)))
    await expect(notify("user-1")).resolves.toBeNull()
  })

  it("fail-open: retorna null quando o pool loader retorna null (sem DATABASE_URL)", async () => {
    const notify = createSessionLimitNotifier(loader(null))
    await expect(notify("user-1")).resolves.toBeNull()
  })

  it("fail-open: retorna null quando o pool loader lança", async () => {
    const notify = createSessionLimitNotifier(() => {
      throw new Error("pool init failed")
    })
    await expect(notify("user-1")).resolves.toBeNull()
  })

  it("fail-open: retorna null quando a query rejeita", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as PoolLike
    const notify = createSessionLimitNotifier(loader(pool))
    await expect(notify("user-1")).resolves.toBeNull()
  })

  it("falha-open nunca lança mesmo com payload inválido", async () => {
    const pool = fakePool([{ id: "x" }]) // sem createdAt
    const notify = createSessionLimitNotifier(loader(pool))
    const result = await notify("user-1")
    expect(result?.id).toBe("x")
    expect(typeof result?.createdAt).toBe("string") // fallback now
  })
})
