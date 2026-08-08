"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { AlertTriangle, RefreshCw, Home, Bug } from "lucide-react"
import Link from "next/link"

// ── CSS animations (replaces framer-motion variants) ──────────────────────
// The error boundary is part of every route's INITIAL JS graph, so a static
// framer-motion import here pulls the whole ~40 KB animation library into the
// first-paint bundle of every page. These keyframes reproduce the same
// entrance choreography (container fade → staggered items → icon pop + pulse)
// in plain CSS with zero runtime cost.
const errorCSS = `
  @keyframes svnErrFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes svnErrFadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes svnErrPop {
    from { opacity: 0; transform: scale(0.6) rotate(-10deg); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes svnErrSoftPulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.05); }
  }
`

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [isResetting, setIsResetting] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  // Send to monitoring (Sentry captures automatically via instrumentation)
  useEffect(() => {
    console.error("[ErrorBoundary]", error)
  }, [error])

  // Derive friendly message from error or use generic
  const isNotFound = error.message?.toLowerCase().includes("not found")
  const isNetworkError =
    error.message?.toLowerCase().includes("network") ||
    error.message?.toLowerCase().includes("fetch")
  const statusCode = isNotFound ? "404" : "500"

  const title = isNotFound
    ? "Página não encontrada"
    : isNetworkError
      ? "Erro de conexão"
      : "Erro interno"

  const description = isNotFound
    ? "O conteúdo que você procura não existe ou foi removido."
    : isNetworkError
      ? "Não foi possível conectar ao servidor. Verifique sua conexão."
      : "Ocorreu um erro inesperado. Nossa equipe já foi notificada."

  const handleReset = useCallback(() => {
    setIsResetting(true)
    resetTimer.current = setTimeout(() => {
      reset()
      setIsResetting(false)
    }, 600)
  }, [reset])

  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <style>{errorCSS}</style>
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 size-80 rounded-full bg-red-500/5 blur-3xl dark:bg-red-400/5" />
        <div className="absolute -bottom-40 -right-40 size-96 rounded-full bg-amber-500/5 blur-3xl dark:bg-amber-400/5" />
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center px-4">
        <div
          className="flex w-full max-w-md flex-col items-center text-center"
          style={{ animation: "svnErrFadeIn 0.35s ease-out both" }}
        >
          {/* Animated icon */}
          <div
            className="mb-2"
            style={{
              animation:
                "svnErrPop 0.5s ease-out both, svnErrSoftPulse 2s ease-in-out 1.2s infinite",
            }}
          >
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-red-500/15 dark:bg-red-400/10" />
              <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20">
                <AlertTriangle className="size-9 text-red-500 dark:text-red-400" />
              </div>
            </div>
          </div>

          {/* Status code */}
          <div style={{ animation: "svnErrFadeUp 0.45s ease-out 0.05s both" }}>
            <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">
              {statusCode}
            </span>
          </div>

          {/* Title */}
          <div style={{ animation: "svnErrFadeUp 0.45s ease-out 0.12s both" }}>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
          </div>

          {/* Description */}
          <div style={{ animation: "svnErrFadeUp 0.45s ease-out 0.19s both" }}>
            <p className="mt-3 max-w-sm text-muted-foreground">{description}</p>
          </div>

          {/* Action buttons */}
          <div
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row"
            style={{ animation: "svnErrFadeUp 0.45s ease-out 0.26s both" }}
          >
            <button
              onClick={handleReset}
              disabled={isResetting}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-emerald-600/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={`size-4 ${isResetting ? "animate-spin" : ""}`}
              />
              {isResetting ? "Tentando…" : "Tentar novamente"}
            </button>

            <Link
              href="/"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-[0.97]"
            >
              <Home className="size-4" />
              Voltar ao início
            </Link>
          </div>

          {/* Error digest (dev support) */}
          {error.digest && (
            <div
              className="mt-12 flex items-center gap-1.5"
              style={{ animation: "svnErrFadeUp 0.45s ease-out 0.33s both" }}
            >
              <Bug className="size-3 text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/50">
                Ref: {error.digest}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer
        className="relative border-t bg-muted/20 px-4 py-6"
        style={{ animation: "svnErrFadeIn 0.5s ease-out 0.8s both" }}
      >
        <p className="text-center text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} Severinno. Todos os direitos
          reservados.
        </p>
      </footer>
    </div>
  )
}
