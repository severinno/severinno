import type { Metadata } from "next"
import { Suspense } from "react"
import { SearchPage } from "./search-page"

export const metadata: Metadata = {
  title: "Buscar profissionais — Severinno",
  description:
    "Encontre profissionais perto de você. Busque por serviços, categorias ou profissionais.",
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      }
    >
      <SearchPage />
    </Suspense>
  )
}
