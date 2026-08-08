/**
 * loading-shell.tsx
 *
 * Compound component that eliminates the boilerplate duplicated across every
 * loading.tsx:
 *   - "use client"
 *   - import { ShimmerStyle, S, createContainer, createItem } from "..."
 *
 * Entrance animations are pure CSS — no framer-motion. <StaggerContainer>
 * injects a per-child `--svn-delay` custom property and <StaggerItem> animates
 * with the `svnFadeUpVar` keyframe (fade + translateY from `--svn-y`). Both
 * keyframes live in loading-base's shimmerCSS, rendered by <LoadingShell>.
 *
 * This matters for performance: error boundaries and loading shells are part
 * of every route's INITIAL JS graph, so a static framer-motion import here
 * would pull the whole ~40 KB animation library into the first-paint bundle.
 *
 * Usage:
 *   import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"
 *
 *   <LoadingShell>
 *     <StaggerContainer stagger={0.07}>
 *       <StaggerItem y={14} duration={0.4}>
 *         <S className="h-8 w-48" />
 *       </StaggerItem>
 *     </StaggerContainer>
 *   </LoadingShell>
 */

"use client"

import * as React from "react"
import { type ReactNode } from "react"
import { ShimmerStyle, S, createContainer, createItem } from "./loading-base"

/** Re‑exported so loading files need only one import line. */
export { S, createContainer, createItem } from "./loading-base"

// ── Root: renders ShimmerStyle once ───────────────────────────────────────

export function LoadingShell({ children }: { children: ReactNode }) {
  return (
    <>
      <ShimmerStyle />
      {children}
    </>
  )
}

// ── CSS stagger container (replaces motion.div with container variants) ────
// Injects a `--svn-delay` custom property per child so <StaggerItem> can
// offset its entrance animation. Non-element children pass through untouched.

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
  return (
    <div className={className}>
      {React.Children.map(children, (child, i) =>
        React.isValidElement<{ style?: React.CSSProperties }>(child)
          ? React.cloneElement(child, {
              style: {
                "--svn-delay": `${(i * stagger).toFixed(3)}s`,
                ...(child.props.style || {}),
              } as React.CSSProperties,
            })
          : child,
      )}
    </div>
  )
}

// ── CSS stagger item (replaces motion.div with item variants) ─────────────
// Animates once with the svnFadeUpVar keyframe (fade + translateY from
// `--svn-y`, default 12px), delayed by the `--svn-delay` injected by the
// parent <StaggerContainer>.

export function StaggerItem({
  children,
  y = 12,
  duration = 0.35,
  className,
  style,
}: {
  children: ReactNode
  /** Slide-up offset (px). Default 12. */
  y?: number
  /** Animation duration (seconds). Default 0.35. */
  duration?: number
  className?: string
  /** Extra inline styles (used by StaggerContainer to inject --svn-delay). */
  style?: React.CSSProperties
}) {
  return (
    <div
      className={className}
      style={
        {
          ...style,
          "--svn-y": `${y}px`,
          animation: `svnFadeUpVar ${duration}s ease-out both`,
          animationDelay: "var(--svn-delay, 0s)",
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}
