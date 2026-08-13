/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * auth-mock.ts
 *
 * Reusable Vitest helpers for mocking authentication in admin route tests.
 *
 * ⚠️ Hoisting constraint:
 *
 *   Vitest hoists `vi.hoisted()` and `vi.mock()` ABOVE all import statements.
 *   Therefore the `vi.fn()` instance must be created **inline** inside `vi.hoisted()` —
 *   it cannot come from an imported factory function.
 *
 *   The helper functions below (setupAdmin, setupNonAdmin, etc.) ARE safe to
 *   import because they are only called INSIDE test functions (it() blocks),
 *   which execute after all module loading is complete.
 *
 * == Usage ==
 *
 * ```ts
 * // ── Test file ─────────────────────────────────────────────────────
 * const { mockRequireUser } = vi.hoisted(() => ({
 *   mockRequireUser: vi.fn(),  // inline — no import dependency
 * }))
 *
 * vi.mock("@/lib/auth", () => ({
 *   requireUser: mockRequireUser,
 * }))
 *
 * import { setupAdmin, setupNonAdmin, setupUnauthenticated } from "@/lib/__tests__/helpers/auth-mock"
 *
 * describe("GET /api/admin/something", () => {
 *   beforeEach(() => { vi.clearAllMocks() })
 *
 *   it("returns 200 for admin", async () => {
 *     setupAdmin(mockRequireUser)
 *     // ...
 *   })
 * })
 * ```
 *
 * For routes that use `requireRole` instead of `requireUser`:
 *
 * ```ts
 * import { setMockRole, setupRoleMock } from "@/lib/__tests__/helpers/auth-mock"
 *
 * vi.mock("@/lib/auth", () => setupRoleMock())
 *
 * describe("GET /api/admin/commissions", () => {
 *   beforeEach(() => { setMockRole("ADMIN"); vi.clearAllMocks() })
 * })
 * ```
 */

import { vi } from "vitest"

// =========================================================================
// Pattern 1: requireUser (returns user object with role)
// =========================================================================

/**
 * Configure a `requireUser` mock (created inline in `vi.hoisted()`)
 * to resolve with an admin user object.
 *
 * @param mock - The vi.fn() instance created inside vi.hoisted().
 */
export function setupAdmin(mock: ReturnType<typeof vi.fn>): void {
  mock.mockResolvedValue({
    id: "admin-mock",
    name: "Admin",
    email: "admin@severinno.com.br",
    role: "ADMIN",
  })
}

/**
 * Configure a `requireUser` mock to resolve with a non-admin user.
 *
 * @param mock - The vi.fn() instance created inside vi.hoisted().
 * @param role - The role to return (default "USER").
 */
export function setupNonAdmin(mock: ReturnType<typeof vi.fn>, role = "USER"): void {
  mock.mockResolvedValue({
    id: `${role.toLowerCase()}-mock`,
    name: "Non-Admin User",
    email: `user@severinno.com.br`,
    role,
  })
}

/**
 * Configure a `requireUser` mock to reject with an authentication error.
 *
 * Simulates an unauthenticated request (missing session cookie).
 *
 * @param mock - The vi.fn() instance created inside vi.hoisted().
 */
export function setupUnauthenticated(mock: ReturnType<typeof vi.fn>): void {
  mock.mockRejectedValue(new Error("UNAUTHORIZED"))
}

// =========================================================================
// Pattern 2: requireRole (throws unless role matches)
// =========================================================================

/**
 * Internal mutable role controlled via `setMockRole()`.
 *
 * Works through hoisting because the mock factory captures `_mockRole` by
 * REFERENCE (closure).  The factory is created at module evaluation time,
 * but the closure only reads `_mockRole` when `requireRole()` is invoked
 * inside a test — well after imports resolve.
 */
let _mockRole: string | null = null

/**
 * Set the current role for the `requireRole` mock.
 * Typically called in `beforeEach()`.
 */
export function setMockRole(role: string | null): void {
  _mockRole = role
}

/**
 * Create a mock module object for `vi.mock("@/lib/auth", () => setupRoleMock())`.
 *
 * The `requireRole` function throws `new Error("FORBIDDEN")` when the
 * requested role doesn't match the current `_mockRole`.
 *
 * Also provides a dummy `requireUser: vi.fn()` for routes that import it.
 */
export function setupRoleMock(): {
  requireUser: ReturnType<typeof vi.fn>
  requireRole: ReturnType<typeof vi.fn>
} {
  return {
    requireUser: vi.fn(),
    requireRole: vi.fn().mockImplementation(async (role: string) => {
      if (_mockRole !== role) throw new Error("FORBIDDEN")
    }),
  }
}
