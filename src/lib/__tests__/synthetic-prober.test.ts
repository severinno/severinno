import { describe, it, expect, vi, beforeEach } from "vitest"
import { runSyntheticProbe } from "@/lib/synthetic-prober"
import { db } from "@/lib/db"
import { AlertingService } from "@/lib/alerting-service"

const { mockRedisStore } = vi.hoisted(() => ({
  mockRedisStore: new Map<string, any>(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: { count: vi.fn().mockResolvedValue(100) },
    $queryRaw: vi.fn().mockResolvedValue([{ extname: "postgis" }]),
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    mockRedisStore.set(key, val)
  }),
  cacheInvalidate: vi.fn(async (key: string) => {
    mockRedisStore.delete(key)
  }),
  ensureConnected: vi.fn().mockResolvedValue({
    set: vi.fn(async (key: string, val: string) => {
      mockRedisStore.set(key, val)
      return "OK"
    }),
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      mockRedisStore.delete(key)
      return 1
    }),
  }),
  activeTier: "standalone",
}))

vi.mock("@/lib/alerting-service", () => ({
  AlertingService: {
    reportOutage: vi.fn().mockResolvedValue(undefined),
  },
}))

describe("synthetic-prober", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisStore.clear()
  })

  it("retorna PASS quando todas as fases da transação sintética têm sucesso", async () => {
    const report = await runSyntheticProbe()

    expect(report.status).toBe("PASS")
    expect(report.phases.database.status).toBe("PASS")
    expect(report.phases.redis.status).toBe("PASS")
    expect(report.phases.escrowOtp.status).toBe("PASS")
    expect(report.phases.geoDistance.status).toBe("PASS")
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0)
    expect(report.warnings).toHaveLength(0)
  })

  it("retorna FAIL e aciona AlertingService quando o PostgreSQL falha", async () => {
    vi.mocked(db.user.count).mockRejectedValueOnce(new Error("Connection terminated"))

    const report = await runSyntheticProbe()

    expect(report.status).toBe("FAIL")
    expect(report.phases.database.status).toBe("FAIL")
    expect(AlertingService.reportOutage).toHaveBeenCalledWith(
      "SyntheticProber",
      expect.stringContaining("PostgreSQL indisponível"),
    )
  })
})
