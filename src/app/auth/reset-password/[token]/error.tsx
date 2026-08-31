"use client"

import AutoRetryErrorBoundary from "@/components/error-boundary"

export default function ResetPasswordError({
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
      description="Não foi possível redefinir sua senha. O link pode ter expirado. Solicite uma nova redefinição."
    />
  )
}
