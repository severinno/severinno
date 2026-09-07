#!/usr/bin/env node
// =============================================================================
// analyze-bundle.mjs — Cross-platform Next.js Bundle Analyzer Runner
// =============================================================================
//
// Usage:
//   node scripts/analyze-bundle.mjs
//   npm run build:analyze
//
// Exit code:
//   0 — build and bundle analysis completed successfully
//   1 — build failed
//
// =============================================================================

import { spawn } from "node:child_process"

process.env.ANALYZE = "true"

const proc = spawn("bun", ["run", "build"], {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, ANALYZE: "true" },
})

proc.on("close", (code) => {
  process.exit(code ?? 0)
})
