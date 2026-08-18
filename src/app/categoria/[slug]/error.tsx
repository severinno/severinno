"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FolderSearch } from "lucide-react"

export default function CategoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  useEffect(() => {
    console.error("Category error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-destructive/10 flex size-20 items-center justify-center rounded-full">
        <FolderSearch className="text-destructive size-10" />
      </div>
      <h1 className="mt-6 text-2xl font-bold">Erro ao carregar categoria</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        Não foi possível carregar os profissionais desta categoria. Tente novamente ou explore
        outras categorias.
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
