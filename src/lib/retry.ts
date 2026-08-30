export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  onRetry?: (attempt: number, error: Error) => void
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10_000,
    backoffMultiplier = 2,
    onRetry,
  } = opts

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === maxRetries) break
      const delay = Math.min(baseDelayMs * backoffMultiplier ** attempt, maxDelayMs)
      const jitter = delay * (0.5 + Math.random() * 0.5)
      onRetry?.(attempt + 1, lastError)
      await new Promise((r) => setTimeout(r, jitter))
    }
  }
  throw lastError
}
