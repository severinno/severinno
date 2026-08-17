import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHmac } from "node:crypto"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Use vi.hoisted to avoid hoisting issues with vi.mock()
const { mockDb, cookieStore, mockCacheStore } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  cookieStore: new Map<string, { value: string }>(),
  // Store em memória da camada de cache — mock determinístico do ../redis.
  // O ioredis global do vitest.setup NÃO é stateful (get sempre resolve
  // null), então um cacheSet+cacheGet reais nunca veriam a chave: o cacheGet
  // real tem a regra "Redis respondeu null → não cai na memória", e o tier
  // mockado fica "disponível mas vazio" — a chave escrita pelo cacheSet
  // ficaria invisível (falso negativo no dedupe cross-instância). O mock
  // replica o contrato (JSON + TTL) para os testes do dedupe multi-réplica
  // serem determinísticos.
  mockCacheStore: new Map<string, { value: string; expiresAt: number | null }>(),
}))

vi.mock("../db", () => ({
  default: mockDb,
  db: mockDb,
}))

vi.mock("../redis", () => ({
  cacheGet: async <T>(key: string): Promise<T | null> => {
    const item = mockCacheStore.get(key)
    if (!item) return null
    if (item.expiresAt !== null && item.expiresAt < Date.now()) {
      mockCacheStore.delete(key)
      return null
    }
    try {
      return JSON.parse(item.value) as T
    } catch {
      mockCacheStore.delete(key)
      return null
    }
  },
  cacheSet: async (key: string, value: unknown, ttl?: number): Promise<void> => {
    const expiresAt = ttl !== undefined && ttl > 0 ? Date.now() + ttl * 1000 : null
    mockCacheStore.set(key, { value: JSON.stringify(value), expiresAt })
  },
  cacheInvalidate: async (pattern: string): Promise<void> => {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1)
      for (const key of mockCacheStore.keys()) {
        if (key.startsWith(prefix)) mockCacheStore.delete(key)
      }
    } else {
      mockCacheStore.delete(pattern)
    }
  },
}))

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieStore.get(name) ?? null,
    set: (name: string, value: string, _opts?: Record<string, unknown>) => {
      cookieStore.set(name, { value })
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  }),
  headers: () => new Headers(),
}))

// destroySession now emits a realtime revocation (logout → disconnect
// sockets). Mock the bridge so unit tests never hit the network.
// DEFAULT: entrega CONFIRMADA (true) — o dedupe de Map/chave Redis só se
// comporta como produção quando o emit resolve ok; testes de falha usam
// mockResolvedValueOnce(false) para exercitar o rollback.
vi.mock("../realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(true),
}))

import {
  createSession,
  getSession,
  getSessionExpiresAt,
  verifySessionCookieValue,
  destroySession,
  revokeUserSessions,
  requireUser,
  requireRole,
  getOptionalSession,
  resolveCookieMaxAgeSeconds,
  parseCookieMaxAgePerRole,
  resolveCookieMaxAgeForRole,
} from "../auth"
import { emitRealtime } from "../realtime-client"
import { cacheGet, cacheSet } from "../redis"

const VALID_USER = {
  id: "user-1",
  email: "test@test.com",
  name: "Test User",
  role: "CLIENT",
  active: true,
  verified: true,
}

/**
 * Assina um cookie de sessão com o MESMO HMAC do app (formato real
 * `${userId}.${role}.${expiresAt}.${signatureHex}`) para cenários de
 * TTL expirado / janela de rotação. expiresAtSec default = 0 (expirado).
 */
function signValidCookie(userId: string, role: string, expiresAtSec = 0): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error("SESSION_SECRET não configurado no env de teste")
  const payload = `${userId}.${role}.${expiresAtSec}`
  const signature = createHmac("sha256", secret).update(payload).digest("hex")
  return `${payload}.${signature}`
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
  mockCacheStore.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("resolveCookieMaxAgeSeconds (env SESSION_COOKIE_MAX_AGE_SECONDS)", () => {
  const THIRTY_DAYS = 60 * 60 * 24 * 30

  it("returns the configured TTL when valid (>= 60s)", () => {
    expect(resolveCookieMaxAgeSeconds("120")).toBe(120)
    expect(resolveCookieMaxAgeSeconds("604800")).toBe(604800) // 7 dias
    expect(resolveCookieMaxAgeSeconds("3600")).toBe(3600)
  })

  it("uses the 30d default for missing/empty/non-numeric", () => {
    expect(resolveCookieMaxAgeSeconds(undefined)).toBe(THIRTY_DAYS)
    expect(resolveCookieMaxAgeSeconds("")).toBe(THIRTY_DAYS)
    expect(resolveCookieMaxAgeSeconds("abc")).toBe(THIRTY_DAYS)
    expect(resolveCookieMaxAgeSeconds("2d")).toBe(THIRTY_DAYS)
  })

  it("uses the default for '0' (falsy) — um cookie sem TTL quebraria a sessão", () => {
    expect(resolveCookieMaxAgeSeconds("0")).toBe(THIRTY_DAYS)
  })

  it("uses the default for non-finite values (Infinity quebraria o maxAge do cookie)", () => {
    expect(resolveCookieMaxAgeSeconds("1e309")).toBe(THIRTY_DAYS)
  })

  it("clamps sub-minute values to 60s (TTL < 1min é patológico)", () => {
    expect(resolveCookieMaxAgeSeconds("15")).toBe(60)
    expect(resolveCookieMaxAgeSeconds("-10")).toBe(60)
    expect(resolveCookieMaxAgeSeconds("1")).toBe(60)
  })
})

describe("parseCookieMaxAgePerRole (env SESSION_COOKIE_MAX_AGE_PER_ROLE)", () => {
  it("parses a valid JSON map of role → TTL seconds", () => {
    expect(
      parseCookieMaxAgePerRole('{"CLIENT":1296000,"PROVIDER":2592000,"ADMIN":604800}'),
    ).toEqual({ CLIENT: 1296000, PROVIDER: 2592000, ADMIN: 604800 })
  })

  it("normalizes roles to UPPERCASE and tolerates quoted numbers", () => {
    expect(parseCookieMaxAgePerRole('{"client":"1296000","provider":"2592000"}')).toEqual({
      CLIENT: 1296000,
      PROVIDER: 2592000,
    })
  })

  it("drops invalid entries (non-numeric, <= 0, non-finite)", () => {
    expect(
      parseCookieMaxAgePerRole('{"CLIENT":1296000,"PROVIDER":"abc","ADMIN":0,"X":-5}'),
    ).toEqual({ CLIENT: 1296000 })
  })

  it("clamps sub-minute values to 60s", () => {
    expect(parseCookieMaxAgePerRole('{"CLIENT":15}')).toEqual({ CLIENT: 60 })
  })

  it("returns undefined for missing/empty/invalid JSON or {} (fallback ao global)", () => {
    expect(parseCookieMaxAgePerRole(undefined)).toBeUndefined()
    expect(parseCookieMaxAgePerRole("")).toBeUndefined()
    expect(parseCookieMaxAgePerRole("not-json")).toBeUndefined()
    expect(parseCookieMaxAgePerRole("{}")).toBeUndefined()
  })
})

describe("resolveCookieMaxAgeForRole (override por role → fallback global)", () => {
  const perRole = { CLIENT: 1296000, PROVIDER: 2592000, ADMIN: 604800 }
  const fallback = 60 * 60 * 24 * 30

  it("uses the role override when present (case-insensitive)", () => {
    expect(resolveCookieMaxAgeForRole("CLIENT", perRole, fallback)).toBe(1296000)
    expect(resolveCookieMaxAgeForRole("provider", perRole, fallback)).toBe(2592000)
  })

  it("falls back to the global TTL when the role has no override", () => {
    expect(resolveCookieMaxAgeForRole("SUPPORT", perRole, fallback)).toBe(fallback)
    expect(resolveCookieMaxAgeForRole(undefined, perRole, fallback)).toBe(fallback)
  })

  it("falls back when perRole is undefined (env ausente)", () => {
    expect(resolveCookieMaxAgeForRole("CLIENT", undefined, fallback)).toBe(fallback)
  })

  it("ignores per-role overrides below 60s (fallback ao global)", () => {
    expect(resolveCookieMaxAgeForRole("CLIENT", { CLIENT: 15 }, fallback)).toBe(fallback)
  })

  it("clamps the fallback to >= 60s (misconfig nunca quebra a sessão)", () => {
    expect(resolveCookieMaxAgeForRole("SUPPORT", perRole, 15)).toBe(60)
  })
})

describe("createSession", () => {
  it("creates a session with valid format", async () => {
    const session = await createSession("user-1", "CLIENT")
    expect(session).toHaveProperty("userId", "user-1")
    expect(session).toHaveProperty("role", "CLIENT")
    expect(session).toHaveProperty("expiresAt")
    // expiresAt is in SECONDS (Unix timestamp), Date.now() is in milliseconds
    expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) - 10)
  })

  it("creates session for PROVIDER and ADMIN roles", async () => {
    const p = await createSession("prov-1", "PROVIDER")
    expect(p.role).toBe("PROVIDER")

    const a = await createSession("admin-1", "ADMIN")
    expect(a.role).toBe("ADMIN")
  })

  it("sets cookie readable by getSession", async () => {
    await createSession("user-1", "CLIENT")
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-1")
  })
})

describe("verifySessionCookieValue — parser puro (sem side effects)", () => {
  const DAY = 24 * 60 * 60

  it("devolve userId/role/expiresAt para um cookie VÁLIDO", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 20 * DAY
    const parsed = verifySessionCookieValue(signValidCookie("parse-user-1", "CLIENT", expiresAt))
    expect(parsed).not.toBeNull()
    expect(parsed!.userId).toBe("parse-user-1")
    expect(parsed!.role).toBe("CLIENT")
    expect(parsed!.expiresAt).toBe(expiresAt)
  })

  it("retorna null para assinatura adulterada (sem validar expiração — parser puro)", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 20 * DAY
    const good = signValidCookie("parse-user-2", "CLIENT", expiresAt)
    const tampered = good.split(".").slice(0, 3).join(".") + ".badbeef"
    expect(verifySessionCookieValue(tampered)).toBeNull()
  })

  it("retorna null para formato inválido (< 4 partes)", () => {
    expect(verifySessionCookieValue("a.b.c")).toBeNull()
    expect(verifySessionCookieValue("")).toBeNull()
  })

  it("retorna null para expiresAt não-finito", () => {
    expect(verifySessionCookieValue(signValidCookie("parse-user-3", "CLIENT", NaN))).toBeNull()
  })
})

describe("getSessionExpiresAt — leitura SSR-safe (RSC, sem reemitir cookie)", () => {
  const DAY = 24 * 60 * 60
  const THIRTY_DAYS = 60 * 60 * 24 * 30

  it("devolve o expiresAt do cookie quando fora da janela de rotação", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 20 * DAY
    cookieStore.set("severinno_session", {
      value: signValidCookie("ssr-user-1", "CLIENT", expiresAt),
    })
    expect(await getSessionExpiresAt()).toBe(expiresAt)
  })

  it("ESPELHA a rotação (<15d) sem reemitir: devolve now + COOKIE_MAX_AGE (30d)", async () => {
    const old = Math.floor(Date.now() / 1000) + 10 * DAY // 10d restantes < 15d
    cookieStore.set("severinno_session", {
      value: signValidCookie("ssr-user-2", "CLIENT", old),
    })
    const value = await getSessionExpiresAt()
    expect(value).not.toBeNull()
    // O valor inicial já é o refresh de 30d — igual ao que o getSession
    // devolveria ao reemitir; sem isso o countdown saltaria 10d → 30d.
    expect(value!).toBeGreaterThan(old + 15 * DAY)
    expect(value!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + THIRTY_DAYS + 2)
  })

  it("retorna null sem cookie", async () => {
    expect(await getSessionExpiresAt()).toBeNull()
  })

  it("retorna null para cookie adulterado", async () => {
    cookieStore.set("severinno_session", { value: "ssr-user-3.CLIENT.999999.deadbeef" })
    expect(await getSessionExpiresAt()).toBeNull()
  })

  it("retorna null para cookie expirado", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ssr-user-4", "CLIENT", 0) })
    expect(await getSessionExpiresAt()).toBeNull()
  })
})

describe("getSession", () => {
  it("returns null when no cookie exists", async () => {
    expect(await getSession()).toBeNull()
  })

  it("returns session data for valid cookie", async () => {
    await createSession("user-1", "CLIENT")
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-1")
    expect(session!.role).toBe("CLIENT")
  })

  it("exposes the cookie expiresAt (for the dashboard countdown)", async () => {
    const before = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60 // 20d restantes
    cookieStore.set("severinno_session", { value: signValidCookie("exp-user-1", "CLIENT", before) })
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session!.expiresAt).toBe(before)
  })

  it("exposes the NEW expiresAt after rotation (reissue <15d)", async () => {
    const old = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60 // 10d restantes < 15d
    cookieStore.set("severinno_session", { value: signValidCookie("exp-user-2", "CLIENT", old) })
    const session = await getSession()
    expect(session).not.toBeNull()
    // O expiry efetivo é o NOVO (30d do momento da reemissão), não o antigo.
    expect(session!.expiresAt).toBeGreaterThan(old + 15 * 24 * 60 * 60)
  })

  it("returns null for tampered cookie", async () => {
    await createSession("user-1", "CLIENT")
    const existing = cookieStore.get("severinno_session")
    if (existing) {
      cookieStore.set("severinno_session", {
        value: existing.value.split(".").slice(0, 3).join(".") + ".BAD",
      })
    }
    expect(await getSession()).toBeNull()
  })

  it("returns null for expired cookie", async () => {
    await createSession("user-1", "CLIENT")
    const existing = cookieStore.get("severinno_session")
    if (existing) {
      const parts = existing.value.split(".")
      if (parts.length >= 3) {
        parts[2] = "0"
        cookieStore.set("severinno_session", { value: parts.join(".") })
      }
    }
    expect(await getSession()).toBeNull()
  })
})

describe("getSession — TTL-expiry realtime revocation", () => {
  // ATENÇÃO (footgun): os Maps de dedupe do auth.ts (expiredRevokeEmittedAt /
  // sessionRenewedAt) são module-level e NÃO resetam no beforeEach — cada
  // teste precisa de userIds DISTINTOS (ttl-user-* / rot-user-*), senão a
  // janela de 1h suprime o emit silenciosamente.
  it("emits session:revoke when a validly-signed cookie expired by TTL", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ttl-user-1", "CLIENT") })
    expect(await getSession()).toBeNull()
    // Fire-and-forget (void) — aguarda a cadeia assíncrona completar.
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-1" })
    })
  })

  it("dedupes repeated getSession with the same expired cookie (1 emit/hour)", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ttl-user-2", "CLIENT") })
    await getSession()
    await getSession()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-2" })
    })
  })

  it("does not emit session:revoke for a valid (non-expired) cookie", async () => {
    await createSession("ttl-user-3", "CLIENT")
    expect(await getSession()).not.toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("does not emit session:revoke for a tampered cookie (signature mismatch)", async () => {
    cookieStore.set("severinno_session", { value: "ttl-user-4.CLIENT.0.deadbeef" })
    expect(await getSession()).toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("emits independently per userId (no cross-user suppression)", async () => {
    cookieStore.set("severinno_session", { value: signValidCookie("ttl-user-5", "CLIENT") })
    await getSession()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "ttl-user-5" })
    })
  })
})

describe("getSession — rotação de cookie (<15d) → session:renew", () => {
  // Constrói um cookie com assinatura VÁLIDA (mesmo HMAC do app) mas com
  // expiresAt DENTRO da janela de rotação (menos de 15d restantes) — o
  // cenário "cookie reemitido" que precisa propagar o novo expiry ao realtime
  // para o sweep de TTL não fechar uma sessão reemitida válida.
  // userIds DISTINTOS (rot-user-*) por teste: Map module-level não reseta.
  const TEN_DAYS = 10 * 24 * 60 * 60 // 10d restantes < threshold de 15d

  it("emits session:renew com o NOVO expiresAt quando o cookie é reemitido (<15d restantes)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const oldExpiresAt = nowSec + TEN_DAYS
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-1", "CLIENT", oldExpiresAt),
    })
    expect(await getSession()).not.toBeNull()
    // Fire-and-forget (void) — aguarda a cadeia assíncrona completar.
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledTimes(1)
      expect(emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId: "rot-user-1",
        expiresAt: expect.any(Number),
      })
    })
    // O novo expiresAt é um refresh de 30d — muito além do expiry original
    // (10d restantes): a sessão reemitida NÃO pode ser fechada pelo sweep.
    const payload = vi.mocked(emitRealtime).mock.calls[0]![1] as { expiresAt: number }
    expect(payload.expiresAt).toBeGreaterThan(oldExpiresAt + 15 * 24 * 60 * 60)
  })

  it("dedupe: getSession repetido com cookie reemitível → 1 emit session:renew (janela 1h)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-2", "CLIENT", nowSec + TEN_DAYS),
    })
    await getSession()
    await getSession()
    await vi.waitFor(() => {
      const renewCalls = vi
        .mocked(emitRealtime)
        .mock.calls.filter(([event]) => event === "session:renew")
      expect(renewCalls).toHaveLength(1)
    })
  })

  it("não emite session:renew para cookie com >15d restantes (fora da janela de rotação)", async () => {
    await createSession("rot-user-3", "CLIENT") // 30d restantes
    expect(await getSession()).not.toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("não emite session:renew para cookie expirado (esse caminho emite session:revoke)", async () => {
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-4", "CLIENT", 0),
    })
    expect(await getSession()).toBeNull()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "rot-user-4" })
    })
    // NUNCA session:renew no caminho de expiração (só revoke).
    const renewCalls = vi
      .mocked(emitRealtime)
      .mock.calls.filter(([event]) => event === "session:renew")
    expect(renewCalls).toHaveLength(0)
  })

  it("não emite session:renew para cookie com assinatura inválida (tampered)", async () => {
    cookieStore.set("severinno_session", { value: "rot-user-5.CLIENT.999999.deadbeef" })
    expect(await getSession()).toBeNull()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("emite independentemente por userId (sem supressão cross-user)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("rot-user-6", "CLIENT", nowSec + TEN_DAYS),
    })
    expect(await getSession()).not.toBeNull()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId: "rot-user-6",
        expiresAt: expect.any(Number),
      })
    })
  })
})

describe("session:renew — dedupe multi-réplica (chave Redis realtime:renewed:{userId})", () => {
  const TEN_DAYS = 10 * 24 * 60 * 60

  it("entrega CONFIRMADA reivindica a chave Redis (TTL 1h) — dedupe cross-instância", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const userId = "multi-renew-ok"
    cookieStore.set("severinno_session", {
      value: signValidCookie(userId, "CLIENT", nowSec + TEN_DAYS),
    })
    vi.mocked(emitRealtime).mockResolvedValue(true)
    expect(await getSession()).not.toBeNull()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId,
        expiresAt: expect.any(Number),
      })
    })
    // Só após a entrega confirmada a chave compartilhada é reivindicada — uma
    // 2ª réplica (Map vazio) veria a chave e pularia o emit.
    await vi.waitFor(async () => {
      const claimed = await cacheGet<number>(`realtime:renewed:${userId}`)
      expect(claimed).not.toBeNull()
    })
  })

  it("entrega FALHA NÃO reivindica a chave — outra réplica retentaria (não perde renew)", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const userId = "multi-renew-fail"
    cookieStore.set("severinno_session", {
      value: signValidCookie(userId, "CLIENT", nowSec + TEN_DAYS),
    })
    vi.mocked(emitRealtime).mockResolvedValueOnce(false)
    expect(await getSession()).not.toBeNull()
    await vi.waitFor(() => {
      expect(emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId,
        expiresAt: expect.any(Number),
      })
    })
    // A chave NÃO foi reivindicada (emit falhou): a próxima réplica — ou o
    // próximo request, já que o Map in-process foi rollbackado — retentaria.
    // Sem este fix, a chave seria setada mesmo com o emit falho e silenciaria
    // TODAS as réplicas por 1h (o renew se perderia até o sweep matar a
    // sessão reemitida válida).
    expect(await cacheGet<number>(`realtime:renewed:${userId}`)).toBeNull()
  })

  it("réplica com Map vazio vê a chave Redis reivindicada por OUTRA réplica e NÃO reemite", async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const userId = "multi-renew-b"
    // Simula a réplica A que JÁ entregou o renew: a chave compartilhada está
    // reivindicada (TTL 1h). A réplica B (Map de memória vazio — outro
    // processo) consulta o Redis e PULA o emit — o renew é idempotente, o
    // primeiro que entrega vence. Sem perda: os sockets já foram estendidos.
    await cacheSet(`realtime:renewed:${userId}`, nowSec, 3600)
    cookieStore.set("severinno_session", {
      value: signValidCookie(userId, "CLIENT", nowSec + TEN_DAYS),
    })
    expect(await getSession()).not.toBeNull()
    const renewCalls = vi.mocked(emitRealtime).mock.calls.filter(([e]) => e === "session:renew")
    expect(renewCalls).toHaveLength(0)
  })

  it("TTL-expiry revoke: chave realtime:revoked:expired:{userId} reivindicada por OUTRA réplica → não reemite", async () => {
    const userId = "multi-revoke-b"
    // Réplica A já revogou (chave reivindicada) — a réplica B pula o emit.
    await cacheSet(`realtime:revoked:expired:${userId}`, Date.now(), 3600)
    cookieStore.set("severinno_session", { value: signValidCookie(userId, "CLIENT", 0) })
    expect(await getSession()).toBeNull()
    const revokeCalls = vi.mocked(emitRealtime).mock.calls.filter(([e]) => e === "session:revoke")
    expect(revokeCalls).toHaveLength(0)
  })
})

describe("destroySession", () => {
  it("clears the session cookie", async () => {
    await createSession("user-1", "CLIENT")
    expect(await getSession()).not.toBeNull()
    await destroySession()
    expect(await getSession()).toBeNull()
  })

  it("emits session:revoke with the logged-in userId (logout → realtime disconnect)", async () => {
    await createSession("user-1", "CLIENT")
    await destroySession()
    expect(emitRealtime).toHaveBeenCalledTimes(1)
    expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "user-1" })
  })

  it("does not emit session:revoke when there is no active session", async () => {
    await destroySession()
    expect(emitRealtime).not.toHaveBeenCalled()
  })

  it("does not emit session:revoke when the cookie was tampered", async () => {
    cookieStore.set("severinno_session", { value: "tampered.value.here.bad" })
    await destroySession()
    expect(emitRealtime).not.toHaveBeenCalled()
  })
})

describe("revokeUserSessions", () => {
  it("emits session:revoke for the given userId (admin deactivation/delete)", async () => {
    await revokeUserSessions("user-42")
    expect(emitRealtime).toHaveBeenCalledTimes(1)
    expect(emitRealtime).toHaveBeenCalledWith("session:revoke", { userId: "user-42" })
  })

  it("emits for any user without needing a session cookie (admin flow)", async () => {
    await revokeUserSessions("some-other-user")
    expect(emitRealtime).toHaveBeenCalledTimes(1)
    expect(emitRealtime).toHaveBeenCalledWith("session:revoke", {
      userId: "some-other-user",
    })
  })
})

describe("requireUser", () => {
  it("returns session for valid authenticated user", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    const session = await requireUser()
    expect(session.userId).toBe("user-1")
    expect(session.role).toBe("CLIENT")
  })

  it("throws UNAUTHORIZED when no session exists", async () => {
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })

  it("throws UNAUTHORIZED when user is not active", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue({ ...VALID_USER, active: false })
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })

  it("throws UNAUTHORIZED when user not found in DB", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })
})

describe("requireRole", () => {
  it("passes when role matches", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    const session = await requireRole("CLIENT")
    expect(session.role).toBe("CLIENT")
  })

  it("throws FORBIDDEN when role does not match", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    await expect(requireRole("ADMIN")).rejects.toThrow("FORBIDDEN")
    await expect(requireRole("PROVIDER")).rejects.toThrow("FORBIDDEN")
  })

  it("throws UNAUTHORIZED when not logged in", async () => {
    await expect(requireRole("CLIENT")).rejects.toThrow("UNAUTHORIZED")
  })
})

describe("demo accounts — server-side block (defense-in-depth)", () => {
  it("trata conta demo como inativa em produção (invalida sessão existente)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await createSession("demo-admin-prod", "ADMIN")
    mockDb.user.findUnique.mockResolvedValue({
      ...VALID_USER,
      id: "demo-admin-prod",
      email: "admin@severinno.com",
      role: "ADMIN",
    })
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED")
  })

  it("permite conta demo fora de produção", async () => {
    vi.stubEnv("NODE_ENV", "test")
    await createSession("demo-admin-dev", "ADMIN")
    mockDb.user.findUnique.mockResolvedValue({
      ...VALID_USER,
      id: "demo-admin-dev",
      email: "admin@severinno.com",
      role: "ADMIN",
    })
    const session = await requireUser()
    expect(session.userId).toBe("demo-admin-dev")
  })
})

describe("getOptionalSession", () => {
  it("returns session for valid user", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue(VALID_USER)
    const session = await getOptionalSession()
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-1")
  })

  it("returns null without throwing when not logged in", async () => {
    expect(await getOptionalSession()).toBeNull()
  })

  it("returns null without throwing when user is inactive", async () => {
    await createSession("user-1", "CLIENT")
    mockDb.user.findUnique.mockResolvedValue({ ...VALID_USER, active: false })
    expect(await getOptionalSession()).toBeNull()
  })

  it("returns null without throwing when cookie is invalid", async () => {
    cookieStore.set("severinno_session", { value: "bad.format.data" })
    expect(await getOptionalSession()).toBeNull()
  })
})

// =========================================================================
// TTLs por role (env estruturada SESSION_COOKIE_MAX_AGE_PER_ROLE)
//
// O módulo auth.ts lê COOKIE_MAX_AGE_PER_ROLE no BOOT (process.env), então a
// integração usa o padrão do env.test.ts: vi.resetModules() + process.env
// setado + import dinâmico — cada teste ganha uma instância FRESCA do módulo
// com o env desejado (CLIENT 15d / PROVIDER 30d / ADMIN 7d). Os mocks do
// arquivo (vi.mock hoisted) reaplicam no re-import; a instância dinâmica usa
// os MESMOS cookieStore/mockCacheStore hoisted, então os dedupe por Map e a
// rotação funcionam como nos describes estáticos. O import estático do topo
// continua apontando para a instância ORIGINAL (env sem per-role → global
// 30d) — os describes existentes não são afetados.
// =========================================================================
describe("TTL por role — createSession/getSession/getSessionExpiresAt (env estruturada)", () => {
  const DAY = 24 * 60 * 60
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...ORIG_ENV,
      SESSION_COOKIE_MAX_AGE_PER_ROLE: JSON.stringify({
        CLIENT: 15 * DAY, // 15d
        PROVIDER: 30 * DAY, // 30d
        ADMIN: 7 * DAY, // 7d
      }),
    }
  })

  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  it("createSession assina o expiresAt com o TTL da role (CLIENT 15d, PROVIDER 30d, ADMIN 7d)", async () => {
    const mod = await import("../auth")
    const nowSec = Math.floor(Date.now() / 1000)

    const client = await mod.createSession("role-client-1", "CLIENT")
    const provider = await mod.createSession("role-prov-1", "PROVIDER")
    const admin = await mod.createSession("role-admin-1", "ADMIN")

    // Deltas: ~15d / ~30d / ~7d (o expiresAt é agora + TTL da role).
    expect(client.expiresAt! - nowSec).toBeGreaterThan(14 * DAY)
    expect(client.expiresAt! - nowSec).toBeLessThanOrEqual(15 * DAY + 2)
    expect(provider.expiresAt! - nowSec).toBeGreaterThan(29 * DAY)
    expect(provider.expiresAt! - nowSec).toBeLessThanOrEqual(30 * DAY + 2)
    expect(admin.expiresAt! - nowSec).toBeGreaterThan(6 * DAY)
    expect(admin.expiresAt! - nowSec).toBeLessThanOrEqual(7 * DAY + 2)
  })

  it("rotação por role: CLIENT com 10d restantes NÃO rotaciona (TTL 15d → threshold 7.5d)", async () => {
    const mod = await import("../auth")
    // A instância DINÂMICA usa o mock fresh do realtime-client (o import
    // estático do topo aponta para o mock ORIGINAL — não pode ser usado aqui).
    const rt = await import("../realtime-client")
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("role-rot-1", "CLIENT", nowSec + 10 * DAY),
    })
    expect(await mod.getSession()).not.toBeNull()
    // 10d > 7.5d (metade do TTL CLIENT 15d) → NENHUMA rotação disparada.
    const renewCalls = vi.mocked(rt.emitRealtime).mock.calls.filter(([e]) => e === "session:renew")
    expect(renewCalls).toHaveLength(0)
  })

  it("rotação por role: PROVIDER com 10d restantes rotaciona (TTL 30d → threshold 15d)", async () => {
    const mod = await import("../auth")
    const rt = await import("../realtime-client")
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("role-rot-2", "PROVIDER", nowSec + 10 * DAY),
    })
    expect(await mod.getSession()).not.toBeNull()
    // 10d < 15d (metade do TTL PROVIDER 30d) → rotaciona com o refresh do
    // TTL da role (30d), não do global.
    await vi.waitFor(() => {
      expect(rt.emitRealtime).toHaveBeenCalledWith("session:renew", {
        userId: "role-rot-2",
        expiresAt: expect.any(Number),
      })
    })
    const payload = vi
      .mocked(rt.emitRealtime)
      .mock.calls.find(([e]) => e === "session:renew")?.[1] as { expiresAt: number }
    expect(payload.expiresAt).toBeGreaterThan(nowSec + 25 * DAY)
    expect(payload.expiresAt).toBeLessThanOrEqual(nowSec + 30 * DAY + 2)
  })

  it("getSessionExpiresAt espelha o refresh com o TTL da role (PROVIDER 10d → +30d)", async () => {
    const mod = await import("../auth")
    const nowSec = Math.floor(Date.now() / 1000)
    cookieStore.set("severinno_session", {
      value: signValidCookie("role-ssr-1", "PROVIDER", nowSec + 10 * DAY),
    })
    const value = await mod.getSessionExpiresAt()
    expect(value).not.toBeNull()
    // Espelho SSR: now + TTL da role (30d), sem reemitir cookie (RSC-safe).
    expect(value!).toBeGreaterThan(nowSec + 25 * DAY)
    expect(value!).toBeLessThanOrEqual(nowSec + 30 * DAY + 2)
  })
})
