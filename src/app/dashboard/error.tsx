"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-destructive/10 flex size-20 items-center justify-center rounded-full">
        <AlertTriangle className="text-destructive size-10" />
      </div>
      <h1 className="mt-6 text-2xl font-bold">Erro no Painel</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        Não foi possível carregar seu painel. Tente novamente ou faça login novamente.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={reset} variant="default">
          Tentar novamente
        </Button>
        <Button onClick={() => (window.location.href = "/")} variant="outline">
          Voltar ao início
        </Button>
      </div>
    </div>
  )
}
