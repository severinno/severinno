"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function CategoryError({
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
      title="Erro ao carregar categoria"
      description="Não foi possível carregar os profissionais desta categoria. Tente novamente ou explore outras categorias."
    />
  )
}
