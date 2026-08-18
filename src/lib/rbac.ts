/**
 * rbac.ts
 *
 * Role-Based Access Control (RBAC) with granular resource-level permissions.
 *
 * Strategy:
 *   - Roles: CLIENT, PROVIDER, ADMIN
 *   - Resources: bookings, providers, services, reviews, etc.
 *   - Actions: create, read, update, delete, manage
 *
 * Usage:
 *   import { can, Permission } from "@/lib/rbac"
 *
 *   // Check if user can perform action
 *   if (can(session, "bookings", "create")) {
 *     // Allow
 *   }
 *
 *   // Or use requirePermission middleware
 *   await requirePermission(session, "providers", "update", providerId)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type Role = "CLIENT" | "PROVIDER" | "ADMIN"

export type Resource =
  | "bookings"
  | "providers"
  | "services"
  | "reviews"
  | "quotes"
  | "payments"
  | "notifications"
  | "messages"
  | "users"
  | "categories"
  | "settings"
  | "analytics"

export type Action = "create" | "read" | "update" | "delete" | "manage"

export interface Permission {
  resource: Resource
  action: Action
  /** Optional: scope restriction (e.g., "own" = only own resources) */
  scope?: "own" | "any"
}

export interface Session {
  userId: string
  role: Role
}

// ── Permission Matrix ──────────────────────────────────────────────────────

const PERMISSIONS: Record<Role, Permission[]> = {
  CLIENT: [
    // Bookings
    { resource: "bookings", action: "create" },
    { resource: "bookings", action: "read", scope: "own" },
    { resource: "bookings", action: "update", scope: "own" },
    { resource: "bookings", action: "delete", scope: "own" },

    // Providers (read-only)
    { resource: "providers", action: "read" },

    // Services (read-only)
    { resource: "services", action: "read" },

    // Reviews
    { resource: "reviews", action: "create" },
    { resource: "reviews", action: "read" },
    { resource: "reviews", action: "update", scope: "own" },
    { resource: "reviews", action: "delete", scope: "own" },

    // Quotes
    { resource: "quotes", action: "create" },
    { resource: "quotes", action: "read", scope: "own" },

    // Payments
    { resource: "payments", action: "read", scope: "own" },

    // Notifications
    { resource: "notifications", action: "read", scope: "own" },

    // Messages
    { resource: "messages", action: "create" },
    { resource: "messages", action: "read", scope: "own" },

    // Categories (read-only)
    { resource: "categories", action: "read" },

    // Analytics (own only)
    { resource: "analytics", action: "read", scope: "own" },
  ],

  PROVIDER: [
    // Bookings
    { resource: "bookings", action: "read", scope: "own" },
    { resource: "bookings", action: "update", scope: "own" },

    // Providers
    { resource: "providers", action: "read" },
    { resource: "providers", action: "update", scope: "own" },

    // Services
    { resource: "services", action: "create" },
    { resource: "services", action: "read" },
    { resource: "services", action: "update", scope: "own" },
    { resource: "services", action: "delete", scope: "own" },

    // Reviews
    { resource: "reviews", action: "read" },

    // Quotes
    { resource: "quotes", action: "read", scope: "own" },
    { resource: "quotes", action: "update", scope: "own" },

    // Payments
    { resource: "payments", action: "read", scope: "own" },

    // Notifications
    { resource: "notifications", action: "read", scope: "own" },

    // Messages
    { resource: "messages", action: "create" },
    { resource: "messages", action: "read", scope: "own" },

    // Categories (read-only)
    { resource: "categories", action: "read" },

    // Analytics (own only)
    { resource: "analytics", action: "read", scope: "own" },
  ],

  ADMIN: [
    // Everything
    { resource: "bookings", action: "manage" },
    { resource: "providers", action: "manage" },
    { resource: "services", action: "manage" },
    { resource: "reviews", action: "manage" },
    { resource: "quotes", action: "manage" },
    { resource: "payments", action: "manage" },
    { resource: "notifications", action: "manage" },
    { resource: "messages", action: "manage" },
    { resource: "users", action: "manage" },
    { resource: "categories", action: "manage" },
    { resource: "settings", action: "manage" },
    { resource: "analytics", action: "manage" },
  ],
}

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Check if a user has permission to perform an action on a resource.
 *
 * @param session - User session
 * @param resource - Target resource
 * @param action - Desired action
 * @returns true if permitted
 */
export function can(session: Session, resource: Resource, action: Action): boolean {
  const rolePermissions = PERMISSIONS[session.role] || []

  return rolePermissions.some((p) => {
    // Check resource match
    if (p.resource !== resource) return false

    // Check action match (manage includes all actions)
    if (p.action !== "manage" && p.action !== action) return false

    return true
  })
}

/**
 * Check if a user can access a specific resource instance.
 *
 * @param session - User session
 * @param resource - Target resource
 * @param action - Desired action
 * @param resourceOwnerId - Owner of the resource (if applicable)
 * @returns true if permitted
 */
export function canAccess(
  session: Session,
  resource: Resource,
  action: Action,
  resourceOwnerId?: string,
): boolean {
  const rolePermissions = PERMISSIONS[session.role] || []

  return rolePermissions.some((p) => {
    // Check resource match
    if (p.resource !== resource) return false

    // Check action match (manage includes all actions)
    if (p.action !== "manage" && p.action !== action) return false

    // Check scope
    if (p.scope === "own" && resourceOwnerId && resourceOwnerId !== session.userId) {
      return false
    }

    return true
  })
}

/**
 * Get all permissions for a role.
 */
export function getPermissions(role: Role): Permission[] {
  return PERMISSIONS[role] || []
}

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: Role, resource: Resource, action: Action): boolean {
  return can({ userId: "", role }, resource, action)
}

// ── Middleware Helper ──────────────────────────────────────────────────────

/**
 * Check permission and throw if not authorized.
 *
 * @param session - User session
 * @param resource - Target resource
 * @param action - Desired action
 * @param resourceOwnerId - Owner of the resource (if applicable)
 * @throws Error if not authorized
 */
export function requirePermission(
  session: Session,
  resource: Resource,
  action: Action,
  resourceOwnerId?: string,
): void {
  if (!canAccess(session, resource, action, resourceOwnerId)) {
    throw new Error(
      `FORBIDDEN: ${session.role} cannot ${action} ${resource}` +
        (resourceOwnerId ? ` (owner: ${resourceOwnerId})` : ""),
    )
  }
}

// ── Convenience Checks ────────────────────────────────────────────────────

export function canCreateBooking(session: Session): boolean {
  return can(session, "bookings", "create")
}

export function canUpdateBooking(session: Session, bookingOwnerId: string): boolean {
  return canAccess(session, "bookings", "update", bookingOwnerId)
}

export function canCreateService(session: Session): boolean {
  return can(session, "services", "create")
}

export function canUpdateService(session: Session, serviceOwnerId: string): boolean {
  return canAccess(session, "services", "update", serviceOwnerId)
}

export function canManageUsers(session: Session): boolean {
  return can(session, "users", "manage")
}

export function canManageSettings(session: Session): boolean {
  return can(session, "settings", "manage")
}
