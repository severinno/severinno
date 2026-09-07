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
    <AutoRetryErrorBoundary
      error={error}
      reset={reset}
      title="Algo deu errado"
      description="Ocorreu um erro no modo offline. Verifique sua conexão."
    />
  )
}
