"use client"

/**
 * AutoRetryErrorBoundary — Error boundary with automatic retry.
 *
 * Features:
 * - Auto-retry 3x with exponential backoff (1s, 2s, 4s)
 * - Visual retry progress indicator
 * - Falls back to manual retry after 3 failures
 * - Logs errors to monitoring (Sentry via instrumentation)
 * - Resilient to retry loops (max 3 per mount cycle)
 */

import { useEffect, useState, useRef, useCallback } from "react"
import { motion, type Variants } from "framer-motion"
import { AlertTriangle, RefreshCw, Home, Bug } from "lucide-react"
import Link from "next/link"

const MAX_AUTO_RETRIES = 3
const BACKOFF_BASE_MS = 1000 // 1s, 2s, 4s

const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
}

const iconVariants: Variants = {
  hidden: { scale: 0.6, rotate: -10, opacity: 0 },
  show: {
    scale: 1,
    rotate: 0,
    opacity: 1,
    transition: { duration: 0.5, ease: "easeOut" },
  },
}

type Props = {
  error: Error & { digest?: string }
  reset: () => void
  /** Custom title override */
  title?: string
  /** Custom description override */
  description?: string
  /** Show retry progress bar (default true) */
  showProgress?: boolean
  /** Disable auto-retry (default false) */
  disableAutoRetry?: boolean
}

export default function AutoRetryErrorBoundary({
  error,
  reset,
  title: titleProp,
  description: descriptionProp,
  showProgress = true,
  disableAutoRetry = false,
}: Props) {
  const [retryCount, setRetryCount] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mountedRef = useRef(true)
  // Derived: auto-retry is disabled when explicitly requested or retries exhausted
  const autoRetryEnabled = !disableAutoRetry && retryCount < MAX_AUTO_RETRIES

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [])

  // Classify error for friendly messages
  const isNotFound = error.message?.toLowerCase().includes("not found")
  const isNetworkError =
    error.message?.toLowerCase().includes("network") ||
    error.message?.toLowerCase().includes("fetch") ||
    error.message?.toLowerCase().includes("timeout")
  const isAuthError =
    error.message?.toLowerCase().includes("unauthorized") ||
    error.message?.toLowerCase().includes("sessão")

  const statusCode = isNotFound ? "404" : isAuthError ? "401" : "500"

  const title =
    titleProp ??
    (isNotFound
      ? "Página não encontrada"
      : isNetworkError
        ? "Erro de conexão"
        : isAuthError
          ? "Sessão expirada"
          : "Erro interno")

  const description =
    descriptionProp ??
    (isNotFound
      ? "O conteúdo que você procura não existe ou foi removido."
      : isNetworkError
        ? "Não foi possível conectar ao servidor. Verifique sua conexão."
        : isAuthError
          ? "Sua sessão expirou. Faça login novamente."
          : "Ocorreu um erro inesperado. Nossa equipe já foi notificada.")

  // ── Auto-retry logic ──────────────────────────────────────────────────
  const doRetry = useCallback(() => {
    if (!mountedRef.current) return
    setIsRetrying(true)
    retryTimer.current = setTimeout(() => {
      if (!mountedRef.current) return
      setIsRetrying(false)
      setRetryCount((c) => c + 1)
      reset()
    }, 600)
  }, [reset])

  // Auto-retry on mount with exponential backoff
  // Schedules retries within a single mount cycle (works in tests too)
  useEffect(() => {
    if (!autoRetryEnabled) return

    let attempt = 0
    let timer: ReturnType<typeof setTimeout>

    const scheduleNext = () => {
      if (attempt >= MAX_AUTO_RETRIES || !mountedRef.current) return
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt)
      timer = setTimeout(() => {
        if (!mountedRef.current) return
        attempt++
        setRetryCount(attempt)
        reset()
        // Schedule next retry (reset() may or may not re-mount)
        scheduleNext()
      }, delay)
    }

    scheduleNext()

    return () => {
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount



  const autoRetriesExhausted = retryCount >= MAX_AUTO_RETRIES

  return (
    <div className="from-background via-background to-muted/30 relative flex min-h-[60vh] flex-col bg-gradient-to-b">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 size-80 rounded-full bg-red-500/5 blur-3xl dark:bg-red-400/5" />
        <div className="absolute -right-40 -bottom-40 size-96 rounded-full bg-amber-500/5 blur-3xl dark:bg-amber-400/5" />
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-12">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex w-full max-w-md flex-col items-center text-center"
        >
          {/* Animated icon */}
          <motion.div variants={iconVariants} animate="show" className="mb-2">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-red-500/15 dark:bg-red-400/10" />
              <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20">
                <AlertTriangle className="size-9 text-red-500 dark:text-red-400" />
              </div>
            </div>
          </motion.div>

          {/* Status code */}
          <motion.div variants={item}>
            <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">
              {statusCode}
            </span>
          </motion.div>

          {/* Title */}
          <motion.div variants={item}>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          </motion.div>

          {/* Description */}
          <motion.div variants={item}>
            <p className="text-muted-foreground mt-3 max-w-sm">{description}</p>
          </motion.div>

          {/* Auto-retry status */}
          {showProgress && autoRetryEnabled && !autoRetriesExhausted && (
            <motion.div variants={item} className="mt-6 w-full max-w-xs">
              <div className="flex items-center justify-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <RefreshCw className="size-4 animate-spin" />
                <span>
                  Tentando automaticamente… ({retryCount}/{MAX_AUTO_RETRIES})
                </span>
              </div>
              {/* Progress bar */}
              <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                <motion.div
                  className="h-full rounded-full bg-emerald-500"
                  initial={{ width: "0%" }}
                  animate={{ width: `${(retryCount / MAX_AUTO_RETRIES) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </motion.div>
          )}

          {/* Action buttons */}
          <motion.div variants={item} className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            {(!autoRetryEnabled || autoRetriesExhausted) ? (
              <button
                onClick={doRetry}
                disabled={isRetrying}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-emerald-600/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`size-4 ${isRetrying ? "animate-spin" : ""}`} />
                {isRetrying ? "Tentando…" : "Tentar novamente"}
              </button>
            ) : null}

            <Link
              href="/"
              className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-11 items-center gap-2 rounded-xl border px-5 text-sm font-medium transition-all active:scale-[0.97]"
            >
              <Home className="size-4" />
              Voltar ao início
            </Link>
          </motion.div>

          {/* Error digest (dev support) */}
          {error.digest && (
            <motion.div variants={item} className="mt-12 flex items-center gap-1.5">
              <Bug className="text-muted-foreground/50 size-3" />
              <span className="text-muted-foreground/50 text-xs">Ref: {error.digest}</span>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
