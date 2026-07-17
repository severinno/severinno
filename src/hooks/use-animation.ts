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
  const [value, setValue] = React.useState(0)
  const ref = React.useRef<HTMLSpanElement>(null)
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    if (target <= 0) {
      setValue(0)
      return
    }

    // Respect prefers-reduced-motion — skip animation, show final value
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target)
      return
    }

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
  }, [target, duration, startOnView, decimals])

  return { ref, value }
}

// ---------------------------------------------------------------------------
// useScrollReveal — trigger a boolean when element enters viewport
// ---------------------------------------------------------------------------

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options?: {
    threshold?: number
    rootMargin?: string
    once?: boolean
  },
) {
  const { threshold = 0.15, rootMargin = "0px 0px -50px 0px", once = true } =
    options ?? {}
  const ref = React.useRef<T>(null)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    // Respect reduced motion — show immediately
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(true)
      return
    }

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
  }, [threshold, rootMargin, once])

  return { ref, visible }
}

// ---------------------------------------------------------------------------
// useTilt — 3D tilt-on-mouse-move for interactive cards
// ---------------------------------------------------------------------------

export function useTilt<T extends HTMLElement = HTMLDivElement>(
  options?: {
    max?: number // max degrees
    scale?: number // hover scale
  },
) {
  const { max = 6, scale = 1.01 } = options ?? {}
  const ref = React.useRef<T>(null)

  // We return a single `handlers` object so consumers can spread it onto the
  // element without the linter complaining about ref-access during render.
  // The handlers themselves access ref.current only when invoked (i.e. on
  // actual mouse events), not during the render phase.
  const handlers = React.useMemo(
    () => ({
      ref,
      onMouseMove: (e: React.MouseEvent<T>) => {
        const el = ref.current
        if (!el) return
        if (
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          return
        }
        const rect = el.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width
        const y = (e.clientY - rect.top) / rect.height
        const tiltX = (0.5 - y) * max * 2
        const tiltY = (x - 0.5) * max * 2
        el.style.transform = `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`
      },
      onMouseLeave: () => {
        const el = ref.current
        if (!el) return
        el.style.transform = "perspective(900px) rotateX(0) rotateY(0) scale(1)"
      },
    }),
    [max, scale],
  )

  return handlers
}
