/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

/**
 * SearchPage — Página de busca independente (acessível via /busca?q=...).
 *
 * Diferente da vitrine SPA, esta página é uma rota real do Next.js que
 * permite SEO, compartilhamento de links e acesso direto sem passar
 * pelo fluxo SPA da página inicial.
 *
 * States:
 *   - Empty (sem query): prompt inicial para o usuário
 *   - Loading (query + carregando): skeleton grid
 *   - Results (dados retornados): grid de ProviderCard
 *   - No results (query + vazio): mensagem amigável + CTAs de exploração
 *   - Error: mensagem de erro + botão de retry
 */

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Search, SearchX, Loader2 } from "lucide-react"
import { motion } from "framer-motion"

import { apiGet, type Category, type ProviderCard as ProviderCardData } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import ProviderCard, { ProviderCardSkeleton } from "@/components/vitrine/provider-card"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

const PAGE_LIMIT = 12

// Popular services para o empty state
const POPULAR_SERVICES = [
  { label: "Encanador", emoji: "🔧" },
  { label: "Eletricista", emoji: "💡" },
  { label: "Pintor", emoji: "🎨" },
  { label: "Diarista", emoji: "🧹" },
  { label: "Pedreiro", emoji: "🧱" },
  { label: "Jardineiro", emoji: "🌿" },
]

export function SearchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialQ = searchParams.get("q") ?? ""
  const initialPage = Math.max(1, Number(searchParams.get("page")) || 1)

  const [query, setQuery] = React.useState(initialQ)
  const [debouncedQ, setDebouncedQ] = React.useState(initialQ)
  const [page, setPage] = React.useState(initialPage)

  // Debounce query para evitar requests a cada tecla
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 350)
    return () => clearTimeout(t)
  }, [query])

  // Atualizar URL quando a busca muda (para compartilhamento)
  React.useEffect(() => {
    const params = new URLSearchParams()
    if (debouncedQ) params.set("q", debouncedQ)
    if (page > 1) params.set("page", String(page))
    const qs = params.toString()
    router.replace(`/busca${qs ? `?${qs}` : ""}`, { scroll: false })
  }, [debouncedQ, page, router])

  // Categorias para filtro lateral
  const categoriesQuery = useQuery({
    queryKey: ["search-categories"],
    queryFn: () => apiGet<Category[]>("/api/categories?level=1"),
    staleTime: 10 * 60 * 1000,
  })
  const _categories: Category[] = categoriesQuery.data ?? []

  // Query de busca
  const searchQuery = useQuery({
    queryKey: ["search", debouncedQ, page],
    queryFn: () =>
      apiGet<{ items: ProviderCardData[]; q: string }>(
        `/api/search?q=${encodeURIComponent(debouncedQ)}&page=${page}&limit=${PAGE_LIMIT}`,
      ),
    enabled: debouncedQ.length >= 2,
    staleTime: 30 * 1000,
  })

  const items = searchQuery.data?.items ?? []
  const total = searchQuery.data?.items?.length ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length >= 2) {
      setDebouncedQ(query.trim())
      setPage(1)
    }
  }

  const handlePopularClick = (label: string) => {
    setQuery(label)
    setDebouncedQ(label)
    setPage(1)
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Hero compacto da busca */}
      <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="text-center text-2xl font-bold sm:text-3xl">O que você precisa?</h1>
          <p className="mt-2 text-center text-sm text-emerald-100/80">
            Encontre profissionais verificados perto de você
          </p>
          <form onSubmit={handleSearch} className="mx-auto mt-6 flex max-w-2xl gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="O que você precisa? Ex.: encanador, pintura…"
                className="text-foreground h-12 border-0 bg-white pl-11 shadow-lg focus-visible:ring-2 focus-visible:ring-emerald-300"
                aria-label="Serviço buscado"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-12 shrink-0 rounded-xl bg-emerald-500 px-6 text-base hover:bg-emerald-400"
              disabled={query.trim().length < 2}
            >
              <Search className="size-4" />
              Buscar
            </Button>
          </form>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Estado vazio — sem query */}
        {!debouncedQ || debouncedQ.length < 2 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-emerald-50">
              <Search className="size-10 text-emerald-600" />
            </div>
            <h2 className="mt-6 text-xl font-semibold">Digite o que você está procurando acima</h2>
            <p className="text-muted-foreground mt-2 max-w-md">
              Digite o que você está procurando acima para encontrar os melhores profissionais perto
              de você.
            </p>
            <div className="mt-8">
              <p className="text-muted-foreground mb-3 text-sm font-medium">
                Serviços mais buscados:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {POPULAR_SERVICES.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handlePopularClick(s.label)}
                    className="bg-card inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <span aria-hidden>{s.emoji}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : searchQuery.isLoading ? (
          /* Estado de carregamento */
          <div>
            <div className="mb-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="mt-1 h-4 w-32" />
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProviderCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : searchQuery.error ? (
          /* Estado de erro */
          <div className="border-destructive/30 bg-destructive/5 flex flex-col items-center rounded-xl border px-6 py-16 text-center">
            <div className="bg-destructive/10 flex size-14 items-center justify-center rounded-full">
              <Loader2 className="text-destructive size-7" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Algo deu errado</h2>
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Não foi possível carregar os resultados. Verifique sua conexão e tente novamente.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => searchQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : items.length === 0 ? (
          /* Sem resultados */
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-amber-50">
              <SearchX className="size-10 text-amber-600" />
            </div>
            <h2 className="mt-6 text-xl font-semibold">Nenhum resultado encontrado</h2>
            <p className="text-muted-foreground mt-2 max-w-md">
              Nenhum resultado encontrado para &ldquo;{debouncedQ}&rdquo;. Tente buscar por outro
              termo ou categoria.
            </p>
            <div className="mt-8">
              <p className="text-muted-foreground mb-3 text-sm font-medium">Sugestões de busca:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {POPULAR_SERVICES.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handlePopularClick(s.label)}
                    className="bg-card inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <span aria-hidden>{s.emoji}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Resultados */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-6">
              <h2 className="text-lg font-semibold">
                {total}{" "}
                <span className="text-muted-foreground">
                  {total === 1 ? "resultado encontrado" : "resultados encontrados"}
                </span>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Resultados para &ldquo;{debouncedQ}&rdquo;
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((provider, index) => (
                <motion.div
                  key={provider.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                >
                  <ProviderCard provider={provider} />
                </motion.div>
              ))}
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <Pagination className="mt-8">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        if (page > 1) setPage((p) => p - 1)
                      }}
                      aria-disabled={page <= 1}
                      className={cn(page <= 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="text-sm tabular-nums">
                      Página {page} de {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        if (page < totalPages) setPage((p) => p + 1)
                      }}
                      aria-disabled={page >= totalPages}
                      className={cn(page >= totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
