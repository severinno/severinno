import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      // More specific alias first! @rollup/plugin-alias uses first match.
      "@/vitrine/__tests__": path.resolve(__dirname, "src/components/vitrine/__tests__"),
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/lib/__tests__/__mocks__/server-only.ts"),
    },
  },

  test: {
    environment: "jsdom",
    // ── (Redundant since custom-render bypasses RTL entirely) ─────────
    // Keep as safety net — forces react/react-dom into the same Vite bundle
    // context, preventing duplicate-instance issues in edge cases.
    // See src/__tests__/helpers/custom-render.tsx for the primary fix.
    server: {
      deps: {
        inline: ["react", "react-dom"],
      },
    },
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    globals: true,
    // vitest.act-setup.ts MUST be first — it sets globalThis.IS_REACT_ACT_ENVIRONMENT
    // before any React module is loaded (it has zero imports).
    setupFiles: [
      "./vitest.act-setup.ts",
      "./vitest.setup.ts",
      "./src/components/vitrine/__tests__/vitest.setup.tsx",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      all: false,
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/__tests__/**",
        "src/**/__mocks__/**",
        "src/lib/db.ts",
        "prisma/**",
      ],
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
})
