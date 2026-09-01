import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  withCache: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
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
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw new Error("UNAUTHORIZED")
    return s
  }),
  createSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/totp", () => ({
  generateSecret: vi.fn().mockReturnValue("JBSWY3DPEHPK3PXP"),
  generateTOTPUri: vi
    .fn()
    .mockReturnValue("otpauth://totp/test:user@example.com?secret=JBSWY3DPEHPK3PXP"),
  verifyTOTP: vi.fn().mockReturnValue(true),
  generateBackupCodes: vi.fn().mockReturnValue(["AAAA-BBBB", "CCCC-DDDD"]),
  hashBackupCodes: vi.fn().mockReturnValue("hashed:backup:codes"),
  verifyBackupCodeFromStore: vi
    .fn()
    .mockReturnValue({ valid: true, updatedCodes: "hashed:remaining" }),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as setup } from "../auth/2fa/setup/route"
import { POST as enable } from "../auth/2fa/enable/route"
import { POST as verify2fa } from "../auth/2fa/verify/route"
import { POST as disable } from "../auth/2fa/disable/route"
import { POST as backupCodes } from "../auth/2fa/backup-codes/route"
import { GET as status } from "../auth/2fa/status/route"
import { db } from "@/lib/db"
import { verifyTOTP, verifyBackupCodeFromStore } from "@/lib/totp"
import { cacheGet, cacheInvalidate } from "@/lib/redis"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/2fa/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "user-1", role: "CLIENT" }
  })

  it("returns URI on first setup", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      twoFactorEnabled: false,
    })

    const res = await setup(createMockRequest({ method: "POST" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).uri).toContain("otpauth://totp/")
    // Must NOT expose raw secret
    expect(parsed.body as any).not.toHaveProperty("secret")
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorSecret: "JBSWY3DPEHPK3PXP" },
    })
  })

  it("returns 400 if 2FA already enabled", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      twoFactorEnabled: true,
    })

    const res = await setup(createMockRequest({ method: "POST" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 if user not found", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await setup(createMockRequest({ method: "POST" }))
    expect(res.status).toBe(404)
  })
})

describe("POST /api/auth/2fa/enable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "user-1", role: "CLIENT" }
  })

  it("enables 2FA and returns backup codes on valid code", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })

    const res = await enable(createMockRequest({ method: "POST", body: { code: "123456" } }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).backupCodes).toEqual(["AAAA-BBBB", "CCCC-DDDD"])
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: "hashed:backup:codes",
      },
    })
  })

  it("returns 400 if no code provided", async () => {
    const res = await enable(createMockRequest({ method: "POST", body: {} }))
    expect(res.status).toBe(400)
  })

  it("returns 400 if already enabled", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })

    const res = await enable(createMockRequest({ method: "POST", body: { code: "123456" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 if no secret (setup not done)", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorSecret: null,
    })

    const res = await enable(createMockRequest({ method: "POST", body: { code: "123456" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on invalid TOTP code", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })
    vi.mocked(verifyTOTP).mockReturnValueOnce(false)

    const res = await enable(createMockRequest({ method: "POST", body: { code: "000000" } }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/2fa/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("creates session on valid TOTP code", async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce({ userId: "user-1", role: "CLIENT" })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      role: "CLIENT",
      sessionVersion: 0,
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
      twoFactorBackupCodes: null,
    })

    const res = await verify2fa(
      createMockRequest({
        method: "POST",
        body: { tempToken: "tok-123", code: "123456" },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect(cacheInvalidate).toHaveBeenCalled()
  })

  it("returns 400 on expired temp token", async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce(null)

    const res = await verify2fa(
      createMockRequest({
        method: "POST",
        body: { tempToken: "expired", code: "123456" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 401 on invalid code", async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce({ userId: "user-1", role: "CLIENT" })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      role: "CLIENT",
      sessionVersion: 0,
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
      twoFactorBackupCodes: null,
    })
    vi.mocked(verifyTOTP).mockReturnValueOnce(false)

    const res = await verify2fa(
      createMockRequest({
        method: "POST",
        body: { tempToken: "tok-123", code: "000000" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("creates session on valid backup code", async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce({ userId: "user-1", role: "CLIENT" })
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      role: "CLIENT",
      sessionVersion: 0,
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
      twoFactorBackupCodes: "hashed:codes",
    })

    const res = await verify2fa(
      createMockRequest({
        method: "POST",
        body: { tempToken: "tok-123", code: "AAAA-BBBB", isBackupCode: true },
      }),
    )
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorBackupCodes: "hashed:remaining" },
    })
  })

  it("returns 400 if missing tempToken", async () => {
    const res = await verify2fa(createMockRequest({ method: "POST", body: { code: "123456" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 if missing code", async () => {
    const res = await verify2fa(
      createMockRequest({ method: "POST", body: { tempToken: "tok-123" } }),
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/2fa/disable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "user-1", role: "CLIENT" }
  })

  it("disables 2FA on valid code", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })

    const res = await disable(createMockRequest({ method: "POST", body: { code: "123456" } }))
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

  it("returns 400 if 2FA not enabled", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorSecret: null,
    })

    const res = await disable(createMockRequest({ method: "POST", body: { code: "123456" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on invalid code", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })
    vi.mocked(verifyTOTP).mockReturnValueOnce(false)

    const res = await disable(createMockRequest({ method: "POST", body: { code: "000000" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 if no code provided", async () => {
    const res = await disable(createMockRequest({ method: "POST", body: {} }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/auth/2fa/backup-codes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "user-1", role: "CLIENT" }
  })

  it("regenerates backup codes on valid TOTP", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })

    const res = await backupCodes(createMockRequest({ method: "POST", body: { code: "123456" } }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).backupCodes).toEqual(["AAAA-BBBB", "CCCC-DDDD"])
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorBackupCodes: "hashed:backup:codes" },
    })
  })

  it("returns 400 if 2FA not enabled", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorSecret: null,
    })

    const res = await backupCodes(createMockRequest({ method: "POST", body: { code: "123456" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on invalid TOTP", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
    })
    vi.mocked(verifyTOTP).mockReturnValueOnce(false)

    const res = await backupCodes(createMockRequest({ method: "POST", body: { code: "000000" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 if no code provided", async () => {
    const res = await backupCodes(createMockRequest({ method: "POST", body: {} }))
    expect(res.status).toBe(400)
  })
})

describe("GET /api/auth/2fa/status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = { userId: "user-1", role: "CLIENT" }
  })

  it("returns twoFactorEnabled: true", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      twoFactorEnabled: true,
    })

    const res = await status(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).twoFactorEnabled).toBe(true)
  })

  it("returns twoFactorEnabled: false", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue({
      twoFactorEnabled: false,
    })

    const res = await status(createMockRequest())
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).twoFactorEnabled).toBe(false)
  })

  it("returns 404 if user not found", async () => {
    ;(vi.mocked(db.user.findUnique) as any).mockResolvedValue(null)

    const res = await status(createMockRequest())
    expect(res.status).toBe(404)
  })
})
