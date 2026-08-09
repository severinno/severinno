import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/lib/__tests__/__mocks__/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"],
    exclude: ["src/components/**/*.test.{ts,tsx}", "node_modules", ".next"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // GLOBAL TIMEOUT SAFETY NET (2026-08): 30000ms instead of vitest's
    // default 5000ms. The scan-timeouts guard (scripts/scan-timeouts.mjs)
    // requires an EXPLICIT timeout on every subprocess-heavy test (the
    // 60000/120000 sweep standard), and those per-test values OVERRIDE this
    // global. This global is the backstop for tests the guard does NOT
    // flag (pure tests, and subprocess tests that slip past detection): a
    // slow-but-deterministic test gets 30s instead of flaking at 5s.
    // Failure-latency trade-off (accepted): a genuinely hung un-flagged
    // test now fails at 30s instead of 5s (+25s per hung test in CI) — the
    // cost of eliminating the 5s flake class for the undetected population.
    // SCOPE: applies to test:unit / test:guard runs (this config). The
    // DEFAULT vitest.config.ts keeps the 5000ms implicit default for
    // ad-hoc `bun run test` — the safety net is a CI-run property.
    testTimeout: 30000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
})
