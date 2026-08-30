import logger from "./logger"
import { AsyncLocalStorage } from "async_hooks"
import crypto from "crypto"

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
  return traceStorage.getStore()?.traceId ?? null
}

export function getSpanId(): string | null {
  return traceStorage.getStore()?.spanId ?? null
}

export function getTraceHeaders(): Record<string, string> {
  const ctx = traceStorage.getStore()
  if (!ctx) return {}
  return {
    "traceparent": `00-${ctx.traceId}-${ctx.spanId}-01`,
    "x-trace-id": ctx.traceId,
    "x-span-id": ctx.spanId,
  }
}

export function endSpan(status: "ok" | "error" = "ok"): void {
  const ctx = traceStorage.getStore()
  if (!ctx) return
  const duration = Date.now() - ctx.startTime
  if (status === "error" || duration > 1000) {
    
    logger.info({ traceId: ctx.traceId, spanId: ctx.spanId, operation: ctx.operation, duration, status }, "trace span completed")
  }
}

export function initTracing(): void {
  logger.info("Tracing initialized (lightweight mode)")
}

export function shutdownTracing(): void {
  logger.info("Tracing shutdown")
}
