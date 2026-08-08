import { z } from "zod"

// ---------------------------------------------------------------------------
// Zod v4 — disable JIT compilation (new Function) for the strict CSP
// ---------------------------------------------------------------------------
// zod 4.x compiles object schemas at runtime with `new Function(...)` for
// performance (JIT). The production CSP (next.config.ts) is:
//   script-src 'self' 'unsafe-inline'   ← NO 'unsafe-eval'
// Under that policy the browser blocks `new Function` on every schema parse
// and POSTs a violation report to /api/csp-report — noise in prod and a
// latent crash path if a future build drops 'unsafe-inline'.
//
// Fix: opt out of JIT globally. `jitless` falls back to the interpreted
// validator (only meaningfully slower on large object schemas parsed in hot
// loops — negligible for forms).
//
// IMPORTANT: this side effect MUST run before any zod schema is constructed
// or parsed. Import this module FIRST in client roots (see Providers.tsx and
// quote-modal.tsx). Importing it anywhere early also works because it mutates
// the single shared zod module instance.
z.config({ jitless: true })
