"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function DashboardError({
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
      title="Erro no Painel"
      description="Não foi possível carregar seu painel. Tente novamente ou faça login novamente."
    />
  )
}
