/**
 * In-memory telemetry registry and analytics aggregator for Core Web Vitals.
 *
 * Tracks the 5 Google Web Vitals metrics:
 * 1. LCP (Largest Contentful Paint) - threshold: 2500ms
 * 2. INP (Interaction to Next Paint) - threshold: 200ms
 * 3. CLS (Cumulative Layout Shift) - threshold: 0.10
 * 4. FCP (First Contentful Paint) - threshold: 1800ms
 * 5. TTFB (Time to First Byte) - threshold: 800ms
 *
 * Provides bounded circular buffers to avoid memory leaks and calculates
 * real-time p50, p75, p90, and p95 distributions.
 */

export type WebVitalMetricName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB"
export type WebVitalRating = "good" | "needs-improvement" | "poor"

export interface WebVitalRecord {
  name: WebVitalMetricName
  value: number
  rating: WebVitalRating
  id?: string
  navigationType?: string
  delta?: number
  timestamp: number
}

export interface MetricThreshold {
  good: number
  needsImprovement: number
}

export const WEB_VITALS_THRESHOLDS: Record<WebVitalMetricName, MetricThreshold> = {
  LCP: { good: 2500, needsImprovement: 4000 },
  INP: { good: 200, needsImprovement: 500 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
  TTFB: { good: 800, needsImprovement: 1800 },
}

export interface MetricStats {
  count: number
  p50: number
  p75: number
  p90: number
  p95: number
  min: number
  max: number
  avg: number
  ratings: {
    good: number
    needsImprovement: number
    poor: number
    goodPercent: number
  }
  status: "OPTIMAL" | "NEEDS_IMPROVEMENT" | "POOR" | "INSUFFICIENT_DATA"
}

export interface WebVitalsSummary {
  timestamp: string
  totalSamples: number
  complianceScore: number // 0-100% based on p75 pass rates across metrics
  metrics: Record<WebVitalMetricName, MetricStats>
}

const MAX_SAMPLES_PER_METRIC = 1000

class WebVitalsRegistry {
  private buffers: Map<WebVitalMetricName, WebVitalRecord[]> = new Map([
    ["LCP", []],
    ["INP", []],
    ["CLS", []],
    ["FCP", []],
    ["TTFB", []],
  ])

  public record(metric: {
    name: string
    value: number
    rating?: string
    id?: string
    navigationType?: string
    delta?: number
    timestamp?: number
  }): void {
    const name = metric.name.toUpperCase() as WebVitalMetricName
    if (!this.buffers.has(name) || typeof metric.value !== "number" || Number.isNaN(metric.value)) {
      return
    }

    const threshold = WEB_VITALS_THRESHOLDS[name]
    let rating: WebVitalRating = "good"
    if (metric.value > threshold.needsImprovement) {
      rating = "poor"
    } else if (metric.value > threshold.good) {
      rating = "needs-improvement"
    }

    const record: WebVitalRecord = {
      name,
      value: metric.value,
      rating,
      id: metric.id,
      navigationType: metric.navigationType,
      delta: metric.delta,
      timestamp: metric.timestamp || Date.now(),
    }

    const buffer = this.buffers.get(name)!
    if (buffer.length >= MAX_SAMPLES_PER_METRIC) {
      buffer.shift()
    }
    buffer.push(record)
  }

  private calculatePercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = (p / 100) * (sorted.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    const weight = index - lower
    if (lower === upper) return sorted[lower]
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
  }

  private computeMetricStats(name: WebVitalMetricName): MetricStats {
    const buffer = this.buffers.get(name) || []
    if (buffer.length === 0) {
      return {
        count: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        min: 0,
        max: 0,
        avg: 0,
        ratings: { good: 0, needsImprovement: 0, poor: 0, goodPercent: 100 },
        status: "INSUFFICIENT_DATA",
      }
    }

    const values = buffer.map((r) => r.value).sort((a, b) => a - b)
    const count = values.length
    const min = Math.round(values[0] * 100) / 100
    const max = Math.round(values[count - 1] * 100) / 100
    const sum = values.reduce((acc, curr) => acc + curr, 0)
    const avg = Math.round((sum / count) * 100) / 100

    const p50 = Math.round(this.calculatePercentile(values, 50) * 100) / 100
    const p75 = Math.round(this.calculatePercentile(values, 75) * 100) / 100
    const p90 = Math.round(this.calculatePercentile(values, 90) * 100) / 100
    const p95 = Math.round(this.calculatePercentile(values, 95) * 100) / 100

    let goodCount = 0
    let needsImprovementCount = 0
    let poorCount = 0

    for (const r of buffer) {
      if (r.rating === "good") goodCount++
      else if (r.rating === "needs-improvement") needsImprovementCount++
      else poorCount++
    }

    const goodPercent = Math.round((goodCount / count) * 1000) / 10

    const threshold = WEB_VITALS_THRESHOLDS[name]
    let status: MetricStats["status"] = "OPTIMAL"
    if (p75 > threshold.needsImprovement) {
      status = "POOR"
    } else if (p75 > threshold.good) {
      status = "NEEDS_IMPROVEMENT"
    }

    return {
      count,
      p50,
      p75,
      p90,
      p95,
      min,
      max,
      avg,
      ratings: {
        good: goodCount,
        needsImprovement: needsImprovementCount,
        poor: poorCount,
        goodPercent,
      },
      status,
    }
  }

  public getSummary(): WebVitalsSummary {
    const metrics: Record<WebVitalMetricName, MetricStats> = {
      LCP: this.computeMetricStats("LCP"),
      INP: this.computeMetricStats("INP"),
      CLS: this.computeMetricStats("CLS"),
      FCP: this.computeMetricStats("FCP"),
      TTFB: this.computeMetricStats("TTFB"),
    }

    let totalSamples = 0
    let compliantCount = 0
    let evaluatedMetrics = 0

    const keys: WebVitalMetricName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"]
    for (const key of keys) {
      totalSamples += metrics[key].count
      if (metrics[key].count > 0) {
        evaluatedMetrics++
        if (metrics[key].status === "OPTIMAL") {
          compliantCount++
        }
      }
    }

    const complianceScore =
      evaluatedMetrics > 0 ? Math.round((compliantCount / evaluatedMetrics) * 100) : 100

    return {
      timestamp: new Date().toISOString(),
      totalSamples,
      complianceScore,
      metrics,
    }
  }

  public reset(): void {
    for (const buffer of this.buffers.values()) {
      buffer.length = 0
    }
  }
}

export const webVitalsRegistry = new WebVitalsRegistry()
