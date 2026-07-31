"use client"

/**
 * AdminUsers — manage all personas (Clients, Providers, Admins).
 *
 * Data source: GET  /api/admin/users?role=&q=&page=
 *              PATCH /api/admin/users/[id] { verified?, active?, role?, name?, ... }
 *              DELETE /api/admin/users/[id]
 *
 * Nielsen heuristics covered (design system em admin-shared.tsx):
 *   H1 — TableSkeleton / ErrorState / SavingPill inline (visibilidade de status)
 *   H2 — "Filtro aplicado à página atual" (honestidade sobre filtro client-side)
 *   H4 — RoleBadge / ActiveBadge / VerifiedBadge vindos do admin-shared
 *   H5 — Switch + itens do ⋮ abrem ConfirmToggleDialog antes de aplicar
 *   H5 — EditUserDialog mostra Alert amber ao rebaixar ADMIN (ação destrutiva)
 *   H6 — Botão "Editar" visível na linha; ⋮ apenas para ações secundárias/destrutivas
 *   H7 — Ordenação client-side por nome e data de cadastro
 *   H8 — EmptyState / TableSkeleton / layout limpo sem poluição
 *   H9 — Error banner dismissível + toast.error específico + ErrorState com retry
 *   H10— Tooltips em todos os botões de ícone (⋮, Editar, Switch)
 *
 * Note: os filtros `verified` e `active` são aplicados client-side na página
 * atual (a API ainda não suporta esses query params). Um hint amber "Filtro
 * aplicado à página atual" é exibido quando ativo (H2 — honestidade).
 *
 * O tipo `AdminUser` é definido de forma IDÊNTICA em admin-providers.tsx (H4).
 * Se alterar campos aqui, replique lá.
 */

import * as React from "react"
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  CircleUser,
  HardHat,
  Loader2,
  MoreHorizontal,
  Pencil,
  Power,
  SearchX,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiDelete, apiGet, apiPatch } from "@/lib/api"
import { type UserRole } from "@/lib/constants"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import {
  ActiveBadge,
  AdminGeoFilter,
  ConfirmDialog,
  ConfirmToggleDialog,
  DEFAULT_GEO_FILTER,
  EmptyState,
  ErrorState,
  errMsg,
  FilterBar,
  type GeoFilterState,
  initials,
  PageSectionHeader,
  Pagination,
  ResultCount,
  RoleBadge,
  SavingPill,
  SearchInput,
  TableSkeleton,
} from "./_shared"

// ---------------------------------------------------------------------------
// Types — definidos IDÊNTICOS em admin-providers.tsx (H4 consistência).
// ---------------------------------------------------------------------------
type AdminUser = {
  id: string
  name: string
  email: string
  role: UserRole
  cpfCnpj?: string | null
  whatsapp?: string | null
  phone?: string | null
  avatarUrl?: string | null
  city?: string | null
  state?: string | null
  bio?: string | null
  verified: boolean
  active: boolean
  createdAt: string
}

type AdminUsersResponse = {
  items: AdminUser[]
  total: number
  page: number
  limit: number
}

type StatsResponse = {
  usersByRole: Record<string, number>
}

type RoleFilter = "ALL" | UserRole
type VerifiedFilter = "ALL" | "true" | "false"
type ActiveFilter = "ALL" | "true" | "false"

type SortKey = "name" | "createdAt"
type SortDir = "asc" | "desc"
type SortState = { key: SortKey; dir: SortDir } | null

type PendingToggle = {
  id: string
  name: string
  field: "verified" | "active"
  currentValue: boolean
} | null

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AdminUsers() {
  const queryClient = useQueryClient()
  const [role, setRole] = React.useState<RoleFilter>("ALL")
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [geoFilter, setGeoFilter] = React.useState<GeoFilterState>(DEFAULT_GEO_FILTER)
  const [verified, setVerified] = React.useState<VerifiedFilter>("ALL")
  const [active, setActive] = React.useState<ActiveFilter>("ALL")
  const [page, setPage] = React.useState(1)
  const [sort, setSort] = React.useState<SortState>(null)

  const [editTarget, setEditTarget] = React.useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<AdminUser | null>(null)
  const [pendingToggle, setPendingToggle] = React.useState<PendingToggle>(null)
  const [patchingId, setPatchingId] = React.useState<string | null>(null)
  const [errorBanner, setErrorBanner] = React.useState<string | null>(null)

  const limit = 10

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  // Role counts (cached 60s, compartilhado com dashboard)
  const { data: stats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiGet<StatsResponse>("/api/admin/stats"),
    staleTime: 60_000,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "users", { role, debouncedQ, verified, active, page, limit, geoFilter }],
    queryFn: () =>
      apiGet<AdminUsersResponse>("/api/admin/users", {
        ...(role !== "ALL" ? { role } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(geoFilter.lat != null ? { lat: String(geoFilter.lat) } : {}),
        ...(geoFilter.lng != null ? { lng: String(geoFilter.lng) } : {}),
        ...(geoFilter.radiusKm ? { radius: String(geoFilter.radiusKm) } : {}),
        page,
        limit,
      }),
    staleTime: 15_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AdminUser> }) =>
      apiPatch<{ user: AdminUser }>(`/api/admin/users/${id}`, patch),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/users/${id}`),
  })

  // Client-side filter for verified/active (API does not support these yet — H2)
  const rawItems = data?.items ?? []
  const filteredItems = React.useMemo(() => {
    return rawItems.filter((u) => {
      if (verified === "true" && !u.verified) return false
      if (verified === "false" && u.verified) return false
      if (active === "true" && !u.active) return false
      if (active === "false" && u.active) return false
      return true
    })
  }, [rawItems, verified, active])

  const items = React.useMemo(() => {
    if (!sort) return filteredItems
    const sorted = [...filteredItems].sort((a, b) => {
      let cmp = 0
      if (sort.key === "name") cmp = a.name.localeCompare(b.name, "pt-BR")
      else if (sort.key === "createdAt")
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return sort.dir === "asc" ? cmp : -cmp
    })
    return sorted
  }, [filteredItems, sort])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const clientFilterActive = verified !== "ALL" || active !== "ALL"

  const activeFilterCount =
    (role !== "ALL" ? 1 : 0) +
    (debouncedQ ? 1 : 0) +
    (geoFilter.city || geoFilter.lat != null ? 1 : 0) +
    (verified !== "ALL" ? 1 : 0) +
    (active !== "ALL" ? 1 : 0)

  const clearFilters = () => {
    setRole("ALL")
    setQ("")
    setDebouncedQ("")
    setGeoFilter(DEFAULT_GEO_FILTER)
    setVerified("ALL")
    setActive("ALL")
    setSort(null)
    setPage(1)
  }

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" }
      if (prev.dir === "asc") return { key, dir: "desc" }
      return null
    })
  }

  const roleCounts = React.useMemo(() => {
    const byRole = stats?.usersByRole ?? {}
    return {
      ALL: (byRole.CLIENT ?? 0) + (byRole.PROVIDER ?? 0) + (byRole.ADMIN ?? 0),
      CLIENT: byRole.CLIENT ?? 0,
      PROVIDER: byRole.PROVIDER ?? 0,
      ADMIN: byRole.ADMIN ?? 0,
    }
  }, [stats])

  // ---- Mutation handlers ---------------------------------------------------

  const handleToggleConfirm = () => {
    if (!pendingToggle) return
    const { id, field, currentValue } = pendingToggle
    setPatchingId(id)
    patchMutation.mutate(
      { id, patch: { [field]: !currentValue } as Partial<AdminUser> },
      {
        onSuccess: () => {
          invalidate()
          toast.success(
            field === "verified"
              ? currentValue
                ? "Verificação removida."
                : "Usuário marcado como verificado."
              : currentValue
                ? "Usuário desativado."
                : "Usuário ativado.",
          )
          setPendingToggle(null)
          setPatchingId(null)
        },
        onError: (e: unknown) => {
          const msg = errMsg(e, "Falha ao atualizar usuário.")
          setErrorBanner(msg)
          toast.error(msg)
          setPendingToggle(null)
          setPatchingId(null)
        },
      },
    )
  }

  const handleEditSubmit = (patch: Partial<AdminUser>) => {
    if (!editTarget) return
    patchMutation.mutate(
      { id: editTarget.id, patch },
      {
        onSuccess: () => {
          invalidate()
          toast.success("Usuário atualizado.")
          setEditTarget(null)
        },
        onError: (e: unknown) => {
          const msg = errMsg(e, "Falha ao atualizar usuário.")
          setErrorBanner(msg)
          toast.error(msg)
        },
      },
    )
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Usuário excluído.")
        invalidate()
        setDeleteTarget(null)
      },
      onError: (e: unknown) => {
        const msg = errMsg(e, "Não foi possível excluir o usuário.")
        setErrorBanner(msg)
        toast.error(msg)
        setDeleteTarget(null)
      },
    })
  }

  const renderSortHeader = (label: string, sortKey: SortKey) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKey)}
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase transition-colors",
        sort?.key === sortKey && "text-foreground",
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
        title="Usuários"
        description="Gerencie clientes, prestadores e administradores da plataforma."
      />

      {/* Role tabs with counts */}
      <Tabs
        value={role}
        onValueChange={(v) => {
          setRole(v as RoleFilter)
          setPage(1)
        }}
      >
        <TabsList className="bg-card h-auto flex-wrap gap-1 p-1">
          {(
            [
              { value: "ALL", label: "Todos", icon: Users },
              { value: "CLIENT", label: "Clientes", icon: CircleUser },
              { value: "PROVIDER", label: "Prestadores", icon: HardHat },
              { value: "ADMIN", label: "Administradores", icon: ShieldCheck },
            ] as const
          ).map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-8 gap-1.5 rounded-md px-3 text-sm"
            >
              <t.icon className="size-3.5" />
              {t.label}
              <span
                className={cn(
                  "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  role === t.value
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {roleCounts[t.value]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
            className="absolute top-3 right-3 rounded-md p-1 text-current/70 transition-colors hover:text-current"
          >
            <X className="size-3.5" />
          </button>
        </Alert>
      ) : null}

      {/* Filter bar */}
      <FilterBar onClear={clearFilters} activeCount={activeFilterCount}>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por nome, e-mail ou cidade"
          className="min-w-[200px] flex-1"
        />
        <AdminGeoFilter
          value={geoFilter}
          onChange={(next) => {
            setGeoFilter(next)
            setPage(1)
          }}
        />
        <Select
          value={verified}
          onValueChange={(v) => {
            setVerified(v as VerifiedFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-auto min-w-[150px]">
            <SelectValue placeholder="Verificação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Verificação: todas</SelectItem>
            <SelectItem value="true">Apenas verificados</SelectItem>
            <SelectItem value="false">Aguardando verificação</SelectItem>
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

      {/* Honest about client-side filter — H2 */}
      {clientFilterActive ? (
        <span className="-mt-2 inline-flex items-center gap-1 text-[11px] text-amber-600/80 dark:text-amber-400/80">
          <ShieldQuestion className="size-3" />
          Filtro de verificação/status aplicado apenas à página atual
        </span>
      ) : null}

      {/* Table area: error / loading / empty / table */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar os usuários"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum usuário encontrado"
          description="Ajuste os filtros de busca ou cadastre um novo usuário."
          action={
            activeFilterCount > 0 ? (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                <X className="size-3.5" />
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="border-border/50 bg-card overflow-hidden rounded-xl border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 h-10">
                    <TableHead>{renderSortHeader("Usuário", "name")}</TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Perfil
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden text-[11px] font-semibold tracking-wider uppercase md:table-cell">
                      Contato
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden text-[11px] font-semibold tracking-wider uppercase lg:table-cell">
                      Cidade
                    </TableHead>
                    <TableHead className="text-muted-foreground text-center text-[11px] font-semibold tracking-wider uppercase">
                      Verificado
                    </TableHead>
                    <TableHead className="text-muted-foreground text-center text-[11px] font-semibold tracking-wider uppercase">
                      Status
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {renderSortHeader("Criado em", "createdAt")}
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-[11px] font-semibold tracking-wider uppercase">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((u) => {
                    const isPatchingThis = patchingId === u.id && patchMutation.isPending
                    const patchingField = isPatchingThis ? (pendingToggle?.field ?? null) : null
                    return (
                      <TableRow
                        key={u.id}
                        className="border-border/50 hover:bg-muted/20 h-12 border-b transition-colors last:border-0"
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8 shrink-0">
                              {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt={u.name} /> : null}
                              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                                {initials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{u.name}</p>
                              <p className="text-muted-foreground truncate text-xs">{u.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <RoleBadge role={u.role} />
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 md:table-cell">
                          <div className="flex flex-col text-xs">
                            {u.whatsapp ? (
                              <span className="text-foreground/80">{u.whatsapp}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {u.cpfCnpj ? (
                              <span className="text-muted-foreground font-mono">{u.cpfCnpj}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden px-4 py-3 text-xs lg:table-cell">
                          {u.city ? (
                            <span className="text-foreground/80">
                              {u.city}
                              {u.state ? `/${u.state}` : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {patchingField === "verified" ? (
                            <SavingPill saving label="Salvando…" />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Switch
                                  checked={u.verified}
                                  onCheckedChange={() =>
                                    setPendingToggle({
                                      id: u.id,
                                      name: u.name,
                                      field: "verified",
                                      currentValue: u.verified,
                                    })
                                  }
                                  disabled={patchMutation.isPending}
                                  aria-label={`Alternar verificação de ${u.name}`}
                                  className="data-[state=checked]:bg-emerald-600"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {u.verified
                                  ? "Remover verificação (com confirmação)"
                                  : "Marcar como verificado (com confirmação)"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {patchingField === "active" ? (
                            <SavingPill saving label="Salvando…" />
                          ) : (
                            <ActiveBadge active={u.active} />
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden px-4 py-3 text-xs tabular-nums sm:table-cell">
                          {formatDate(u.createdAt)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* H6 — primary action visible */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditTarget(u)}
                                  className="h-8 gap-1.5"
                                >
                                  <Pencil className="size-3.5" />
                                  <span className="hidden sm:inline">Editar</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Editar usuário</TooltipContent>
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
                                <DropdownMenuLabel>{u.name}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPendingToggle({
                                      id: u.id,
                                      name: u.name,
                                      field: "verified",
                                      currentValue: u.verified,
                                    })
                                  }
                                  className="gap-2"
                                >
                                  {u.verified ? (
                                    <ShieldX className="size-3.5" />
                                  ) : (
                                    <ShieldCheck className="size-3.5" />
                                  )}
                                  {u.verified ? "Remover verificação" : "Marcar verificado"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPendingToggle({
                                      id: u.id,
                                      name: u.name,
                                      field: "active",
                                      currentValue: u.active,
                                    })
                                  }
                                  className="gap-2"
                                >
                                  <Power className="size-3.5" />
                                  {u.active ? "Desativar" : "Ativar"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget(u)}
                                  className="gap-2 text-rose-600"
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
          </CardContent>
        </Card>
      )}

      {/* Result count + pagination — only when there are results */}
      {!isError && !isLoading && items.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ResultCount page={page} limit={limit} total={total} label="usuários" />
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      ) : null}

      {/* Edit dialog — H5: Alert amber ao rebaixar ADMIN */}
      <EditUserDialog
        user={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        submitting={patchMutation.isPending && !!editTarget}
        onSubmit={handleEditSubmit}
      />

      {/* Delete confirmation — H5: ConfirmDialog do admin-shared */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Excluir usuário?"
        description={
          <>
            Você está prestes a excluir{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong> ({deleteTarget?.email}
            ). Esta ação removerá todos os dados relacionados (serviços, agendamentos, mensagens,
            avaliações) e não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />

      {/* Toggle confirmation — H5: ConfirmToggleDialog do admin-shared */}
      <ConfirmToggleDialog
        open={!!pendingToggle}
        onOpenChange={(open) => !open && setPendingToggle(null)}
        targetLabel={pendingToggle?.name ?? ""}
        field={pendingToggle?.field ?? "verified"}
        currentValue={pendingToggle?.currentValue ?? false}
        onConfirm={handleToggleConfirm}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// EditUserDialog — H5: Alert amber ao rebaixar ADMIN (ação destrutiva)
// ---------------------------------------------------------------------------
function EditUserDialog({
  user,
  onOpenChange,
  submitting,
  onSubmit,
}: {
  user: AdminUser | null
  onOpenChange: (open: boolean) => void
  submitting: boolean
  onSubmit: (patch: Partial<AdminUser>) => void
}) {
  // Derive initial values from user prop; Dialog key forces re-mount on change
  const [name, setName] = React.useState(user?.name ?? "")
  const [role, setRole] = React.useState<UserRole>(user?.role ?? "CLIENT")
  const [whatsapp, setWhatsapp] = React.useState(user?.whatsapp ?? "")
  const [city, setCity] = React.useState(user?.city ?? "")
  const [state, setState] = React.useState(user?.state ?? "")

  // H5: warning when demoting from ADMIN
  const demotingFromAdmin = user?.role === "ADMIN" && role !== "ADMIN"

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent key={user?.id ?? "closed"} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Editar usuário</DialogTitle>
          <DialogDescription>
            Edição administrativa limitada aos campos abaixo. Para alterar a senha, o usuário deve
            usar o fluxo de recuperação.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit({ name, role, whatsapp, city, state })
          }}
          className="flex flex-col gap-4 py-1"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-name">Nome</Label>
            <Input
              id="u-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="border-input/60 h-9 rounded-lg"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-role">Perfil</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="u-role" className="border-input/60 h-9 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLIENT">Cliente</SelectItem>
                <SelectItem value="PROVIDER">Prestador</SelectItem>
                <SelectItem value="ADMIN">Administrador</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* H5 — Destructive action warning */}
          {demotingFromAdmin ? (
            <Alert className="border-amber-200/60 bg-amber-50/50 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="size-4" />
              <AlertTitle>Remover privilégios de administrador?</AlertTitle>
              <AlertDescription>
                Este usuário perderá acesso ao painel admin. Ação destrutiva — confirme antes de
                salvar.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-whats">WhatsApp</Label>
              <Input
                id="u-whats"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(11) 99999-9999"
                className="border-input/60 h-9 rounded-lg"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-state">UF</Label>
              <Input
                id="u-state"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                placeholder="SP"
                className="border-input/60 h-9 rounded-lg"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-city">Cidade</Label>
            <Input
              id="u-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="São Paulo"
              className="border-input/60 h-9 rounded-lg"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting} className="gap-1.5">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
