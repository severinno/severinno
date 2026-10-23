import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "../referral/leaderboard/route"

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/referral", () => ({
  getReferralLeaderboard: vi.fn().mockResolvedValue([
    {
      rank: 1,
      userId: "user-1",
      name: "Ana P.",
      avatarUrl: "https://example.com/avatar.jpg",
      convertedCount: 12,
      pointsEarned: 600,
      badge: "Embaixador Diamante",
    },
    {
      rank: 2,
      userId: "user-2",
      name: "Marcos S.",
      avatarUrl: null,
      convertedCount: 6,
      pointsEarned: 300,
      badge: "Embaixador Ouro",
    },
  ]),
}))

describe("GET /api/referral/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns community referral leaderboard", async () => {
    const req = new NextRequest("http://localhost:3000/api/referral/leaderboard?limit=10")
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(2)
    expect(json.leaderboard[0].rank).toBe(1)
    expect(json.leaderboard[0].badge).toBe("Embaixador Diamante")
  })
})
