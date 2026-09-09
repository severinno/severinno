/// <reference types="vitest/globals" />
// Type augmentation for jest-dom matchers lives in ./types/vitest.d.ts
// Runtime: extend vitest expect with jest-dom matchers
import { expect } from "vitest"
import * as matchers from "@testing-library/jest-dom/matchers"

expect.extend(matchers)

// ── Sanitiza env GIT_* herdado do hook do git ────────────────────────────
// Quando o pre-push/pre-commit roda sob `git push`/`git commit`, o git seta
// GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE no ambiente do hook — e os workers do
// vitest (singleFork) herdam isso. Os testes de CLI que spawnam `git` em
// repos TEMPORÁRIOS (git init + cwd) operariam no repo REAL em vez do
// fixture (36 falhas no test:guards só sob o hook real). Limpa as vars GIT_*
// para o processo: nenhum código do repo depende delas explicitamente, e os
// helpers que precisam do repo atual derivam o caminho via cwd/rev-parse.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) {
    delete process.env[key]
  }
}

// ── Mock ioredis globally (prevents "Unhandled error event" in tests) ─────
// Rate-limit and Redis modules may try to connect to a real Redis instance
// during tests. This mock prevents unhandled error events.
//
// Vitest 4: constructor mocks MUST use function/class implementations — an
// arrow implementation throws "is not a constructor" when code does
// `new Redis(...)` (src/lib/redis/client.ts createClient).
vi.mock("ioredis", () => {
  const MockRedis = vi.fn(function () {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      setex: vi.fn().mockResolvedValue("OK"),
      incr: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      del: vi.fn().mockResolvedValue(1),
      ping: vi.fn().mockResolvedValue("PONG"),
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      // nodes() é usado pela branch cluster do scanKeys (cache.ts) — sem ele,
      // `c instanceof Cluster` → c.nodes(...) lançaria TypeError em vez de
      // degradar limpo para o tier de memória.
      nodes: vi.fn(() => []),
      disconnect: vi.fn(),
      quit: vi.fn(),
    }
  })
  return { default: MockRedis, Redis: MockRedis, Cluster: MockRedis }
})

// ── Mock ResizeObserver for framer-motion (used by error.tsx) ─────────────
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ── Polyfill scrollIntoView (jsdom não implementa; Radix dialogs/selects
// chamam candidate.scrollIntoView ao focar itens) ─────────────────────────
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// ── Polyfill URL.createObjectURL/revokeObjectURL (jsdom não tem) ───────────
// O maplibre-gl chama window.URL.createObjectURL(new Blob([...])) no PRÓPRIO
// import do módulo (setWorkerUrl com worker inline). Qualquer teste que carregue
// o maplibre real — via radius-map-inner (import estático) ou provider-mini-map
// (import dinâmico no escopo do módulo) — rejeitava com
// "window.URL.createObjectURL is not a function" no singleFork.
// Polyfill mínimo: devolve um blob URL fake; o maplibre só guarda a string.
if (typeof window !== "undefined" && typeof window.URL.createObjectURL !== "function") {
  window.URL.createObjectURL = () => "blob:vitest-mock"
  window.URL.revokeObjectURL = () => {}
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
// O namespace Prisma (sql/empty) é usado por postgis.ts para montar o LIMIT
// condicional — o mock replica o shape do fragmento ({ strings, values })
// para que o $queryRaw mockado receba o fragmento como valor interpolado.
//
// Vitest 4: constructor mock must be function/class (NOT arrow) — db.ts does
// `new PrismaClient(...)` and an arrow implementation throws
// "is not a constructor" (confirmed via Reflect.construct in @vitest/spy).
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(function () {
    return {
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      $transaction: vi.fn(),
      $extends: vi.fn().mockReturnThis(),
      user: {},
      service: {},
      booking: {},
      category: {},
    }
  }),
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    empty: { strings: [], values: [] },
  },
}))
