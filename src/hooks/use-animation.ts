"use client"

/**
 * use-animation — lightweight animation utility hooks.
 *
 * Hooks:
 *   - useCountUp: animates a number from 0 to `target` when the element scrolls into view
 *   - useScrollReveal: returns a ref + visibility flag for scroll-triggered reveal animations
 *   - useTilt: returns props (ref + handlers) for a 3D tilt-on-mouse-move effect
 *
 * All hooks respect prefers-reduced-motion for accessibility.
 */

import * as React from "react"

// ---------------------------------------------------------------------------
// useCountUp — animate a number from 0 → target when scrolled into view
// ---------------------------------------------------------------------------

export function useCountUp(
  target: number,
  options?: {
    duration?: number // ms
    startOnView?: boolean // default true
    decimals?: number
  },
) {
  const { duration = 1500, startOnView = true, decimals = 0 } = options ?? {}
  // If reduced-motion is preferred, skip animation and show final value
  // immediately. This is computed during render, not in an effect, so the
  // lint rule about setState-in-effect is satisfied.
  const prefersReduced =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  const initialValue = prefersReduced || target <= 0 ? target : 0
  const [value, setValue] = React.useState(initialValue)
  const ref = React.useRef<HTMLSpanElement>(null)
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    if (target <= 0 || prefersReduced) return

    const startAnimation = () => {
      if (startedRef.current) return
      startedRef.current = true

      const start = performance.now()
      const tick = (now: number) => {
        const elapsed = now - start
        const progress = Math.min(elapsed / duration, 1)
        // Ease-out cubic for a snappy finish
        const eased = 1 - Math.pow(1 - progress, 3)
        const current = target * eased
        setValue(decimals > 0 ? Number(current.toFixed(decimals)) : Math.floor(current))
        if (progress < 1) {
          requestAnimationFrame(tick)
        } else {
          setValue(target)
        }
      }
      requestAnimationFrame(tick)
    }

    if (!startOnView) {
      startAnimation()
      return
    }

    const el = ref.current
    if (!el) {
      startAnimation()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            startAnimation()
            observer.disconnect()
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -20px 0px" },
    )
    observer.observe(el)
    // Fallback: if observer doesn't fire within 1s, start anyway
    const fallback = window.setTimeout(() => {
      if (!startedRef.current) {
        startAnimation()
      }
    }, 1000)
    return () => {
      observer.disconnect()
      window.clearTimeout(fallback)
    }
  }, [target, duration, startOnView, decimals, prefersReduced])

  return { ref, value }
}

// ---------------------------------------------------------------------------
// useScrollReveal — trigger a boolean when element enters viewport
// ---------------------------------------------------------------------------

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  threshold?: number
  rootMargin?: string
  once?: boolean
}) {
  const { threshold = 0.15, rootMargin = "0px 0px -50px 0px", once = true } = options ?? {}
  const ref = React.useRef<T>(null)
  // Initialise based on reduced-motion *during render* (not in an effect)
  const prefersReduced =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  const [visible, setVisible] = React.useState(prefersReduced)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    // If reduced motion is preferred, we already initialised visible=true
    // during render, so there's nothing to observe.
    if (prefersReduced) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            if (once) observer.disconnect()
          } else if (!once) {
            setVisible(false)
          }
        }
      },
      { threshold, rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, rootMargin, once, prefersReduced])

  return { ref, visible }
}

// ---------------------------------------------------------------------------
// useTilt — 3D tilt-on-mouse-move for interactive cards
// ---------------------------------------------------------------------------

export function useTilt<T extends HTMLElement = HTMLDivElement>(options?: {
  max?: number // max degrees
  scale?: number // hover scale
  disabled?: boolean
}) {
  const { max = 6, scale = 1.01, disabled = false } = options ?? {}
  const ref = React.useRef<T>(null)
  const rafId = React.useRef<number | null>(null)
  const isEnabledRef = React.useRef<boolean>(false)

  // Evaluate media queries on mount and listen to changes, eliminating repeated
  // synchronous window.matchMedia queries during hot mousemove events.
  React.useEffect(() => {
    if (typeof window === "undefined" || disabled) {
      isEnabledRef.current = false
      return
    }

    const checkEnabled = () => {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      // Only enable on devices supporting fine pointer hover (desktops/laptops, not touchscreens)
      const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches
      isEnabledRef.current = !prefersReducedMotion && canHover
    }

    checkEnabled()

    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)")
    const hoverMedia = window.matchMedia("(hover: hover) and (pointer: fine)")

    motionMedia.addEventListener?.("change", checkEnabled)
    hoverMedia.addEventListener?.("change", checkEnabled)

    return () => {
      motionMedia.removeEventListener?.("change", checkEnabled)
      hoverMedia.removeEventListener?.("change", checkEnabled)
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [disabled])

  const handlers = React.useMemo(
    () => ({
      ref,
      onMouseMove: (e: React.MouseEvent<T>) => {
        if (!isEnabledRef.current) return
        const el = ref.current
        if (!el) return

        // Throttle updates to display refresh rate with requestAnimationFrame
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current)
        }

        const clientX = e.clientX
        const clientY = e.clientY

        rafId.current = requestAnimationFrame(() => {
          if (!ref.current) return
          const rect = ref.current.getBoundingClientRect()
          const x = (clientX - rect.left) / rect.width
          const y = (clientY - rect.top) / rect.height
          const tiltX = (0.5 - y) * max * 2
          const tiltY = (x - 0.5) * max * 2
          ref.current.style.transform = `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`
        })
      },
      onMouseLeave: () => {
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current)
          rafId.current = null
        }
        const el = ref.current
        if (!el) return
        el.style.transform = "perspective(900px) rotateX(0) rotateY(0) scale(1)"
      },
    }),
    [max, scale],
  )

  return handlers
}
