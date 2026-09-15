"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AutoRetryErrorBoundary error={error} reset={reset} disableAutoRetry />
      <footer className="bg-muted/20 relative mt-auto border-t px-4 py-6">
        <p className="text-muted-foreground/60 text-center text-xs">
          &copy; {new Date().getFullYear()} Severinno. Todos os direitos reservados.
        </p>
      </footer>
    </div>
  )
}
