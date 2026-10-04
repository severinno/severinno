import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as getOnboarding, PATCH as patchOnboarding } from "@/app/api/provider/onboarding/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

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

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

const USER_ID = "u-123"

function patchRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/provider/onboarding", {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

describe("GET /api/provider/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: USER_ID, role: "PROVIDER" } as never)
  })

  it("sem registro salvo devolve o default (step 0, done false)", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)

    const res = await getOnboarding(new Request("http://localhost:3000/api/provider/onboarding"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ step: 0, done: false })
  })

  it("lê o progresso salvo", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: `onboarding:${USER_ID}`,
      value: JSON.stringify({ step: 3, done: false }),
    } as never)

    const res = await getOnboarding(new Request("http://localhost:3000/api/provider/onboarding"))

    expect(await res.json()).toEqual({ step: 3, done: false })
  })
})

describe("PATCH /api/provider/onboarding — merge com progresso salvo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: USER_ID, role: "PROVIDER" } as never)
    vi.mocked(db.setting.upsert).mockResolvedValue({} as never)
  })

  it("PATCH parcial só com { step } PRESERVA done=true já salvo (bug do reset)", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: `onboarding:${USER_ID}`,
      value: JSON.stringify({ step: 4, done: true }),
    } as never)

    const res = await patchOnboarding(patchRequest({ step: 2 }))

    expect(res.status).toBe(200)
    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: `onboarding:${USER_ID}` },
        update: { value: JSON.stringify({ step: 2, done: true }) },
      }),
    )
  })

  it("PATCH parcial sem registro anterior começa com done=false", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue(null)

    await patchOnboarding(patchRequest({ step: 2 }))

    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: `onboarding:${USER_ID}`, value: JSON.stringify({ step: 2, done: false }) },
      }),
    )
  })

  it("PATCH com done explícito continua sobrescrevendo", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: `onboarding:${USER_ID}`,
      value: JSON.stringify({ step: 4, done: true }),
    } as never)

    await patchOnboarding(patchRequest({ step: 1, done: false }))

    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: JSON.stringify({ step: 1, done: false }) },
      }),
    )
  })

  it("conclusão do wizard ({ step, done: true }) persiste intacta", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: `onboarding:${USER_ID}`,
      value: JSON.stringify({ step: 3, done: false }),
    } as never)

    await patchOnboarding(patchRequest({ step: 4, done: true }))

    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: JSON.stringify({ step: 4, done: true }) },
      }),
    )
  })

  it("registro corrompido (JSON inválido) cai no default seguro em vez de quebrar", async () => {
    vi.mocked(db.setting.findUnique).mockResolvedValue({
      key: `onboarding:${USER_ID}`,
      value: "not-json{{{",
    } as never)

    await patchOnboarding(patchRequest({}))

    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: JSON.stringify({ step: 0, done: false }) },
      }),
    )
  })
})
