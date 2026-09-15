/**
 * tracing.ts — OpenTelemetry distributed tracing for Next.js → Tempo.
 *
 * Architecture:
 *
 *   ┌──────────────┐    OTLP/HTTP     ┌──────────────┐    ┌─────────┐
 *   │  Next.js App │ ───────────────→ │ Tempo (:4318) │ ─→ │ Grafana │
 *   └──────────────┘                  └──────────────┘    └─────────┘
 *        │
 *        ├── HTTP auto-instrumentation (fetch, http/https)
 *        ├── Redis instrumentation (ioredis / @upstash/redis)
 *        └── Custom spans via traceSpan("operation", attrs)
 *
 * Env vars:
 *   OTEL_ENABLED=true            — Enable OTel (default: false)
 *   OTEL_EXPORTER_ENDPOINT       — Tempo OTLP endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            — Service name (default: severinno)
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis-4"
import { trace, SpanStatusCode, type Span, type SpanOptions } from "@opentelemetry/api"
import { AsyncLocalStorage } from "async_hooks"
import crypto from "crypto"
import logger from "./logger"

// ── Configuration ────────────────────────────────────────────────────────

function getConfig() {
  return {
    enabled: process.env.OTEL_ENABLED === "true",
    endpoint: process.env.OTEL_EXPORTER_ENDPOINT || "http://localhost:4318",
    serviceName: process.env.OTEL_SERVICE_NAME || "severinno",
    serviceVersion: process.env.npm_package_version || "0.0.0",
    devMode: process.env.NODE_ENV === "development",
  }
}

// ── Provider singleton ───────────────────────────────────────────────────

let provider: NodeTracerProvider | null = null
let initialized = false

/**
 * Initialize the OpenTelemetry tracing provider.
 * Must be called once in instrumentation.ts register() before other imports.
 */
export function initTracing(): void {
  if (initialized) return
  initialized = true

  const config = getConfig()
  if (!config.enabled) return

  try {
    // 1. Create resource (service identity)
    const resource = resourceFromAttributes({
      "service.name": config.serviceName,
      "service.version": config.serviceVersion,
      "deployment.environment": process.env.NODE_ENV || "development",
    })

    // 2. Create OTLP exporter (sends to Tempo)
    const otlpExporter = new OTLPTraceExporter({
      url: `${config.endpoint}/v1/traces`,
      timeoutMillis: 15000,
    })

    // 3. Build span processors
    const spanProcessors = config.devMode
      ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
      : [
          new BatchSpanProcessor(otlpExporter, {
            maxQueueSize: 2048,
            maxExportBatchSize: 512,
            scheduledDelayMillis: 5000,
            exportTimeoutMillis: 30000,
          }),
        ]

    // 4. Instrumentations
    const instrumentations = [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || ""
          return (
            url.includes("/api/health") ||
            url.includes("/api/metrics") ||
            url.includes("/_next/webpack-hmr")
          )
        },
      }),
      new RedisInstrumentation({
        dbStatementSerializer: (cmdName, cmdArgs) => {
          return `${cmdName} ${cmdArgs.length} args`
        },
      }),
    ]

    // 5. Create provider — `instrumentations` is a runtime-only field (not in TS types)
    provider = new NodeTracerProvider({
      resource,
      spanProcessors,
      // @ts-expect-error OTel SDK v2 accepts instrumentations at runtime but types don't declare it
      instrumentations,
    })

    // 6. Register with the OTel API
    provider.register()

    logger.info(
      { endpoint: config.endpoint, serviceName: config.serviceName },
      "OpenTelemetry tracing initialized → Tempo",
    )
  } catch (err) {
    logger.warn({ err }, "OpenTelemetry init failed — continuing without tracing")
    provider = null
  }
}

/**
 * Graceful shutdown — flush all pending spans before exit.
 */
export async function shutdownTracing(): Promise<void> {
  if (!provider) return
  try {
    await provider.shutdown()
    logger.info("OpenTelemetry tracing shut down")
  } catch (err) {
    logger.warn({ err }, "OpenTelemetry shutdown error")
  }
}

// ── Manual span helpers ──────────────────────────────────────────────────

const tracer = trace.getTracer("severinno")

/**
 * Create and run a child span within the current context.
 *
 * @example
 *   const result = await traceSpan("geo.reverseGeocode", async (span) => {
 *     span.setAttribute("geo.lat", lat)
 *     return await reverseGeocode(lat, lng)
 *   })
 */
export async function traceSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions & { attributes?: Record<string, string | number | boolean> },
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    { kind: options?.kind, attributes: options?.attributes },
    async (span) => {
      try {
        const result = await fn(span)
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
    },
  )
}

/**
 * Synchronous version of traceSpan.
 */
export function traceSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  options?: SpanOptions & { attributes?: Record<string, string | number | boolean> },
): T {
  return tracer.startActiveSpan(
    name,
    { kind: options?.kind, attributes: options?.attributes },
    (span) => {
      try {
        const result = fn(span)
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
    },
  )
}

/**
 * Get the current active span.
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getActiveSpan()
}

/**
 * Add an event to the current active span.
 */
export function addSpanEvent(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  const span = trace.getActiveSpan()
  if (span) span.addEvent(name, attributes)
}

// ── Lightweight context propagation (preserved for backward compat) ──────

interface TraceContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  operation: string
  startTime: number
  attributes: Record<string, string>
}

const traceStorage = new AsyncLocalStorage<TraceContext>()

export function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex")
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString("hex")
}

export function startSpan<T>(operation: string, fn: () => T, attrs?: Record<string, string>): T {
  const parent = traceStorage.getStore()
  const span: TraceContext = {
    traceId: parent?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parent?.spanId,
    operation,
    startTime: Date.now(),
    attributes: attrs ?? {},
  }
  return traceStorage.run(span, fn)
}

export function getTraceId(): string | null {
  const otelSpan = trace.getActiveSpan()
  if (otelSpan) {
    const ctx = otelSpan.spanContext()
    if (ctx.traceId && ctx.traceId !== "00000000000000000000000000000000") {
      return ctx.traceId
    }
  }
  return traceStorage.getStore()?.traceId ?? null
}

export function getSpanId(): string | null {
  const otelSpan = trace.getActiveSpan()
  if (otelSpan) return otelSpan.spanContext().spanId
  return traceStorage.getStore()?.spanId ?? null
}

export function getTraceHeaders(): Record<string, string> {
  const ctx = traceStorage.getStore()
  if (!ctx) return {}
  return {
    traceparent: `00-${ctx.traceId}-${ctx.spanId}-01`,
    "x-trace-id": ctx.traceId,
    "x-span-id": ctx.spanId,
  }
}

export function endSpan(status: "ok" | "error" = "ok"): void {
  const ctx = traceStorage.getStore()
  if (!ctx) return
  const duration = Date.now() - ctx.startTime
  if (status === "error" || duration > 1000) {
    logger.info(
      { traceId: ctx.traceId, spanId: ctx.spanId, operation: ctx.operation, duration, status },
      "trace span completed",
    )
  }
}

// Re-export OTel API for convenience
export { trace, SpanStatusCode }
export type { Span, SpanOptions }
