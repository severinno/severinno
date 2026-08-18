"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { UserX } from "lucide-react"

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  useEffect(() => {
    console.error("Profile error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="bg-destructive/10 flex size-20 items-center justify-center rounded-full">
        <UserX className="text-destructive size-10" />
      </div>
      <h1 className="mt-6 text-2xl font-bold">Erro ao carregar perfil</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        Não foi possível carregar o perfil deste profissional. Tente novamente ou volte para a
        página inicial.
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
