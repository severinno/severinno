"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function BuscaError({
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
      title="Algo deu errado na busca"
      description="Não foi possível carregar os resultados da busca. Tente novamente ou volte para a página inicial."
    />
  )
}
