"use client"

import { useEffect } from "react"
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals"

/**
 * Sends Web Vitals metrics to /api/web-vitals for monitoring.
 *
 * Tracks the 5 pillars of web performance:
 * - LCP (Largest Contentful Paint) — loading performance
 * - INP (Interaction to Next Paint) — responsiveness
 * - CLS (Cumulative Layout Shift) — visual stability
 * - FCP (First Contentful Paint) — initial render
 * - TTFB (Time to First Byte) — server response & CDN latency
 *
 * In production, these metrics are sent via navigator.sendBeacon.
 * In development, they are logged to console.
 */
function sendToAnalytics(metric: Metric) {
  const payload = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating, // "good" | "needs-improvement" | "poor"
    id: metric.id,
    navigationType: metric.navigationType,
    delta: metric.delta,
    timestamp: Date.now(),
  }

  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console -- dev-only Web Vitals output
    console.log(`[Web Vitals] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`)
    return
  }

  // Send via beacon API (non-blocking, survives page unload)
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" })
    navigator.sendBeacon("/api/web-vitals", blob)
  }
}

export function WebVitals() {
  useEffect(() => {
    onLCP(sendToAnalytics)
    onINP(sendToAnalytics)
    onCLS(sendToAnalytics)
    onFCP(sendToAnalytics)
    onTTFB(sendToAnalytics)
  }, [])

  return null
}
