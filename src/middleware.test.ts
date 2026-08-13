/**
 * Fail-closed contract for the Edge middleware (parecer tecnico, item
 * critico #2).
 *
 * SESSION_SECRET ausente:
 *   - producao -> 500 (fail-closed: rotas protegidas NUNCA passam sem
 *     verificacao - misconfiguration e fatal)
 *   - dev      -> fail-open historico preservado (dev local sem config)
 *
 * CRON_SECRET ausente (o mesmo padrao, sec 3 da SECURITY.md):
 *   - producao -> 500 (rotas /api/cron/* NUNCA rodam sem verificacao)
 *   - dev      -> fail-open historico preservado
 *
 * Com CRON_SECRET presente: sem Authorization -> 401, Bearer correto -> 200,
 * Bearer errado -> 401.
 *
 * Com SESSION_SECRET presente, o guard segue ativo: sem cookie -> 401,
 * cookie valido -> 200 com x-user-id/x-user-role, role errada -> 403.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { webcrypto } from "node:crypto"
import { NextRequest } from "next/server"

import { middleware } from "./middleware"

const SECRET = "s".repeat(64)

function makeRequest(path: string, cookie?: string): NextRequest {
  const headers = cookie ? { cookie } : undefined
  return new NextRequest(new Request(`http://localhost${path}`, { headers }))
}

/** Assina um cookie de sessao valido no mesmo formato de src/lib/auth.ts. */
async function signSession(
  secret: string,
  userId: string,
  role: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const payload = `${userId}.${role}.${expiresAt}`
  const encoder = new TextEncoder()
  const key = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await webcrypto.subtle.sign("HMAC", key, encoder.encode(payload))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `${payload}.${hex}`
}

describe("middleware fail-closed (SESSION_SECRET)", () => {
  beforeAll(() => {
    // jsdom nao expoe crypto.subtle - usa o webcrypto do Node para o
    // happy-path com cookie assinado. vi.stubGlobal lida com o accessor
    // getter-only do jsdom (Object.assign lancaria TypeError).
    vi.stubGlobal("crypto", webcrypto)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("producao + secret ausente + rota API protegida -> 500", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", "") // ausente (string vazia = falsy)
    const res = await middleware(makeRequest("/api/admin/dashboard"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("SESSION_SECRET")
  })

  it("producao + secret ausente + pagina protegida -> 500", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", "")
    const res = await middleware(makeRequest("/dashboard"))
    expect(res.status).toBe(500)
  })

  it("producao + secret ausente + rota de prestador -> 500", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", "")
    const res = await middleware(makeRequest("/api/provider/services"))
    expect(res.status).toBe(500)
  })

  it("dev + secret ausente + rota protegida -> fail-open historico (200)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SESSION_SECRET", "")
    const res = await middleware(makeRequest("/api/admin/dashboard"))
    expect(res.status).toBe(200)
  })

  it("producao + secret ausente + rota publica -> 200 (publica nao depende do secret)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", "")
    const res = await middleware(makeRequest("/api/health"))
    expect(res.status).toBe(200)
  })

  it("producao + secret presente + sem cookie -> 401 (guard segue ativo)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", SECRET)
    const res = await middleware(makeRequest("/api/admin/dashboard"))
    expect(res.status).toBe(401)
  })

  it("producao + secret presente + cookie valido -> 200 com x-user-id/x-user-role", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", SECRET)
    const cookie = await signSession(SECRET, "u123", "ADMIN")
    const res = await middleware(
      makeRequest("/api/admin/dashboard", `severinno_session=${cookie}`),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("x-user-id")).toBe("u123")
    expect(res.headers.get("x-user-role")).toBe("ADMIN")
  })

  it("producao + secret presente + cookie com role errada -> 403", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SESSION_SECRET", SECRET)
    const cookie = await signSession(SECRET, "u456", "CLIENT")
    const res = await middleware(
      makeRequest("/api/admin/dashboard", `severinno_session=${cookie}`),
    )
    expect(res.status).toBe(403)
  })

describe("middleware fail-closed (CRON_SECRET)", () => {
  afterAll(() => {
    vi.unstubAllEnvs()
  })
  it("producao + cron secret ausente + rota cron -> 500 (misconfiguration fatal)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "")
    const res = await middleware(makeRequest("/api/cron/settlements"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("CRON_SECRET")
  })

  it("dev + cron secret ausente + rota cron -> fail-open historico (200)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("CRON_SECRET", "")
    const res = await middleware(makeRequest("/api/cron/settlements"))
    expect(res.status).toBe(200)
  })

  it("producao + cron secret presente + sem Authorization -> 401", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "cron-secret-123")
    const res = await middleware(makeRequest("/api/cron/settlements"))
    expect(res.status).toBe(401)
  })

  it("producao + cron secret presente + Authorization errado -> 401", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "cron-secret-123")
    const req = new NextRequest(
      new Request("http://localhost/api/cron/settlements", {
        headers: { authorization: "Bearer wrong" },
      }),
    )
    const res = await middleware(req)
    expect(res.status).toBe(401)
  })

  it("producao + cron secret presente + Bearer correto -> 200", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "cron-secret-123")
    const req = new NextRequest(
      new Request("http://localhost/api/cron/settlements", {
        headers: { authorization: "Bearer cron-secret-123" },
      }),
    )
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })
})

  it("producao + cron secret ausente + rota publica -> 200 (publica nao depende do secret)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "")
    const res = await middleware(makeRequest("/api/health"))
    expect(res.status).toBe(200)
  })
})
