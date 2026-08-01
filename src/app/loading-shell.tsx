/**
 * loading-shell.tsx
 *
 * Compound component that eliminates the boilerplate duplicated across every
 * loading.tsx:
 *   - "use client"
 *   - import { motion } from "framer-motion"
 *   - import { ShimmerStyle, S, createContainer, createItem } from "..."
 *   - const container = createContainer(X)
 *   - const item = createItem(Y, Z)
 *   - <ShimmerStyle />
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
 *
 * For custom motion.div animations (e.g. fade-in with delay), just import
 * { motion } from "framer-motion" alongside LoadingShell.
 */

"use client"

import { type ReactNode } from "react"
import { motion } from "framer-motion"
import { ShimmerStyle, createContainer, createItem } from "./loading-base"

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

// ── Animated stagger container (replaces motion.div with container variants) ─

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
  const variants = createContainer(stagger)
  return (
    <motion.div variants={variants} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  )
}

// ── Animated item (replaces motion.div with item variants) ─────────────────

export function StaggerItem({
  children,
  y = 12,
  duration = 0.35,
  className,
}: {
  children: ReactNode
  /** Slide-up offset (px). Default 12. */
  y?: number
  /** Animation duration (seconds). Default 0.35. */
  duration?: number
  className?: string
}) {
  const variants = createItem(y, duration)
  return (
    <motion.div variants={variants} className={className}>
      {children}
    </motion.div>
  )
}
