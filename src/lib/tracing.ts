/**
 * tracing.ts
 *
 * OpenTelemetry distributed tracing helpers for the Severinno Marketplace.
 *
 * Configuration via environment variables:
 *   OTEL_ENABLED=true                    — Enable/disable tracing (default: false)
 *   OTEL_SERVICE_NAME=severinno-api      — Service name in traces
 *
 * Usage:
 *   import { withSpan } from "@/lib/tracing"
 *
 *   const result = await withSpan("operation-name", async () => {
 *     return await doSomething()
 *   })
 */

import { trace as otelTrace, SpanStatusCode, context, SpanKind } from "@opentelemetry/api"

// ── Configuration ─────────────────────────────────────────────────────────

const OTEL_ENABLED = process.env.OTEL_ENABLED === "true"
const OTEL_SERVICE_VERSION = process.env.npm_package_version || "0.4.0"

// ── Custom span helpers ───────────────────────────────────────────────────

/**
 * Execute a function within a new span.
 * Automatically handles span lifecycle (start, set status, end).
 *
 * When OTEL_ENABLED=false, runs the function without any tracing overhead.
 *
 * @param name - Span name (e.g. "providers.list", "cache.get")
 * @param fn - Function to execute within the span
 * @param attributes - Optional span attributes
 * @returns The function result
 *
 * @example
 * ```ts
 * const providers = await withSpan("providers.list", async () => {
 *   return await fetchProviders(...)
 * }, { radius: 10 })
 * ```
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!OTEL_ENABLED) {
    return fn()
  }

  const tracer = otelTrace.getTracer("severinno", OTEL_SERVICE_VERSION)
  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes,
  })

  try {
    const result = await context.with(otelTrace.setSpan(context.active(), span), fn)
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    })
    span.recordException(err as Error)
    throw err
  } finally {
    span.end()
  }
}

// ── Initialization (called from instrumentation.ts) ───────────────────────

let initialized = false

/**
 * Initialize OpenTelemetry tracing.
 * Called once from instrumentation.ts at startup.
 */
export function initTracing(): void {
  if (initialized) return
  initialized = true

  if (!OTEL_ENABLED) {
    console.log("[tracing] OpenTelemetry disabled (set OTEL_ENABLED=true to enable)")
    return
  }

  console.log("[tracing] OpenTelemetry enabled — spans will be created for instrumented operations")
}

/**
 * Shutdown tracing gracefully.
 */
export async function shutdownTracing(): Promise<void> {
  // No-op — spans are exported via SDK
}

// ── Re-export OpenTelemetry API ───────────────────────────────────────────

export { otelTrace as trace, SpanStatusCode, SpanKind, context }
