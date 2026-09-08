"use client"

/**
 * PageTransition — CSS-only entry animation wrapper.
 *
 * Wraps page content with a fade-in + slide-up animation on mount.
 * No runtime dependency — pure CSS `animation` + `@starting-style`.
 *
 * Also exports utility class helpers for staggered children.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// PageTransition — wraps a page/section with entrance animation
// ---------------------------------------------------------------------------
type PageTransitionProps = {
  children: React.ReactNode
  className?: string
  /** Animation variant. Default: "fade-up" */
  variant?: "fade-up" | "fade-in" | "scale-in" | "slide-right"
  /** Delay in ms before animation starts. Default: 0 */
  delay?: number
}

const VARIANT_CLASSES: Record<NonNullable<PageTransitionProps["variant"]>, string> = {
  "fade-up": "animate-fade-up",
  "fade-in": "animate-fade-in",
  "scale-in": "animate-scale-in",
  "slide-right": "animate-slide-right",
}

export function PageTransition({
  children,
  className,
  variant = "fade-up",
  delay = 0,
}: PageTransitionProps) {
  return (
    <div
      className={cn(VARIANT_CLASSES[variant], className)}
      style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StaggerChildren — applies incremental delay to each child
// ---------------------------------------------------------------------------
export function StaggerChildren({
  children,
  className,
  staggerMs = 60,
  variant = "fade-up",
}: {
  children: React.ReactNode
  className?: string
  staggerMs?: number
  variant?: PageTransitionProps["variant"]
}) {
  return (
    <div className={className}>
      {React.Children.map(children, (child, i) => (
        <PageTransition variant={variant} delay={i * staggerMs}>
          {child}
        </PageTransition>
      ))}
    </div>
  )
}

export default PageTransition
