import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET, PATCH } from "../provider/onboarding/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/provider/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", role: "PROVIDER" })
  })

  it("returns step 0 when no onboarding data exists", async () => {
    ;(vi.mocked(db.setting.findUnique) as any).mockResolvedValue(null)

    const _req = createMockRequest({ method: "GET" })
    const res = await GET()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.step).toBe(0)
    expect(parsed.body!.done).toBe(false)
  })

  it("returns saved step when onboarding data exists", async () => {
    ;(vi.mocked(db.setting.findUnique) as any).mockResolvedValue({
      key: "onboarding:user-1",
      value: JSON.stringify({ step: 3, done: false }),
    })

    const res = await GET()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.step).toBe(3)
    expect(parsed.body!.done).toBe(false)
  })

  it("returns done=true when onboarding is complete", async () => {
    ;(vi.mocked(db.setting.findUnique) as any).mockResolvedValue({
      key: "onboarding:user-1",
      value: JSON.stringify({ step: 5, done: true }),
    })

    const res = await GET()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.step).toBe(5)
    expect(parsed.body!.done).toBe(true)
  })
})

describe("PATCH /api/provider/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "user-1", role: "PROVIDER" })
  })

  it("updates onboarding step", async () => {
    vi.mocked(db.setting.upsert).mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "PATCH",
      body: { step: 2 },
    })
    const res = await PATCH(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.ok).toBe(true)
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "onboarding:user-1" },
      create: { key: "onboarding:user-1", value: JSON.stringify({ step: 2, done: false }) },
      update: { value: JSON.stringify({ step: 2, done: false }) },
    })
  })

  it("completes onboarding when done=true", async () => {
    vi.mocked(db.setting.upsert).mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "PATCH",
      body: { step: 5, done: true },
    })
    await PATCH(req)

    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "onboarding:user-1" },
      create: { key: "onboarding:user-1", value: JSON.stringify({ step: 5, done: true }) },
      update: { value: JSON.stringify({ step: 5, done: true }) },
    })
  })

  it("defaults step to 0 when not provided", async () => {
    vi.mocked(db.setting.upsert).mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "PATCH",
      body: { done: true },
    })
    await PATCH(req)

    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "onboarding:user-1" },
      create: { key: "onboarding:user-1", value: JSON.stringify({ step: 0, done: true }) },
      update: { value: JSON.stringify({ step: 0, done: true }) },
    })
  })
})
