"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function ProfileError({
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
      title="Erro ao carregar perfil"
      description="Não foi possível carregar o perfil deste profissional. Tente novamente ou volte para a página inicial."
    />
  )
}
