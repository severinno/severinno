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
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/components/**/*.test.{ts,tsx}", "node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
})
