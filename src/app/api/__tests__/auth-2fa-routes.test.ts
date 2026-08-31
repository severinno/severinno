import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    general: { prefix: "general", max: 30, windowMs: 60000 },
    login: { prefix: "login", max: 5, windowMs: 60000 },
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let _mockSession: any = null

vi.mock("@/lib/auth", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw new Error("UNAUTHORIZED")
    return s
  }),
}))

vi.mock("@/lib/totp", () => ({
  generateSecret: vi.fn().mockReturnValue("MOCKSECRETBASE32"),
  generateTOTPUri: vi.fn().mockReturnValue("otpauth://totp/Severinno:user%40example.com?secret=MOCKSECRETBASE32&issuer=Severinno"),
  verifyTOTP: vi.fn().mockReturnValue(true),
  generateBackupCodes: vi.fn().mockReturnValue(["12345678", "87654321", "11111111", "22222222", "33333333", "44444444", "55555555", "66666666"]),
  hashBackupCodes: vi.fn().mockReturnValue('["hashed-1","hashed-2"]'),
  verifyBackupCodeFromStore: vi.fn().mockReturnValue({ valid: true, updatedCodes: '["hashed-2"]' }),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as setup } from "../auth/2fa/setup/route"
import { POST as enable } from "../auth/2fa/enable/route"
import { POST as disable } from "../auth/2fa/disable/route"
import { POST as verify } from "../auth/2fa/verify/route"
import { POST as backupCodes } from "../auth/2fa/backup-codes/route"
import { GET as status } from "../auth/2fa/status/route"
import { createSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { verifyTOTP, verifyBackupCodeFromStore, generateSecret, generateTOTPUri, generateBackupCodes, hashBackupCodes } from "@/lib/totp"
import { cacheGet, cacheInvalidate } from "@/lib/redis"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-1",
  email: "user@example.com",
  role: "CLIENT",
  sessionVersion: 0,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  twoFactorBackupCodes: null,
} as any

const mockUserWith2FA = {
  ...mockUser,
  twoFactorEnabled: true,
  twoFactorSecret: "MOCKSECRETBASE32",
  twoFactorBackupCodes: '["hashed-1","hashed-2"]',
} as any

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/2fa/setup", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    ;(vi.mocked(db.user.update) as any).mockReset()
    _mockSession = null
  })

  it("generates TOTP secret and returns URI on first setup", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({})

    const res = await setup(createMockRequest({ method: "POST" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("uri")
    expect(generateSecret).toHaveBeenCalled()
    expect(generateTOTPUri).toHaveBeenCalledWith("MOCKSECRETBASE32", "user@example.com")
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorSecret: "MOCKSECRETBASE32" },
    })
  })

  it("returns only uri, not the secret", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({})

    const res = await setup(createMockRequest({ method: "POST" }))
    const parsed = await parseResponse(res)

    expect(parsed.body).not.toHaveProperty("secret")
    expect(parsed.body).toHaveProperty("uri")
  })

  it("returns 400 when 2FA is already enabled", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await setup(createMockRequest({ method: "POST" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("já está ativada")
  })

  it("returns 404 when user not found", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await setup(createMockRequest({ method: "POST" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(404)
  })

  it("returns 401 when not authenticated", async () => {
    _mockSession = null

    const res = await setup(createMockRequest({ method: "POST" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
  })
})

describe("POST /api/auth/2fa/enable", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    ;(vi.mocked(db.user.update) as any).mockReset()
    _mockSession = null
    vi.mocked(verifyTOTP).mockReturnValue(true)
  })

  it("enables 2FA and returns backup codes with valid TOTP", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      ...mockUser,
      twoFactorSecret: "MOCKSECRETBASE32",
    })
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({})

    const res = await enable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).backupCodes).toEqual([
      "12345678", "87654321", "11111111", "22222222",
      "33333333", "44444444", "55555555", "66666666",
    ])
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: '["hashed-1","hashed-2"]',
      },
    })
  })

  it("returns 400 for invalid TOTP code", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    vi.mocked(verifyTOTP).mockReturnValue(false)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      ...mockUser,
      twoFactorSecret: "MOCKSECRETBASE32",
    })

    const res = await enable(
      createMockRequest({ method: "POST", body: { code: "000000" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("inválido")
  })

  it("returns 400 when no prior setup (no secret)", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)

    const res = await enable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("setup")
  })

  it("returns 400 when 2FA is already enabled", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await enable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("já está ativada")
  })

  it("returns 400 for missing code", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }

    const res = await enable(createMockRequest({ method: "POST", body: {} }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
  })

  it("returns 404 when user not found", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await enable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(404)
  })
})

describe("POST /api/auth/2fa/verify", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    ;(vi.mocked(db.user.update) as any).mockReset()
    ;(vi.mocked(cacheGet) as any).mockReset()
    ;(vi.mocked(cacheInvalidate) as any).mockReset()
    _mockSession = null
    vi.mocked(verifyTOTP).mockReturnValue(true)
    vi.mocked(verifyBackupCodeFromStore).mockReturnValue({ valid: true, updatedCodes: '["hashed-2"]' })
  })

  it("grants access with correct TOTP code", async () => {
    ;(vi.mocked(cacheGet) as any).mockResolvedValue({ userId: "user-1", role: "CLIENT" })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await verify(
      createMockRequest({
        method: "POST",
        body: { tempToken: "temp-abc", code: "123456" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).user.id).toBe("user-1")
    expect(cacheInvalidate).toHaveBeenCalledWith("auth:2fa:temp:temp-abc")
    expect(createSession).toHaveBeenCalledWith("user-1", "CLIENT", 0)
  })

  it("grants access with correct backup code", async () => {
    ;(vi.mocked(cacheGet) as any).mockResolvedValue({ userId: "user-1", role: "CLIENT" })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await verify(
      createMockRequest({
        method: "POST",
        body: { tempToken: "temp-abc", code: "87654321", isBackupCode: true },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect(verifyBackupCodeFromStore).toHaveBeenCalledWith(
      "87654321",
      mockUserWith2FA.twoFactorBackupCodes,
    )
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorBackupCodes: '["hashed-2"]' },
    })
  })

  it("returns 401 for wrong TOTP code", async () => {
    ;(vi.mocked(cacheGet) as any).mockResolvedValue({ userId: "user-1", role: "CLIENT" })
    vi.mocked(verifyTOTP).mockReturnValue(false)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await verify(
      createMockRequest({
        method: "POST",
        body: { tempToken: "temp-abc", code: "000000" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
    expect((parsed.body as any).error).toContain("inválido")
  })

  it("returns 401 for wrong backup code", async () => {
    ;(vi.mocked(cacheGet) as any).mockResolvedValue({ userId: "user-1", role: "CLIENT" })
    vi.mocked(verifyBackupCodeFromStore).mockReturnValue({ valid: false, updatedCodes: '["hashed-1","hashed-2"]' })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await verify(
      createMockRequest({
        method: "POST",
        body: { tempToken: "temp-abc", code: "00000000", isBackupCode: true },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
  })

  it("returns 400 for expired/missing temp token", async () => {
    ;(vi.mocked(cacheGet) as any).mockResolvedValue(null)

    const res = await verify(
      createMockRequest({
        method: "POST",
        body: { tempToken: "expired-token", code: "123456" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("expirado")
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  it("returns 400 for missing tempToken", async () => {
    const res = await verify(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
  })

  it("returns 400 for missing code", async () => {
    const res = await verify(
      createMockRequest({ method: "POST", body: { tempToken: "temp-abc" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
  })

  it("invalidates temp token before verification (one-time use)", async () => {
    ;(vi.mocked(cacheGet) as any).mockResolvedValue({ userId: "user-1", role: "CLIENT" })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    await verify(
      createMockRequest({
        method: "POST",
        body: { tempToken: "temp-abc", code: "123456" },
      }),
    )

    expect(cacheInvalidate).toHaveBeenCalledWith("auth:2fa:temp:temp-abc")
  })
})

describe("POST /api/auth/2fa/backup-codes", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    ;(vi.mocked(db.user.update) as any).mockReset()
    _mockSession = null
    vi.mocked(verifyTOTP).mockReturnValue(true)
  })

  it("regenerates backup codes with valid TOTP", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({})

    const res = await backupCodes(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).backupCodes).toEqual([
      "12345678", "87654321", "11111111", "22222222",
      "33333333", "44444444", "55555555", "66666666",
    ])
    expect(generateBackupCodes).toHaveBeenCalled()
    expect(hashBackupCodes).toHaveBeenCalled()
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorBackupCodes: '["hashed-1","hashed-2"]' },
    })
  })

  it("returns 400 for invalid TOTP code", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    vi.mocked(verifyTOTP).mockReturnValue(false)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await backupCodes(
      createMockRequest({ method: "POST", body: { code: "000000" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("inválido")
  })

  it("returns 400 when 2FA is not enabled", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)

    const res = await backupCodes(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("não está ativada")
  })

  it("returns 400 for missing code", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }

    const res = await backupCodes(createMockRequest({ method: "POST", body: {} }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
  })

  it("returns 404 when user not found", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await backupCodes(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(404)
  })
})

describe("POST /api/auth/2fa/disable", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    ;(vi.mocked(db.user.update) as any).mockReset()
    _mockSession = null
    vi.mocked(verifyTOTP).mockReturnValue(true)
  })

  it("disables 2FA and clears secret with valid TOTP", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)
    ;(vi.mocked(db.user.update) as any).mockResolvedValue({})

    const res = await disable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      },
    })
  })

  it("returns 400 for invalid TOTP code", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    vi.mocked(verifyTOTP).mockReturnValue(false)
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUserWith2FA)

    const res = await disable(
      createMockRequest({ method: "POST", body: { code: "000000" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("inválido")
  })

  it("returns 400 when 2FA is not enabled", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(mockUser)

    const res = await disable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("não está ativada")
  })

  it("returns 400 for missing code", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }

    const res = await disable(createMockRequest({ method: "POST", body: {} }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
  })

  it("returns 404 when user not found", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await disable(
      createMockRequest({ method: "POST", body: { code: "123456" } }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(404)
  })
})

describe("GET /api/auth/2fa/status", () => {
  beforeEach(() => {
    ;(vi as any).clearAllMocks()
    ;(vi.mocked(db.user.findUnique) as any).mockReset()
    _mockSession = null
  })

  it("returns twoFactorEnabled: false when 2FA is disabled", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      twoFactorEnabled: false,
    })

    const res = await status(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual({ twoFactorEnabled: false })
  })

  it("returns twoFactorEnabled: true when 2FA is enabled", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      twoFactorEnabled: true,
    })

    const res = await status(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual({ twoFactorEnabled: true })
  })

  it("returns 404 when user not found", async () => {
    _mockSession = { userId: "user-1", role: "CLIENT" }
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await status(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(404)
  })

  it("returns 401 when not authenticated", async () => {
    _mockSession = null

    const res = await status(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
  })
})
