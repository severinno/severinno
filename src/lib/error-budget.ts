import logger from "./logger"
import { setFlag, isEnabled } from "./feature-flags"

const TARGET_UPTIME = 0.995
const WINDOW_MS = 60 * 60 * 1000
const state = { requests: 0, errors: 0, windowStart: Date.now() }

export function recordRequest(isError: boolean): void {
  state.requests++
  if (isError) state.errors++
  if (Date.now() - state.windowStart > WINDOW_MS) {
    state.windowStart = Date.now()
    state.requests = isError ? 1 : 0
    state.errors = isError ? 1 : 0
  }
}

export function getErrorBudget(): {
  target: number
  actual: number | null
  remaining: number | null
  exhausted: boolean
} {
  if (state.requests < 100)
    return { target: TARGET_UPTIME, actual: null, remaining: null, exhausted: false }
  const actual = 1 - state.errors / state.requests
  const remaining = actual - TARGET_UPTIME
  const exhausted = remaining < 0
  return {
    target: TARGET_UPTIME,
    actual: +actual.toFixed(6),
    remaining: +remaining.toFixed(6),
    exhausted,
  }
}

export function checkErrorBudgetAndAutoMitigate(): void {
  const budget = getErrorBudget()
  if (!budget.exhausted || budget.actual === null) return
  logger.error(
    { actual: budget.actual, target: budget.target },
    "🚨 Error budget EXHAUSTED — auto-mitigating non-critical features",
  )
  if (isEnabled("circuit-breaker-nominatim")) setFlag("circuit-breaker-nominatim", true)
  if (isEnabled("circuit-breaker-osrm")) setFlag("circuit-breaker-osrm", true)
}
