#!/usr/bin/env node

// =============================================================================
// check-direct-rtl-import.mjs
//
// CI guard that scans .test.* files for direct imports from
// @testing-library/react. Test files should import from
// @/__tests__/test-utils (custom render wrapper) instead.
//
// Usage:
//   node scripts/check-direct-rtl-import.mjs
//
// Exit codes:
//   0 — no direct imports found (pass)
//   1 — at least one direct import found (fail)
// =============================================================================

import { execSync } from "node:child_process"

try {
  const out = execSync(
    `grep -rln -e 'from "@testing-library/react"' -e "from '@testing-library/react'" src/ --include='*.test.*'`,
    { stdio: "pipe", shell: true, encoding: "utf-8" },
  )
  const files = out.trim().split("\n").filter(Boolean)
  console.error(
    `❌ Direct import from @testing-library/react found in ${files.length} test file(s):\n` +
      files.map((f) => `   - ${f}`).join("\n") +
      `\n\n   Use @/__tests__/test-utils instead of @testing-library/react.`,
  )
  process.exit(1)
} catch {
  // grep exited non-zero → no matches found → pass
  process.exit(0)
}
