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
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/components/**/*.test.{ts,tsx}", "node_modules", ".next"],
    server: {
      deps: {
        inline: ["react", "react-dom"],
      },
    },
    setupFiles: ["./vitest.act-setup.ts", "./vitest.setup.ts"],

    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
})
