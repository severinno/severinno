"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function ForgotPasswordError({
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
      description="Não foi possível carregar a página de recuperação de senha. Tente novamente."
    />
  )
}
