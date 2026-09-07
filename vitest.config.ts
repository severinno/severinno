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

  // ── Não carrega o postcss.config.mjs do app nos testes ───────────────────
  // O config do app usa plugins: ["@tailwindcss/postcss"] (Tailwind v4,
  // ESM-only). O Vite carrega postcss config de forma SÍNCRONA (sync
  // postcss-load-config) e não consegue resolver o plugin ESM — qualquer CSS
  // importado no grafo de testes (ex.: maplibre-gl/dist/maplibre-gl.css via
  // radius-map-inner/provider-mini-map) quebra com "Invalid PostCSS Plugin
  // found at: plugins[0]". O Next.js carrega o mesmo config sem problema
  // (loader próprio) — por isso isto é isolado ao vitest: fornecer um config
  // PostCSS explícito (sem plugins) desativa a descoberta do arquivo do app.
  css: {
    postcss: {
      plugins: [],
    },
  },

  test: {
    environment: "jsdom",
    // Guardas de CI/CLI (check-crlf, check-blob-crlf, normalize-crlf,
    // check-secret-leaks-baseline, etc.) criam fixtures git reais e levam
    // 5–21s por teste no Windows — acima do default de 5s do Vitest.
    // Timeout global de 30s cobre esses casos sem mascarar hangs reais.
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
        singleFork: false,
      },
    },
  },
})
