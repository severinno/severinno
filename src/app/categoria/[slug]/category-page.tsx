"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiGet } from "@/lib/api"
import type { ProviderCard as ProviderCardType } from "@/lib/api"
import ProviderCard from "@/components/vitrine/provider-card"
import { ProviderCardSkeleton } from "@/components/vitrine/provider-card"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

interface Props {
  category: { id: string; name: string; description: string | null }
}

export function CategoryPage({ category }: Props) {
  const [query, setQuery] = useState("")
  const [city, setCity] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["category-providers", category.id, query, city],
    queryFn: () =>
      apiGet<{ items: ProviderCardType[] }>("/api/providers", {
        categoryId: category.id,
        q: query,
        city,
        limit: 20,
      }),
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{category.name}</h1>
        {category.description && (
          <p className="text-muted-foreground mt-2">{category.description}</p>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Buscar serviço..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Input
          placeholder="Cidade"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="max-w-40"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProviderCardSkeleton key={i} />
          ))}
        </div>
      ) : data?.items?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-lg font-medium">Nenhum profissional encontrado</p>
          <p className="text-muted-foreground text-sm">Tente ajustar sua busca ou filtro.</p>
        </div>
      )}
    </div>
  )
}
