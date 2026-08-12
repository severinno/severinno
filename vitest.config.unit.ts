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
    // Component tests are excluded from test:unit EXCEPT the deterministic
    // AddressAutocomplete suite (32 tests, fake timers - the fuzz suite uses
    // real timers + axe and belongs to fuzz:ci). vitest 3.1.1 does NOT honor
    // `!` negation in include/exclude (probed 2026-08); the re-inclusion uses
    // an EXTGLOB on the tree (`!(vitrine)`) plus suffix patterns for the slow
    // vitrine files (fuzz/a11y/snapshot). The pre-commit area mapping was
    // silently skipping this component ("No test files found" + passWithNoTests)
    // - the re-inclusion makes the mapped test RUN. Pinned by
    // scripts/__tests__/unit-surface-contract.test.ts.
    exclude: [
      // extglob !(...) is the ONLY working negation on vitest 3.1.1 (see docs/scan-surfaces.md section 7)
      // other component trees stay out of test:unit (blanket exclusion removed)
      "src/components/!(vitrine)/**/*.test.{ts,tsx}",
      // vitrine slow/brittle kinds: fuzz (real timers + axe), a11y/accessibility (axe), snapshot (golden)
      "src/components/vitrine/__tests__/*fuzz*.test.{ts,tsx}",
      "src/components/vitrine/__tests__/*a11y*.test.{ts,tsx}",
      "src/components/vitrine/__tests__/*accessibility*.test.{ts,tsx}",
      "src/components/vitrine/__tests__/*snapshot*.test.{ts,tsx}",
      "node_modules",
      ".next",
    ],
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
    // test now fails at 30s instead of 5s (+25s per hung test in CI) - the
    // cost of eliminating the 5s flake class for the undetected population.
    // SCOPE: applies to test:unit / test:guard runs (this config). The
    // DEFAULT vitest.config.ts keeps the 5000ms implicit default for
    // ad-hoc `bun run test` - the safety net is a CI-run property.
    testTimeout: 30000,
    // SERIALIZED POOL (2026-08, sec 8.1 + sec 11.48): `singleFork: true` is
    // INTENTIONAL. The test:unit/test:guard surface is CONTRACT suites that
    // read the REAL repo files (scan-*, golden copies, manifests); a single
    // fork serializes their subprocess I/O for DETERMINISM (no interleaving).
    // The sec 8.1 re-mediacoes (2)-(6) MEASURED the guard band (test:guard 19-23.5s, series 20 -> 20.9 -> 19 -> 22.2 -> 23.5 -> 22.5s as the suites grew 236 -> 304):
    // cheap-test absorption into the runner variance band, NOT workers -
    // --maxWorkers is a structural no-op here (sec 11.48 + re-mediacao (5)
    // probed it; sec 8.1's alert: a sustained rise re-opens the decision).
    // DO NOT "parallelize"
    // this pool without re-measuring the serialization cost of the contract
    // suites. Pinned by scripts/__tests__/unit-surface-contract.test.ts.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
})
