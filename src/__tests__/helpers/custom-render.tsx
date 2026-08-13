// ── Backward compatibility re-export ─────────────────────────────────────
// The canonical custom render lives at src/__tests__/test-utils.tsx.
// This file re-exports everything from there for any test files that
// already import from "@/__tests__/helpers/custom-render".
//
// New test files should import from:
//   import { render, screen } from "@/__tests__/test-utils"
//
// Migration guide:
//   import { render, screen, cleanup } from "@/__tests__/test-utils"
//   import { afterEach } from "vitest"
//   afterEach(() => { cleanup() })

export * from "@/__tests__/test-utils"
