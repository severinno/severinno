/**
 * realtime-orphan-sockets.test.ts
 *
 * Unit tests for `selectOrphanSockets` (mini-services/realtime/security.ts) —
 * the pure classification of sockets for the admin "revoke orphans" sweep:
 *   - TTL-expired session (cookie expiresAt in the past) → `expired`
 *   - userId no longer in the DB (via the injected isUserAlive checker) →
 *     `missingUser`
 *   - sockets without a session are never selected
 *   - async isUserAlive (pg-backed) is awaited before the result is complete
 */

import { describe, it, expect, vi } from "vitest"
import {
  selectOrphanSockets,
  type OrphanSweepSocketLike,
} from "../../../mini-services/realtime/security"

function socket(
  id: string,
  session?: { userId: string; role?: string; expiresAt?: number },
): OrphanSweepSocketLike {
  // role é OBRIGATÓRIA no VerifiedSession — o selector só consome
  // userId/expiresAt, mas o tipo exige role (preenche com "CLIENT").
  return {
    id,
    data: { session: session ? { role: "CLIENT", ...session } : null },
  }
}

const NOW_MS = Date.parse("2026-08-16T12:00:00.000Z")

describe("selectOrphanSockets", () => {
  it("seleciona sockets com sessão TTL expirada como expired (sem checar o DB)", async () => {
    const sockets = [
      socket("s1", { userId: "u-expired", expiresAt: NOW_MS / 1000 - 60 }),
      socket("s2", { userId: "u-live", expiresAt: NOW_MS / 1000 + 3600 }),
    ]
    const alive = vi.fn().mockResolvedValue(true)

    const res = await selectOrphanSockets(sockets, NOW_MS, alive)

    expect(res.expired.map((s) => s.id)).toEqual(["s1"])
    expect(res.missingUser).toEqual([])
    expect(res.toRevoke.map((s) => s.id)).toEqual(["s1"])
    // O expirado não é consultado no DB — só o live.
    expect(alive).toHaveBeenCalledTimes(1)
    expect(alive).toHaveBeenCalledWith("u-live")
    expect(res.userIdsToCheck).toEqual(["u-live"])
  })

  it("seleciona sockets cujo userId não existe no banco como missingUser", async () => {
    const sockets = [
      socket("s1", { userId: "u-ghost", expiresAt: NOW_MS / 1000 + 3600 }),
      socket("s2", { userId: "u-real", expiresAt: NOW_MS / 1000 + 3600 }),
    ]
    const alive = vi.fn(async (userId: string) => userId !== "u-ghost")

    const res = await selectOrphanSockets(sockets, NOW_MS, alive)

    expect(res.missingUser.map((s) => s.id)).toEqual(["s1"])
    expect(res.toRevoke.map((s) => s.id)).toEqual(["s1"])
    expect(res.userIdsToCheck.sort()).toEqual(["u-ghost", "u-real"])
  })

  it("nunca seleciona sockets sem sessão (não dá para julgar presença)", async () => {
    const sockets = [socket("s-null"), socket("s2", { userId: "u-real" })]
    const alive = vi.fn().mockResolvedValue(true)

    const res = await selectOrphanSockets(sockets, NOW_MS, alive)

    expect(res.expired).toEqual([])
    expect(res.missingUser).toEqual([])
    expect(res.toRevoke).toEqual([])
    expect(res.userIdsToCheck).toEqual(["u-real"])
  })

  it("async isUserAlive é aguardado — o resultado está completo (não race)", async () => {
    const sockets = [
      socket("s1", { userId: "u-slow", expiresAt: NOW_MS / 1000 + 3600 }),
      socket("s2", { userId: "u-live", expiresAt: NOW_MS / 1000 + 3600 }),
    ]
    // Resolve de forma defasada (simula o round-trip do pg).
    let resolveSlow!: (v: boolean) => void
    const alive = vi.fn((userId: string) =>
      userId === "u-slow" ? new Promise<boolean>((r) => (resolveSlow = r)) : Promise.resolve(true),
    )

    const pending = selectOrphanSockets(sockets, NOW_MS, alive)
    resolveSlow(false) // u-slow não existe → deve virar missingUser
    const res = await pending

    expect(res.missingUser.map((s) => s.id)).toEqual(["s1"])
    expect(res.toRevoke.map((s) => s.id)).toEqual(["s1"])
  })

  it("sincrono isUserAlive também funciona (boolean puro)", async () => {
    const sockets = [socket("s1", { userId: "u-ghost", expiresAt: NOW_MS / 1000 + 3600 })]
    const res = await selectOrphanSockets(sockets, NOW_MS, (userId) => userId !== "u-ghost")

    expect(res.missingUser.map((s) => s.id)).toEqual(["s1"])
    expect(res.toRevoke.map((s) => s.id)).toEqual(["s1"])
  })

  it("expired e missingUser não duplicam sockets em toRevoke (mesmo socket não entra 2x)", async () => {
    const sockets = [
      socket("s1", { userId: "u-expired", expiresAt: NOW_MS / 1000 - 60 }),
      socket("s2", { userId: "u-ghost", expiresAt: NOW_MS / 1000 + 3600 }),
    ]
    const alive = vi.fn(async (userId: string) => userId !== "u-ghost")

    const res = await selectOrphanSockets(sockets, NOW_MS, alive)

    expect(res.toRevoke.map((s) => s.id).sort()).toEqual(["s1", "s2"])
    expect(new Set(res.toRevoke.map((s) => s.id)).size).toBe(2)
  })
})
