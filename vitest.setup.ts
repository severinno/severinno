/// <reference types="vitest/globals" />
import "@testing-library/jest-dom/vitest"

// ── Mock ioredis globally (prevents "Unhandled error event" in tests) ─────
// Rate-limit and Redis modules may try to connect to a real Redis instance
// during tests. This mock prevents unhandled error events.
vi.mock("ioredis", () => {
  const MockRedis = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    setex: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue("PONG"),
    on: vi.fn(),
    disconnect: vi.fn(),
    quit: vi.fn(),
  }))
  return { default: MockRedis, Redis: MockRedis }
})

// ── Mock ResizeObserver for framer-motion (used by error.tsx) ─────────────
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ── Mock HTMLCanvasElement.getContext for axe-core color contrast analysis ─
// axe-core internally uses canvas for color checks, which crashes in jsdom.
HTMLCanvasElement.prototype.getContext = function () {
  return null
}

// ── Mock server-only globally (used by @/lib/env and others) ──────────────
// Must be before any imports that use it.
vi.mock("server-only", () => ({}))

// ── Required env vars for module-level env validation (@/lib/env) ───────
process.env.SESSION_SECRET = "test-session-secret-for-vitest-at-least-32-characters"
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test"
process.env.REDIS_URL = "redis://localhost:6379"
process.env.RABBITMQ_URL = "amqp://localhost:5672"

// ── Mock @prisma/client globally ─────────────────────────────────────────
// db.ts now uses $extends (Prisma v6) for soft-delete, not $use.
// The mock provides a minimal PrismaClient that can be chained with $extends.
// Tests that need specific mocking can override with vi.mock('@prisma/client', ...).
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
    $extends: vi.fn().mockReturnThis(),
    user: {},
    service: {},
    booking: {},
    category: {},
  })),
}))
