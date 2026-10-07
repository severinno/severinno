/**
 * Testes de src/lib/auth-rate-limit.ts — escada progressiva por fingerprint.
 *
 * O cache (@/lib/redis) é mockado com um Map real em memória para exercitar
 * a acumulação de falhas; o fingerprint é fixado para viabilizar as
 * contagens. Atrasos são medidos com relógio real (escada em ms — barato).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Map em memória compartilhado entre o mock e os testes
const store = new Map<string, { value: unknown }>()

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async <T>(key: string): Promise<T | null> => {
    const hit = store.get(key)
    return hit ? (hit.value as T) : null
  }),
  cacheSet: vi.fn(async (key: string, value: unknown) => {
    store.set(key, { value })
  }),
  cacheInvalidate: vi.fn(async () => undefined),
}))

vi.mock("@/lib/rate-limit-shared", () => ({
  getCompositeFingerprint: vi.fn(() => "1.2.3.4:fpfixo"),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  authFingerprintGuard,
  delayForAttempt,
  fingerprintKey,
  HARD_LIMIT,
} from "../auth-rate-limit"

function request(): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
  })
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe("delayForAttempt — escada exponencial", () => {
  it("primeiras 3 tentativas não têm atraso", () => {
    expect(delayForAttempt(0)).toBe(0)
    expect(delayForAttempt(1)).toBe(0)
    expect(delayForAttempt(2)).toBe(0)
  })

  it("a partir da 4ª dobra: 0.5s, 1s, 2s, 4s…", () => {
    expect(delayForAttempt(3)).toBe(500)
    expect(delayForAttempt(4)).toBe(1000)
    expect(delayForAttempt(5)).toBe(2000)
    expect(delayForAttempt(6)).toBe(4000)
  })

  it("tem teto de 8s", () => {
    expect(delayForAttempt(7)).toBe(8000)
    expect(delayForAttempt(8)).toBe(8000)
    expect(delayForAttempt(50)).toBe(8000)
  })
})

describe("fingerprintKey", () => {
  it("prefixa o namespace auth:fp:", () => {
    expect(fingerprintKey("login:1.2.3.4:x")).toBe("auth:fp:login:1.2.3.4:x")
  })
})

describe("authFingerprintGuard — fluxo normal", () => {
  it("primeira tentativa: sem bloqueio e sem chamada de sleep", async () => {
    const sleep = vi.spyOn(global, "setTimeout")
    const guard = await authFingerprintGuard(request(), "login")

    expect(guard.blocked).toBe(false)
    expect(guard.response).toBeNull()
    expect(sleep).not.toHaveBeenCalled()
    sleep.mockRestore()
  })

  it("recordFailure acumula na janela com TTL de 600s", async () => {
    const guard = await authFingerprintGuard(request(), "login")
    await guard.recordFailure()

    const { cacheSet } = await import("@/lib/redis")
    expect(cacheSet).toHaveBeenCalledWith(
      "auth:fp:login:1.2.3.4:fpfixo",
      { hits: [expect.any(Number)] },
      600,
    )
  })

  it("sucesso não registra nada (chamada de recordFailure é opt-in)", async () => {
    await authFingerprintGuard(request(), "login")
    // não chamamos recordFailure
    const { cacheSet } = await import("@/lib/redis")
    expect(cacheSet).not.toHaveBeenCalled()
  })
})

describe("authFingerprintGuard — escada progressiva", () => {
  // Escada RÁPIDA (base 1ms) para os loops que acumulam muitas falhas —
  // a escada real (500ms→8s) somaria ~47s e estouraria o timeout.
  const fast = { baseMs: 1, capMs: 2 } as const

  // Spy no setTimeout: asserção DETERMINÍSTICA do delay pedido — sem
  // relógio (o guard check-clock-bombs proíbe Date.now() dentro de expect,
  // com razão: bound de tempo real é flaky sob CI carregado). O timer real
  // continua rodando (spy não mocka), então a 4ª prova abaixo espera os
  // 500ms de verdade.
  it("3 falhas registradas: a 4ª dorme 500ms (escada REAL)", async () => {
    const fast = { baseMs: 1, capMs: 2 } as const
    for (let i = 0; i < 3; i++) {
      const g = await authFingerprintGuard(request(), "login", fast)
      await g.recordFailure()
    }

    const sleep = vi.spyOn(global, "setTimeout")
    const guard = await authFingerprintGuard(request(), "login")

    expect(guard.blocked).toBe(false)
    expect(sleep).toHaveBeenCalledWith(expect.any(Function), 500)
    sleep.mockRestore()
  })

  it("2 falhas registradas: a 3ª NÃO dorme (tolerância)", async () => {
    for (let i = 0; i < 2; i++) {
      const g = await authFingerprintGuard(request(), "login", fast)
      await g.recordFailure()
    }
    const sleep = vi.spyOn(global, "setTimeout")
    await authFingerprintGuard(request(), "login")
    expect(sleep).not.toHaveBeenCalled()
    sleep.mockRestore()
  })

  it("scopes diferentes têm contadores independentes", async () => {
    for (let i = 0; i < 3; i++) {
      const g = await authFingerprintGuard(request(), "login", fast)
      await g.recordFailure()
    }
    // scope "register" não herda as falhas do "login"
    const sleep = vi.spyOn(global, "setTimeout")
    const guard = await authFingerprintGuard(request(), "register")
    expect(sleep).not.toHaveBeenCalled()
    expect(guard.blocked).toBe(false)
    sleep.mockRestore()
  })
})

describe("authFingerprintGuard — limite duro", () => {
  const fast = { baseMs: 1, capMs: 2 } as const

  it("acima do HARD_LIMIT responde 429 com Retry-After", async () => {
    for (let i = 0; i < HARD_LIMIT; i++) {
      const g = await authFingerprintGuard(request(), "login", fast)
      expect(g.blocked).toBe(false)
      await g.recordFailure()
    }
    const guard = await authFingerprintGuard(request(), "login", fast)

    expect(guard.blocked).toBe(true)
    expect(guard.response?.status).toBe(429)
    const retryAfter = Number(guard.response?.headers.get("Retry-After"))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(600)
  })

  it("o recordFailure do guard bloqueado é no-op (não satura mais)", async () => {
    for (let i = 0; i < HARD_LIMIT; i++) {
      const g = await authFingerprintGuard(request(), "login", fast)
      await g.recordFailure()
    }
    const guard = await authFingerprintGuard(request(), "login", fast)
    const { cacheSet } = await import("@/lib/redis")
    vi.mocked(cacheSet).mockClear()

    expect(guard.blocked).toBe(true)
    await guard.recordFailure()
    expect(cacheSet).not.toHaveBeenCalled()
  })
})

describe("authFingerprintGuard — decaimento da janela", () => {
  it("tentativas com mais de 10 min são ignoradas (sem sleep, sem 429)", async () => {
    const { cacheSet } = await import("@/lib/redis")
    // Seed manual: 5 hits "antigos" (11 min atrás)
    const old = Date.now() - 11 * 60 * 1000
    await cacheSet("auth:fp:login:1.2.3.4:fpfixo", { hits: [old, old, old, old, old] }, 600)

    const sleep = vi.spyOn(global, "setTimeout")
    const guard = await authFingerprintGuard(request(), "login")
    expect(sleep).not.toHaveBeenCalled()
    expect(guard.blocked).toBe(false)
    sleep.mockRestore()
  })
})
