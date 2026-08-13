/// <reference types="@testing-library/jest-dom/vitest" />
/// <reference types="vitest-axe/extend-expect" />

// ── React 19 test environment flag ────────────────────────────────────────
// Set in vitest.act-setup.ts before any React module is imported.
// https://react.dev/reference/react/act#testing-environment

// eslint-disable-next-line no-var
declare var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
