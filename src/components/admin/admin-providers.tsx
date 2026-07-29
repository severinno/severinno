"use client"

/**
 * AdminProviders — lista de prestadores com ações administrativas.
 *
 * Data source: GET  /api/admin/users?role=PROVIDER
 *              PATCH /api/admin/users/[id] { verified?, active? }
 *
 * Nielsen heuristics covered (design system em admin-shared.tsx):
 *   H1 — TableSkeleton / ErrorState / SavingPill inline (não flutuante)
 *   H2 — "Filtro aplicado à página atual" (honestidade sobre filtro client-side)
 *   H4 — VerifiedBadge / ActiveBadge do admin-shared; tipo AdminUser idêntico
 *        ao de admin-users.tsx (mantenha os campos sincronizados)
 *   H5 — Itens do ⋮ (Verificar/Desverificar, Ativar/Desativar) abrem
 *        ConfirmToggleDialog antes de aplicar (sem toggle instantâneo)
 *   H6 — Botão "Ver perfil" visível; ⋮ apenas para ações secundárias.
 *        O item duplicado "Ver perfil público" foi REMOVIDO do ⋮.
 *   H7 — Ordenação client-side por nome e data de cadastro
 *   H8 — REMOVIDO o pill redundante "N prestador(es) no total" no topo
 *        (a ResultCount já mostra essa informação abaixo da tabela)
 *   H9 — Error banner dismissível + toast.error específico + ErrorState com retry
 *   H10— Tooltips em todos os botões de ícone (⋮, Ver perfil)
 *
 * O tipo `AdminUser` é definido de forma IDÊNTICA em admin-users.tsx (H4).
 * Se alterar campos aqui, replique lá.
 */

import * as React from "react"
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Eye,
  HardHat,
  MapPin,
  MoreHorizontal,
  Power,
  SearchX,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  X,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/api"
import { type UserRole } from "@/lib/constants"
import { formatDate } from "@/lib/format"
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
import { useUIStore } from "@/store/ui"

import { Input } from "@/components/ui/input"
import {
  ActiveBadge,
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
  TableSkeleton,
  VerifiedBadge,
} from "./admin-shared"

// ---------------------------------------------------------------------------
// Types — definidos IDÊNTICOS em admin-users.tsx (H4 consistência).
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
export function AdminProviders() {
  const queryClient = useQueryClient()
  const openProvider = useUIStore((s) => s.openProvider)

  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [city, setCity] = React.useState("")
  const [stateFilter, setStateFilter] = React.useState("")
  const [verified, setVerified] = React.useState<VerifiedFilter>("ALL")
  const [active, setActive] = React.useState<ActiveFilter>("ALL")
  const [page, setPage] = React.useState(1)
  const [sort, setSort] = React.useState<SortState>(null)

  const [pendingToggle, setPendingToggle] = React.useState<PendingToggle>(null)
  const [patchingId, setPatchingId] = React.useState<string | null>(null)
  const [errorBanner, setErrorBanner] = React.useState<string | null>(null)

  const limit = 12

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "providers", { debouncedQ, city, stateFilter, verified, active, page, limit }],
    queryFn: () =>
      apiGet<AdminUsersResponse>("/api/admin/users", {
        role: "PROVIDER",
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(city ? { city } : {}),
        ...(stateFilter ? { state: stateFilter } : {}),
        page,
        limit,
      }),
    staleTime: 15_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: { verified?: boolean; active?: boolean }
    }) => apiPatch<{ user: AdminUser }>(`/api/admin/users/${id}`, patch),
  })

  const rawItems = data?.items ?? []
  const filteredItems = React.useMemo(() => {
    return rawItems.filter((p) => {
      if (verified === "true" && !p.verified) return false
      if (verified === "false" && p.verified) return false
      if (active === "true" && !p.active) return false
      if (active === "false" && p.active) return false
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
    (debouncedQ ? 1 : 0) +
    (city ? 1 : 0) +
    (stateFilter ? 1 : 0) +
    (verified !== "ALL" ? 1 : 0) +
    (active !== "ALL" ? 1 : 0)

  const clearFilters = () => {
    setQ("")
    setDebouncedQ("")
    setCity("")
    setStateFilter("")
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

  const handleToggleConfirm = () => {
    if (!pendingToggle) return
    const { id, field, currentValue } = pendingToggle
    setPatchingId(id)
    patchMutation.mutate(
      { id, patch: { [field]: !currentValue } },
      {
        onSuccess: () => {
          invalidate()
          toast.success(
            field === "verified"
              ? currentValue
                ? "Verificação removida."
                : "Prestador verificado."
              : currentValue
              ? "Prestador desativado."
              : "Prestador ativado.",
          )
          setPendingToggle(null)
          setPatchingId(null)
        },
        onError: (e: unknown) => {
          const msg = errMsg(e, "Falha ao atualizar prestador.")
          setErrorBanner(msg)
          toast.error(msg)
          setPendingToggle(null)
          setPatchingId(null)
        },
      },
    )
  }

  const renderSortHeader = (label: string, sortKey: SortKey) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKey)}
      className={cn("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:text-foreground", sort?.key === sortKey ? "text-foreground" : "text-muted-foreground")}
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
        title="Prestadores"
        description="Gerencie prestadores de serviços, verificação e status."
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

      {/* H8 — REMOVIDO o pill "N prestador(es) no total" no topo.
          A ResultCount abaixo da tabela já mostra essa informação. */}

      {/* Filter bar */}
      <FilterBar onClear={clearFilters} activeCount={activeFilterCount}>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por nome, e-mail ou cidade"
          className="min-w-[160px] flex-1"
        />
        <Input
          value={city}
          onChange={(e) => {
            setCity(e.target.value)
            setPage(1)
          }}
          placeholder="Cidade"
          className="h-9 min-w-[120px] flex-1"
        />
        <Input
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value.toUpperCase().slice(0, 2))
            setPage(1)
          }}
          placeholder="UF"
          maxLength={2}
          className="h-9 w-[60px]"
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
          title="Não foi possível carregar os prestadores"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="Nenhum prestador encontrado"
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
        <Card className="rounded-xl border border-border/50 bg-card overflow-hidden shadow-none">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-10 bg-muted/30 hover:bg-muted/30">
                    <TableHead>{renderSortHeader("Prestador", "name")}</TableHead>
                    <TableHead className="hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                      Contato
                    </TableHead>
                    <TableHead className="hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                      Localidade
                    </TableHead>
                    <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Verificação
                    </TableHead>
                    <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {renderSortHeader("Desde", "createdAt")}
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => {
                    const isPatchingThis =
                      patchingId === p.id && patchMutation.isPending
                    const patchingField = isPatchingThis
                      ? pendingToggle?.field ?? null
                      : null
                    return (
                      <TableRow
                        key={p.id}
                        className="h-12 border-b border-border/50 transition-colors last:border-0 hover:bg-muted/20"
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8 shrink-0">
                              {p.avatarUrl ? (
                                <AvatarImage src={p.avatarUrl} alt={p.name} />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                                {initials(p.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {p.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {p.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 md:table-cell">
                          <div className="flex flex-col text-xs">
                            {p.whatsapp ? (
                              <span className="text-foreground/80">
                                {p.whatsapp}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {p.cpfCnpj ? (
                              <span className="font-mono text-muted-foreground">
                                {p.cpfCnpj}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-xs lg:table-cell">
                          {p.city ? (
                            <span className="inline-flex items-center gap-1 text-foreground/80">
                              <MapPin className="size-3 text-muted-foreground" />
                              {p.city}
                              {p.state ? `/${p.state}` : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {patchingField === "verified" ? (
                            <SavingPill saving label="Salvando…" />
                          ) : (
                            <VerifiedBadge verified={p.verified} />
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {patchingField === "active" ? (
                            <SavingPill saving label="Salvando…" />
                          ) : (
                            <ActiveBadge active={p.active} />
                          )}
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-xs text-muted-foreground tabular-nums sm:table-cell">
                          {formatDate(p.createdAt)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* H6 — primary action visible */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openProvider(p.id)}
                                  className="h-8 gap-1.5 text-xs"
                                >
                                  <Eye className="size-3.5" />
                                  <span className="hidden sm:inline">
                                    Ver perfil
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Ver perfil público do prestador
                              </TooltipContent>
                            </Tooltip>
                            {/* H6 — secondary actions in ⋮.
                                "Ver perfil público" REMOVIDO (já é o botão visível). */}
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
                                <DropdownMenuLabel>{p.name}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPendingToggle({
                                      id: p.id,
                                      name: p.name,
                                      field: "verified",
                                      currentValue: p.verified,
                                    })
                                  }
                                  className="gap-2"
                                >
                                  {p.verified ? (
                                    <ShieldX className="size-3.5" />
                                  ) : (
                                    <ShieldCheck className="size-3.5" />
                                  )}
                                  {p.verified
                                    ? "Remover verificação"
                                    : "Verificar"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setPendingToggle({
                                      id: p.id,
                                      name: p.name,
                                      field: "active",
                                      currentValue: p.active,
                                    })
                                  }
                                  className="gap-2"
                                >
                                  <Power className="size-3.5" />
                                  {p.active ? "Desativar" : "Ativar"}
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
          <ResultCount
            page={page}
            limit={limit}
            total={total}
            label="prestadores"
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      ) : null}

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
