"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, ArrowDown } from "lucide-react"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export type PullToRefreshProps = {
  onRefresh: () => Promise<unknown> | void
  children: React.ReactNode
  className?: string
  pullThreshold?: number
  disabled?: boolean
}

export function PullToRefresh({
  onRefresh,
  children,
  className,
  pullThreshold = 64,
  disabled = false,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = React.useState(0)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const startYRef = React.useRef(0)
  const isPullingRef = React.useRef(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled || isRefreshing) return
    const el = containerRef.current
    // Only pull when at the very top of the container or window
    const scrollTop = el ? el.scrollTop : window.scrollY
    if (scrollTop <= 2) {
      startYRef.current = e.touches[0].clientY
      isPullingRef.current = true
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPullingRef.current || disabled || isRefreshing) return
    const currentY = e.touches[0].clientY
    const deltaY = currentY - startYRef.current

    if (deltaY > 0) {
      // Damping factor for natural rubber-band feeling
      const damped = Math.min(deltaY * 0.45, pullThreshold * 1.5)
      setPullDistance(damped)

      if (damped >= pullThreshold && pullDistance < pullThreshold) {
        triggerHaptic("selection")
      }
    } else {
      isPullingRef.current = false
      setPullDistance(0)
    }
  }

  const handleTouchEnd = async () => {
    if (!isPullingRef.current || disabled) return
    isPullingRef.current = false

    if (pullDistance >= pullThreshold && !isRefreshing) {
      setIsRefreshing(true)
      setPullDistance(pullThreshold)
      triggerHaptic("selection")

      try {
        await onRefresh()
        triggerHaptic("success")
      } catch {
        triggerHaptic("warning")
      } finally {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }

  const progress = Math.min(pullDistance / pullThreshold, 1)

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn("relative", className)}
    >
      {/* Pull Indicator */}
      <AnimatePresence>
        {(pullDistance > 0 || isRefreshing) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{
              opacity: 1,
              height: isRefreshing ? 48 : pullDistance,
            }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: isRefreshing ? 0.2 : 0.05 }}
            className="pointer-events-none flex items-center justify-center overflow-hidden"
            role="status"
            aria-live="polite"
          >
            <div className="border-border/60 bg-card text-primary flex size-9 items-center justify-center rounded-full border shadow-sm transition-all">
              {isRefreshing ? (
                <Loader2 className="text-primary size-4.5 animate-spin" />
              ) : (
                <ArrowDown
                  className="text-primary size-4.5 transition-transform duration-150"
                  style={{
                    transform: `rotate(${progress >= 1 ? 180 : progress * 180}deg)`,
                  }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      {children}
    </div>
  )
}
