"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SearchX } from "lucide-react"

export default function BuscaError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error("Busca error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-destructive/10 flex size-20 items-center justify-center rounded-full">
        <SearchX className="text-destructive size-10" />
      </div>
      <h1 className="mt-6 text-2xl font-bold">Algo deu errado na busca</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        Não foi possível carregar os resultados da busca. Tente novamente ou volte para a página
        inicial.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={reset} variant="default">
          Tentar novamente
        </Button>
        <Button onClick={() => router.push("/")} variant="outline">
          Voltar ao início
        </Button>
      </div>
    </div>
  )
}
