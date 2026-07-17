"use client"

/**
 * AdminServices — all services across providers (read-mostly).
 *
 * Data source: GET  /api/admin/services (admin-only, returns ALL incl. inactive)
 * Toggle active: PATCH /api/services/[id] { active }  (admin override)
 * Delete:        DELETE /api/services/[id]            (admin override)
 *
 * Nielsen heuristics covered (design system em admin-shared.tsx):
 *   H1 — TableSkeleton / ErrorState / SavingPill inline / Pagination + ResultCount
 *        (a API devolve TODOS os serviços de uma vez — paginação é client-side
 *         e dá feedback visível do "onde estou" no conjunto)
 *   H2 — Labels pt-BR no domínio do produto (preço, unidade, categoria)
 *   H3 — ConfirmToggleDialog antes de Ativar/Desativar (controle/liberdade)
 *   H4 — StatusBadge (única source of truth p/ tons) substitui badges inline
 *        de categoria; usa o mesmo tom por nível (emerald/teal/zinc) em todo o app
 *   H5 — Switch de Ativo NÃO é instantâneo: abre ConfirmToggleDialog antes do PATCH
 *        Delete continua confirmado via ConfirmDialog (destructive)
 *   H6 — Botão "Ver prestador" visível em cada linha (ação primária de recognition)
 *        ⋮ apenas para ações secundárias (Ativar/Desativar, Excluir)
 *   H7 — Colunas Preço e Criado ordenáveis (client-side, indicador chevron)
 *        Paginação permite pular páginas (não rolagem infinita opaca)
 *   H8 — Categoria: badge ÚNICO da folha + tooltip com caminho completo
 *        "Pai › Filha › Sub" (substitui 3 badges + chevrons poluídos)
 *   H9 — ErrorState com onRetry=refetch; toast.error específico em mutations
 *   H10— Tooltips em Switch, ⋮ e "Ver prestador"; caption de filtros visível
 */

import * as React from "react"
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Eye,
  ImageIcon,
  MoreHorizontal,
  Power,
  SearchX,
  Trash2,
  X,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiDelete, apiGet, apiPatch } from "@/lib/api"
import { type ServiceUnit, SERVICE_UNIT_SHORT } from "@/lib/constants"
import { formatBRL, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useUIStore } from "@/store"

import {
  ConfirmDialog,
  ConfirmToggleDialog,
  EmptyState,
  ErrorState,
  errMsg,
  FilterBar,
  initials,
  PageSectionHeader,
  Pagination,
  ResultCount,
  SavingPill,
  SearchInput,
  StatusBadge,
  TableSkeleton,
  type StatusTone,
} from "./admin-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CategoryOption = {
  id: string
  name: string
  slug: string
  level: number
  parentId?: string | null
  active?: boolean
  order?: number
}

type AdminService = {
  id: string
  title: string
  description: string
  basePrice: number
  unit: ServiceUnit
  active: boolean
  createdAt: string
  photos?: string[] | null
  category?: CategoryOption | null
  provider: {
    id: string
    name: string
    avatarUrl?: string | null
    city?: string | null
    state?: string | null
    verified: boolean
    active: boolean
  }
  _count?: { bookings: number; reviews: number }
}

type AdminServicesResponse = {
  items: AdminService[]
  total: number
}

type ProviderOption = {
  id: string
  name: string
}

type ActiveFilter = "ALL" | "true" | "false"

type SortKey = "basePrice" | "createdAt"
type SortDir = "asc" | "desc"
type SortState = { key: SortKey; dir: SortDir } | null

type PendingToggle = {
  id: string
  name: string
  field: "active"
  currentValue: boolean
} | null

// ---------------------------------------------------------------------------
// Category tone by level (H4 — UMA source of truth, reaproveita StatusBadge)
// level 0 (Pai) → emerald | level 1 (Filha) → teal | level ≥2 (Sub) → zinc
// ---------------------------------------------------------------------------
function categoryTone(level: number | undefined): StatusTone {
  if (!level || level <= 0) return "emerald"
  if (level === 1) return "teal"
  return "zinc"
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AdminServices() {
  const queryClient = useQueryClient()
  const openProvider = useUIStore((s) => s.openProvider)

  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [active, setActive] = React.useState<ActiveFilter>("ALL")
  const [categoryFilter, setCategoryFilter] = React.useState<string>("ALL")
  const [providerFilter, setProviderFilter] = React.useState<string>("ALL")
  const [page, setPage] = React.useState(1)
  const [sort, setSort] = React.useState<SortState>(null)

  const [deleteTarget, setDeleteTarget] = React.useState<AdminService | null>(
    null,
  )
  const [pendingToggle, setPendingToggle] = React.useState<PendingToggle>(null)
  const [patchingId, setPatchingId] = React.useState<string | null>(null)
  const [errorBanner, setErrorBanner] = React.useState<string | null>(null)

  const limit = 10

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  // Full category list (incl. parentId/level — usado p/ resolver caminho)
  const { data: categories } = useQuery({
    queryKey: ["categories", "all-flat"],
    queryFn: () => apiGet<CategoryOption[]>("/api/categories"),
    staleTime: 60_000,
  })

  // Provider options para o filtro (leve)
  const { data: providersList } = useQuery({
    queryKey: ["admin", "providers", "options"],
    queryFn: () =>
      apiGet<{ items: ProviderOption[]; total: number }>(
        "/api/admin/users",
        { role: "PROVIDER", limit: 100 },
      ),
    staleTime: 60_000,
  })

  // API devolve TODOS os serviços de uma vez — filtros server-side, ordenação
  // e paginação client-side (H1 + H7).
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      "admin",
      "services",
      { debouncedQ, active, categoryFilter, providerFilter },
    ],
    queryFn: () =>
      apiGet<AdminServicesResponse>("/api/admin/services", {
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(active !== "ALL" ? { active } : {}),
        ...(categoryFilter !== "ALL" ? { categoryId: categoryFilter } : {}),
        ...(providerFilter !== "ALL" ? { providerId: providerFilter } : {}),
      }),
    staleTime: 15_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "services"] })

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: { active?: boolean }
    }) => apiPatch(`/api/services/${id}`, patch),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/services/${id}`),
  })

  // ---- Derived: sort + paginate client-side --------------------------------
  const allItems = data?.items ?? []
  const total = allItems.length

  const sortedItems = React.useMemo(() => {
    if (!sort) return allItems
    const copy = [...allItems]
    copy.sort((a, b) => {
      let cmp = 0
      if (sort.key === "basePrice") {
        cmp = a.basePrice - b.basePrice
      } else {
        cmp =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      return sort.dir === "asc" ? cmp : -cmp
    })
    return copy
  }, [allItems, sort])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / limit))
  const safePage = Math.min(page, totalPages)
  const pageItems = sortedItems.slice(
    (safePage - 1) * limit,
    safePage * limit,
  )

  const activeFilterCount =
    (debouncedQ ? 1 : 0) +
    (active !== "ALL" ? 1 : 0) +
    (categoryFilter !== "ALL" ? 1 : 0) +
    (providerFilter !== "ALL" ? 1 : 0)

  const clearFilters = () => {
    setQ("")
    setDebouncedQ("")
    setActive("ALL")
    setCategoryFilter("ALL")
    setProviderFilter("ALL")
    setSort(null)
    setPage(1)
  }

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" }
      if (prev.dir === "asc") return { key, dir: "desc" }
      return null
    })
    setPage(1)
  }

  // ---- Mutation handlers ---------------------------------------------------

  const handleToggleConfirm = () => {
    if (!pendingToggle) return
    const { id, currentValue } = pendingToggle
    setPatchingId(id)
    patchMutation.mutate(
      { id, patch: { active: !currentValue } },
      {
        onSuccess: () => {
          invalidate()
          toast.success(
            currentValue ? "Serviço desativado." : "Serviço ativado.",
          )
          setPendingToggle(null)
          setPatchingId(null)
        },
        onError: (e: unknown) => {
          const msg = errMsg(e, "Falha ao atualizar serviço.")
          setErrorBanner(msg)
          toast.error(msg)
          setPendingToggle(null)
          setPatchingId(null)
        },
      },
    )
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Serviço excluído.")
        invalidate()
        setDeleteTarget(null)
      },
      onError: (e: unknown) => {
        const msg = errMsg(e, "Não foi possível excluir o serviço.")
        setErrorBanner(msg)
        toast.error(msg)
        setDeleteTarget(null)
      },
    })
  }

  const renderSortHeader = (
    label: string,
    sortKey: SortKey,
    align: "left" | "right" = "left",
  ) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground",
        align === "right" && "flex-row-reverse",
      )}
    >
      {label}
      {sort?.key === sortKey ? (
        sort.dir === "asc" ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Serviços"
        description="Gerencie o catálogo de serviços oferecidos pelos prestadores."
      />

      {/* Error banner (dismissible) — H9 */}
      {errorBanner ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Erro ao salvar</AlertTitle>
          <AlertDescription>{errorBanner}</AlertDescription>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            aria-label="Dispensar aviso"
            className="absolute right-3 top-3 rounded-md p-1 text-current/70 transition-colors hover:text-current"
          >
            <X className="size-3.5" />
          </button>
        </Alert>
      ) : null}

      {/* Filter bar (H4 consistência) */}
      <FilterBar
        onClear={clearFilters}
        activeCount={activeFilterCount}
        resultCount={total}
        resultLabel={
          total === 1 ? "serviço encontrado" : "serviços encontrados"
        }
      >
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por título ou descrição"
          className="min-w-[200px] flex-1"
        />
        <Select
          value={categoryFilter}
          onValueChange={(v) => {
            setCategoryFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-auto min-w-[160px]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas as categorias</SelectItem>
            {(categories ?? [])
              .slice()
              .sort(
                (a, b) =>
                  a.level - b.level ||
                  (a.order ?? 0) - (b.order ?? 0) ||
                  a.name.localeCompare(b.name),
              )
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="text-muted-foreground">
                    {"—".repeat(c.level)}
                  </span>{" "}
                  {c.name}
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.level === 0
                      ? "pai"
                      : c.level === 1
                        ? "filha"
                        : "sub"}
                  </span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select
          value={providerFilter}
          onValueChange={(v) => {
            setProviderFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-auto min-w-[160px]">
            <SelectValue placeholder="Prestador" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os prestadores</SelectItem>
            {(providersList?.items ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={active}
          onValueChange={(v) => {
            setActive(v as ActiveFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-auto min-w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Status: todos</SelectItem>
            <SelectItem value="true">Apenas ativos</SelectItem>
            <SelectItem value="false">Apenas inativos</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {/* Table area: error / loading / empty / table */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar os serviços"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : pageItems.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum serviço encontrado"
          description="Ajuste os filtros de busca ou aguarde novos cadastros."
          action={
            activeFilterCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="gap-1.5"
              >
                <X className="size-3.5" />
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-11 bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Serviço
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Prestador
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                      Categoria
                    </TableHead>
                    <TableHead className="text-right">
                      {renderSortHeader("Preço", "basePrice", "right")}
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ativo
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {renderSortHeader("Criado", "createdAt")}
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((s) => {
                    const path = resolveCategoryPath(s.category, categories)
                    const leaf = path.length > 0 ? path[path.length - 1] : null
                    const pathStr = path.map((c) => c.name).join(" › ")
                    const photo = firstPhoto(s.photos)
                    const isPatchingThis =
                      patchingId === s.id && patchMutation.isPending
                    return (
                      <TableRow
                        key={s.id}
                        className={cn(
                          "h-14 border-b transition-colors last:border-0 hover:bg-muted/30",
                          !s.active && "opacity-70",
                        )}
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                              {photo ? (
                                <img
                                  src={photo}
                                  alt={s.title}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="size-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {s.title}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {s.description.slice(0, 80)}
                                {s.description.length > 80 ? "…" : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7 shrink-0">
                              {s.provider.avatarUrl ? (
                                <AvatarImage
                                  src={s.provider.avatarUrl}
                                  alt={s.provider.name}
                                />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                                {initials(s.provider.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">
                                {s.provider.name}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {s.provider.city ?? "—"}
                                {s.provider.state
                                  ? `/${s.provider.state}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 md:table-cell">
                          {leaf ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-help">
                                  <StatusBadge tone={categoryTone(leaf.level)}>
                                    {leaf.name}
                                  </StatusBadge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-xs text-xs"
                              >
                                <span className="font-semibold">
                                  Caminho da categoria
                                </span>
                                <span className="mt-0.5 block text-muted-foreground">
                                  {pathStr}
                                </span>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatBRL(s.basePrice)}
                          </span>
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            /{SERVICE_UNIT_SHORT[s.unit]}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {isPatchingThis &&
                          pendingToggle?.field === "active" ? (
                            <SavingPill saving label="Salvando…" />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Switch
                                  checked={s.active}
                                  onCheckedChange={() =>
                                    setPendingToggle({
                                      id: s.id,
                                      name: s.title,
                                      field: "active",
                                      currentValue: s.active,
                                    })
                                  }
                                  disabled={patchMutation.isPending}
                                  aria-label={`Alternar ativo de ${s.title}`}
                                  className="data-[state=checked]:bg-emerald-600"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {s.active
                                  ? "Desativar serviço (com confirmação)"
                                  : "Ativar serviço (com confirmação)"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-xs text-muted-foreground tabular-nums sm:table-cell">
                          {formatDate(s.createdAt)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* H6 — primary action visible */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openProvider(s.provider.id)}
                                  className="h-8 gap-1.5"
                                >
                                  <Eye className="size-3.5" />
                                  <span className="hidden sm:inline">
                                    Ver prestador
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Abrir perfil do prestador
                              </TooltipContent>
                            </Tooltip>
                            {/* H6 — secondary/destructive actions in ⋮ */}
                            <DropdownMenu>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8"
                                      aria-label="Mais ações"
                                    >
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Mais ações</TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{s.title}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPendingToggle({
                                      id: s.id,
                                      name: s.title,
                                      field: "active",
                                      currentValue: s.active,
                                    })
                                  }
                                  className="gap-2"
                                >
                                  <Power className="size-3.5" />
                                  {s.active ? "Desativar" : "Ativar"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget(s)}
                                  className="gap-2 text-red-600 focus:text-red-700"
                                >
                                  <Trash2 className="size-3.5" />
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Result count + Pagination — H1 + H7 */}
            <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 sm:flex-row">
              <ResultCount
                page={safePage}
                limit={limit}
                total={sortedItems.length}
                label="serviços"
              />
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* H5 — confirm toggle active */}
      <ConfirmToggleDialog
        open={!!pendingToggle}
        onOpenChange={(open) => !open && setPendingToggle(null)}
        targetLabel={pendingToggle?.name ?? ""}
        field="active"
        currentValue={pendingToggle?.currentValue ?? false}
        onConfirm={handleToggleConfirm}
      />

      {/* H5 — confirm delete (destructive) */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Excluir serviço?"
        description={
          <>
            Você está prestes a excluir{" "}
            <strong className="text-foreground">
              {deleteTarget?.title}
            </strong>
            . Esta ação não pode ser desfeita e o serviço será removido
            permanentemente do catálogo.
          </>
        }
        confirmLabel={deleteMutation.isPending ? "Excluindo…" : "Excluir"}
        cancelLabel="Cancelar"
        onConfirm={handleDeleteConfirm}
        variant="destructive"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a cadeia pai › filha › sub a partir da categoria folha. */
function resolveCategoryPath(
  leaf: CategoryOption | null | undefined,
  all: CategoryOption[] | undefined,
): CategoryOption[] {
  if (!leaf || !all) return []
  const byId = new Map(all.map((c) => [c.id, c]))
  const path: CategoryOption[] = []
  let current: CategoryOption | undefined = leaf
  let safety = 0
  while (current && safety < 5) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
    safety++
  }
  return path
}

function firstPhoto(photos: string[] | null | undefined): string | null {
  if (!photos || !Array.isArray(photos) || photos.length === 0) return null
  const first = photos[0]
  return typeof first === "string" && first.length > 0 ? first : null
}
