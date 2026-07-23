import "@testing-library/jest-dom/vitest"

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
// db.ts now calls client.$use() for soft-delete middleware.
// Tests that don't mock @/lib/db themselves need PrismaClient to at least
// expose $use as a callable function.
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $use: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
    user: {},
    service: {},
    booking: {},
    category: {},
  })),
}))
