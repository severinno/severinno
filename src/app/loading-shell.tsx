/**
 * loading-shell.tsx
 *
 * Compound component that eliminates the boilerplate duplicated across every
 * loading.tsx.
 *
 * Usage:
 *   import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"
 *
 *   <LoadingShell>
 *     <StaggerContainer stagger={0.07}>
 *       <StaggerItem>
 *         <S className="h-8 w-48" />
 *       </StaggerItem>
 *       <StaggerItem>
 *         <S className="h-4 w-32" />
 *       </StaggerItem>
 *     </StaggerContainer>
 *   </LoadingShell>
 */

"use client"

import { type ReactNode } from "react"
import { ShimmerStyle, staggerDelay } from "./loading-base"

/** Re-exported so loading files need only one import line. */
export { S } from "./loading-base"

// ── Root: renders ShimmerStyle once ───────────────────────────────────────

export function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <>
      <ShimmerStyle />
      {children}
    </>
  )
}

// ── Stagger container (CSS-only animation) ────────────────────────────────

export function StaggerContainer({
  children,
  stagger = 0.06,
  className,
}: {
  children: ReactNode
  /** Stagger delay between children (seconds). Default 0.06. */
  stagger?: number
  className?: string
}) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <div className={className}>
      {items.map((child, i) => (
        <div
          key={i}
          style={{
            animation: `fadeSlideUp 0.35s ease-out ${i * stagger}s both`,
          }}
        >
          {child}
        </div>
      ))}
    </div>
  )
}

// ── Stagger item (wrapper) ────────────────────────────────────────────────

export function StaggerItem({
  children,
  className,
  // Legacy props kept for backwards compatibility (no longer used in CSS animation)
  y: _y,
  duration: _duration,
}: {
  children: ReactNode
  className?: string
  /** @deprecated No longer used — kept for backwards compatibility. */
  y?: number
  /** @deprecated No longer used — kept for backwards compatibility. */
  duration?: number
}) {
  return <div className={className}>{children}</div>
}

// Re-export for backwards compatibility
export { staggerDelay }
