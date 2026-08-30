import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue("PONG"),
  })),
  getCacheStats: vi.fn(() => ({
    hits: 100,
    misses: 20,
    hitRatio: 0.83,
  })),
}));

vi.mock("@/lib/metrics", () => ({
  exportMetrics: vi.fn(() => ({
    requests: { total: 1000, errors: 5, rate: 10 },
  })),
}));

vi.mock("@/lib/db-query-monitor", () => ({
  getSlowQueryMetrics: vi.fn(() => ({
    total: 3,
    avgDuration: 250,
    queries: [],
  })),
}));

vi.mock("@/lib/error-budget", () => ({
  getErrorBudget: vi.fn(() => ({
    budget: 0.995,
    consumed: 0.002,
    remaining: 0.993,
    status: "healthy",
  })),
}));

vi.mock("@/lib/geo-metrics", () => ({
  getGeoMetrics: vi.fn(() => ({
    totalRequests: 500,
    cacheHits: 400,
    fallbackRate: 0.05,
    avgLatency: 45,
  })),
}));

// Mock circuit breakers
const mockGetStats = vi.fn(() => ({
  state: "closed",
  failures: 0,
  successes: 100,
  lastFailure: null,
}));

vi.mock("@/lib/geo-circuit-breakers", () => ({
  nominatimBreaker: { getStats: mockGetStats },
  viacepBreaker: { getStats: mockGetStats },
  osrmBreaker: { getStats: mockGetStats },
  osrmTableBreaker: { getStats: mockGetStats },
}));

vi.mock("@/lib/external-circuit-breakers", () => ({
  evolutionBreaker: { getStats: mockGetStats },
  pushBreaker: { getStats: mockGetStats },
  emailBreaker: { getStats: mockGetStats },
}));

describe("GET /api/health/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with healthy status when DB and Redis are up", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.services.database.status).toBe("healthy");
    expect(body.services.redis.status).toBe("healthy");
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.timestamp).toBeTruthy();
  });

  it("returns 503 when DB is down", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.services.database.status).toBe("unhealthy");
  });

  it("includes circuit breaker stats for all 7 breakers", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(body.circuitBreakers.geo.nominatim).toBeDefined();
    expect(body.circuitBreakers.geo.viacep).toBeDefined();
    expect(body.circuitBreakers.geo.osrm).toBeDefined();
    expect(body.circuitBreakers.geo.osrmTable).toBeDefined();
    expect(body.circuitBreakers.external.evolution).toBeDefined();
    expect(body.circuitBreakers.external.push).toBeDefined();
    expect(body.circuitBreakers.external.email).toBeDefined();
  });

  it("includes error budget", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(body.errorBudget).toBeDefined();
    expect(body.errorBudget.budget).toBe(0.995);
  });

  it("includes cache stats", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(body.cache).toBeDefined();
    expect(body.cache.hits).toBe(100);
  });

  it("includes geo metrics", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();
    const body = await response.json();

    expect(body.geo).toBeDefined();
    expect(body.geo.totalRequests).toBe(500);
  });

  it("sets Cache-Control: no-store", async () => {
    const { db } = await import("@/lib/db");
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/dashboard/route");
    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
