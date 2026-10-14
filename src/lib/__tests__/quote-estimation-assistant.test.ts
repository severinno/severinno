import { describe, it, expect, vi, beforeEach } from "vitest"
import { calculateSmartQuoteEstimation } from "@/lib/quote-estimation-assistant"

vi.mock("@/lib/db", () => ({
  db: {
    category: {
      findMany: vi.fn().mockResolvedValue([
        { id: "cat-eletrica", name: "Elétrica", slug: "eletrica" },
        { id: "cat-hidraulica", name: "Hidráulica", slug: "hidraulica" },
        { id: "cat-pintura", name: "Pintura", slug: "pintura" },
      ]),
    },
    booking: {
      findMany: vi.fn().mockResolvedValue([{ amount: 150 }, { amount: 200 }, { amount: 250 }]),
    },
  },
}))

vi.mock("@/lib/ai-client", () => ({
  isLocalAiOnline: vi.fn().mockResolvedValue(false),
  chatCompletion: vi.fn().mockResolvedValue(null),
}))

describe("Smart Quote Estimation Assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calculates estimate and scope for electrical service with database history", async () => {
    const res = await calculateSmartQuoteEstimation({
      description: "Preciso trocar o disjuntor e arrumar tomada com faísca",
    })

    expect(res.categoryName).toBe("Elétrica")
    expect(res.priceRange.min).toBeGreaterThan(0)
    expect(res.priceRange.max).toBeGreaterThanOrEqual(res.priceRange.min)
    expect(res.materialsChecklist.length).toBeGreaterThan(0)
    expect(res.materialsChecklist).toContain("Fita isolante antichama (3M ou similar)")
    expect(res.safetyChecklist.length).toBeGreaterThan(0)
    expect(res.tipsForClient).toBeTruthy()
    expect(res.tipsForProvider).toBeTruthy()
    expect(res.source).toBe("platform-history")
  })

  it("calculates estimate and scope for plumbing service", async () => {
    const res = await calculateSmartQuoteEstimation({
      description: "Cano quebrado vazando muita água na cozinha",
    })

    expect(res.categoryName).toBe("Hidráulica")
    expect(res.problemSeverity).toBe("HIGH")
    expect(res.materialsChecklist).toContain("Fita veda-rosca de teflon alta densidade")
  })
})
