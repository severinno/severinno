import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    // Force a single copy of React across the test graph. The pnpm store
    // contains react@19.2.3 (hoisted) AND react-dom@19.2.8 + react@19.2.8
    // (pulled by @mdxeditor/editor → sandpack). Two React copies in the same
    // process make ReactCurrentDispatcher null → "Invalid hook call" in
    // every component test. Dedupe makes Vite resolve one instance each.
    dedupe: ["react", "react-dom"],
    alias: {
      // More specific alias first! @rollup/plugin-alias uses first match.
      "@/vitrine/__tests__": path.resolve(__dirname, "src/components/vitrine/__tests__"),
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/lib/__tests__/__mocks__/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    globals: true,
    setupFiles: ["./vitest.setup.ts", "./src/components/vitrine/__tests__/vitest.setup.tsx"],
    // Force react/react-dom through Vite's pipeline so the renderer and
    // components share ONE physical copy. The pnpm store contains both
    // react@19.2.3 (hoisted) and react-dom@19.2.8 + react@19.2.8 (via
    // @mdxeditor/editor → sandpack); externalizing react-dom let it resolve
    // to its own nested react@19.2.8, breaking hook dispatcher identity.
    server: {
      deps: {
        inline: ["react", "react-dom"],
      },
    },
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
