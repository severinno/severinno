"use client"

/**
 * AdminServices — all services across providers (read-mostly).
 *
 * Data source: GET /api/admin/services (admin-only, returns ALL incl. inactive)
 * Toggle active or delete: PATCH/DELETE /api/services/[id] (admin override)
 *
 * Filters: search (q), category (hierarchical select), active status,
 * provider (select populated from /api/admin/users?role=PROVIDER).
 */

import * as React from "react"
import {
  Search,
  MoreHorizontal,
  Trash2,
  Power,
  Loader2,
  Wrench,
  X,
  ImageIcon,
  ChevronRight,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPatch, apiDelete } from "@/lib/api"
import {
  SERVICE_UNIT_SHORT,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
import { Skeleton } from "@/components/ui/skeleton"

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

export function AdminServices() {
  const queryClient = useQueryClient()
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [active, setActive] = React.useState<ActiveFilter>("ALL")
  const [categoryFilter, setCategoryFilter] = React.useState<string>("ALL")
  const [providerFilter, setProviderFilter] = React.useState<string>("ALL")
  const [deleteTarget, setDeleteTarget] = React.useState<AdminService | null>(
    null,
  )

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  // Full category list (includes parentId/level so we can build breadcrumb paths)
  const { data: categories } = useQuery({
    queryKey: ["categories", "all-flat"],
    queryFn: () => apiGet<CategoryOption[]>("/api/categories"),
    staleTime: 60_000,
  })

  // Provider options for the filter dropdown (lightweight)
  const { data: providersList } = useQuery({
    queryKey: ["admin", "providers", "options"],
    queryFn: () =>
      apiGet<{ items: ProviderOption[]; total: number }>(
        "/api/admin/users",
        {
          role: "PROVIDER",
          limit: 100,
        },
      ),
    staleTime: 60_000,
  })

  const { data, isLoading, isError } = useQuery({
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
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast.error(errMsg(e, "Falha ao atualizar serviço.")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/services/${id}`),
    onSuccess: () => {
      toast.success("Serviço excluído.")
      invalidate()
      setDeleteTarget(null)
    },
    onError: (e: unknown) =>
      toast.error(errMsg(e, "Não foi possível excluir.")),
  })

  const items = data?.items ?? []

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
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Quick stat pill */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <Wrench className="size-3 text-primary" />
          {(data?.total ?? 0).toLocaleString("pt-BR")} serviço(s) no total
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="s-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título ou descrição"
            className="h-9 pl-8"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
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
          onValueChange={setProviderFilter}
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
          onValueChange={(v) => setActive(v as ActiveFilter)}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          disabled={activeFilterCount === 0}
          className="h-9 gap-1.5 text-muted-foreground"
        >
          <X className="size-3.5" />
          Limpar filtros
        </Button>
        {activeFilterCount > 0 ? (
          <Badge
            variant="outline"
            className="gap-1 border-primary/30 bg-primary/5 text-primary"
          >
            <span className="size-1.5 rounded-full bg-primary" />
            {activeFilterCount} filtro(s) ativo(s)
          </Badge>
        ) : null}
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {items.length > 0
            ? `Mostrando ${items.length} de ${(data?.total ?? 0).toLocaleString(
                "pt-BR",
              )} serviço(s)`
            : "Nenhum serviço"}
        </p>
        {patchMutation.isPending || deleteMutation.isPending ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Salvando...
          </span>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">
                <Wrench className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Não foi possível carregar os serviços
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Verifique sua conexão e tente novamente.
                </p>
              </div>
            </div>
          ) : (
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
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Preço
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ativo
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                      Criado
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i} className="h-14">
                        <TableCell colSpan={7}>
                          <Skeleton className="h-9 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : items.length === 0 ? (
                    <TableRow className="h-14 hover:bg-transparent">
                      <TableCell colSpan={7} className="py-12">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Wrench className="size-7" />
                          </div>
                          <div>
                            <p className="text-base font-semibold">
                              Nenhum serviço encontrado
                            </p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              Ajuste os filtros ou aguarde novos cadastros.
                            </p>
                          </div>
                          {activeFilterCount > 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={clearFilters}
                              className="gap-1.5"
                            >
                              <X className="size-3.5" />
                              Limpar filtros
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((s) => {
                      const path = resolveCategoryPath(s.category, categories)
                      const photo = firstPhoto(s.photos)
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
                            {path.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1">
                                {path.map((c, i) => (
                                  <React.Fragment key={c.id}>
                                    {i > 0 ? (
                                      <ChevronRight className="size-3 text-muted-foreground/60" />
                                    ) : null}
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "h-5 px-2 text-[10px] font-medium",
                                        c.level === 0
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                                          : c.level === 1
                                            ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/40 dark:bg-teal-950/30 dark:text-teal-300"
                                            : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700/40 dark:bg-slate-800/40 dark:text-slate-300",
                                      )}
                                    >
                                      {c.name}
                                    </Badge>
                                  </React.Fragment>
                                ))}
                              </div>
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
                            <Switch
                              checked={s.active}
                              onCheckedChange={(v) =>
                                patchMutation.mutate({
                                  id: s.id,
                                  patch: { active: v },
                                })
                              }
                              disabled={patchMutation.isPending}
                              aria-label="Alternar ativo"
                              className="data-[state=checked]:bg-emerald-600"
                            />
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 text-xs text-muted-foreground tabular-nums sm:table-cell">
                            {formatDate(s.createdAt)}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label="Ações"
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{s.title}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    patchMutation.mutate({
                                      id: s.id,
                                      patch: { active: !s.active },
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
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir serviço?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir{" "}
              <strong className="text-foreground">
                {deleteTarget?.title}
              </strong>
              . Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              disabled={deleteMutation.isPending}
              className="gap-1.5 bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the parent chain (pai › filha › sub) from a leaf category. */
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

function initials(name: string): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message ?? fallback)
  }
  return fallback
}
