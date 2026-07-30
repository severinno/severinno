// ── React 19 + jsdom test environment ─────────────────────────────────────
// React 19 defers createRoot rendering unless it detects a test environment.
// This flag must be set on globalThis BEFORE any React module is imported.
// This file has NO imports to ensure the flag is the very first thing that
// executes in the vitest setup pipeline.
//
// See: https://react.dev/reference/react/act#testing-environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true
