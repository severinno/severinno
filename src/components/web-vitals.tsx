"use client"

import { useEffect } from "react"
import { onCLS, onINP, onLCP, type Metric } from "web-vitals"

/**
 * Sends Web Vitals metrics to /api/web-vitals for monitoring.
 *
 * Tracks: LCP (Largest Contentful Paint), INP (Interaction to Next Paint),
 * CLS (Cumulative Layout Shift) — the three Core Web Vitals.
 *
 * In production, these metrics are sent to the backend for dashboard display.
 * In development, they're logged to console.
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
  }, [])

  return null
}
