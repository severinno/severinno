"use client"

/**
 * AdminProviders — list of providers with admin actions.
 *
 * Data source: GET /api/admin/users?role=PROVIDER
 * (this returns full USER_PUBLIC_SELECT shape — verified/active toggles via
 * PATCH /api/admin/users/[id])
 *
 * Note: rating / servicesCount / completedBookings are not returned by the
 * admin/users endpoint. They are surfaced via the "Ver perfil" modal which
 * opens the full provider profile. The table shows what's available.
 */

import * as React from "react"
import {
  Search,
  BadgeCheck,
  Eye,
  Loader2,
  MoreHorizontal,
  HardHat,
  MapPin,
  X,
  UserCheck,
  ShieldQuestion,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
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
import { useUIStore } from "@/store"

type AdminUser = {
  id: string
  name: string
  email: string
  role: "CLIENT" | "PROVIDER" | "ADMIN"
  cpfCnpj?: string | null
  whatsapp?: string | null
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

export function AdminProviders() {
  const queryClient = useQueryClient()
  const openProvider = useUIStore((s) => s.openProvider)
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [verified, setVerified] = React.useState<VerifiedFilter>("ALL")
  const [active, setActive] = React.useState<ActiveFilter>("ALL")
  const [page, setPage] = React.useState(1)
  const limit = 12

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "providers", { debouncedQ, verified, active, page, limit }],
    queryFn: () =>
      apiGet<AdminUsersResponse>("/api/admin/users", {
        role: "PROVIDER",
        ...(debouncedQ ? { q: debouncedQ } : {}),
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
    onSuccess: () => invalidate(),
    onError: (e: unknown) =>
      toast.error(errMsg(e, "Falha ao atualizar prestador.")),
  })

  const rawItems = data?.items ?? []
  const items = React.useMemo(() => {
    return rawItems.filter((p) => {
      if (verified === "true" && !p.verified) return false
      if (verified === "false" && p.verified) return false
      if (active === "true" && !p.active) return false
      if (active === "false" && p.active) return false
      return true
    })
  }, [rawItems, verified, active])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const clientFilterActive = verified !== "ALL" || active !== "ALL"

  const activeFilterCount =
    (debouncedQ ? 1 : 0) +
    (verified !== "ALL" ? 1 : 0) +
    (active !== "ALL" ? 1 : 0)

  const clearFilters = () => {
    setQ("")
    setDebouncedQ("")
    setVerified("ALL")
    setActive("ALL")
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Quick stat pill */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <HardHat className="size-3 text-primary" />
          {total.toLocaleString("pt-BR")} prestador(es) no total
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="p-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, e-mail ou cidade"
            className="h-9 pl-8"
          />
        </div>
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total > 0
            ? `Mostrando ${(page - 1) * limit + 1}–${Math.min(
                page * limit,
                total,
              )} de ${total.toLocaleString("pt-BR")} prestador(es)`
            : "Nenhum prestador"}
        </p>
        {clientFilterActive ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
            <ShieldQuestion className="size-3" />
            Filtro aplicado à página atual
          </span>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">
                <HardHat className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Não foi possível carregar os prestadores
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
                      Prestador
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                      Contato
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">
                      Localidade
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Verificado
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                      Desde
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i} className="h-14">
                        <TableCell colSpan={7}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : items.length === 0 ? (
                    <TableRow className="h-14 hover:bg-transparent">
                      <TableCell colSpan={7} className="py-12">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <HardHat className="size-7" />
                          </div>
                          <div>
                            <p className="text-base font-semibold">
                              Nenhum prestador encontrado
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
                    items.map((p) => (
                      <TableRow
                        key={p.id}
                        className="h-14 border-b transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-9 shrink-0">
                              {p.avatarUrl ? (
                                <AvatarImage
                                  src={p.avatarUrl}
                                  alt={p.name}
                                />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                {initials(p.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                                {p.name}
                                {p.verified ? (
                                  <BadgeCheck className="size-4 shrink-0 text-emerald-600" />
                                ) : null}
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
                          <Switch
                            checked={p.verified}
                            onCheckedChange={(v) => {
                              patchMutation.mutate({
                                id: p.id,
                                patch: { verified: v },
                              })
                              toast.message(
                                v
                                  ? "Prestador verificado."
                                  : "Verificação removida.",
                              )
                            }}
                            disabled={patchMutation.isPending}
                            aria-label="Alternar verificação"
                            className="data-[state=checked]:bg-emerald-600"
                          />
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {p.active ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                            >
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              Ativo
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="gap-1 border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700/40 dark:bg-slate-800/40 dark:text-slate-300"
                            >
                              <span className="size-1.5 rounded-full bg-slate-400" />
                              Inativo
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-xs text-muted-foreground tabular-nums sm:table-cell">
                          {formatDate(p.createdAt)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openProvider(p.id)}
                              className="h-8 gap-1.5"
                            >
                              <Eye className="size-3.5" />
                              <span className="hidden sm:inline">Ver perfil</span>
                            </Button>
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
                                <DropdownMenuLabel>{p.name}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => openProvider(p.id)}
                                  className="gap-2"
                                >
                                  <Eye className="size-3.5" />
                                  Ver perfil público
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    patchMutation.mutate({
                                      id: p.id,
                                      patch: { verified: !p.verified },
                                    })
                                  }
                                  className="gap-2"
                                >
                                  <BadgeCheck className="size-3.5" />
                                  {p.verified
                                    ? "Remover verificação"
                                    : "Verificar"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    patchMutation.mutate({
                                      id: p.id,
                                      patch: { active: !p.active },
                                    })
                                  }
                                  className="gap-2"
                                >
                                  <UserCheck className="size-3.5" />
                                  {p.active ? "Desativar" : "Ativar"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination — hidden when only 1 page */}
          {totalPages > 1 ? (
            <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 sm:flex-row">
              <p className="text-xs text-muted-foreground tabular-nums">
                Página {page} de {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8"
                >
                  Próxima
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {patchMutation.isPending ? (
        <div
          aria-hidden
          className={cn(
            "fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg",
          )}
        >
          <Loader2 className="size-3 animate-spin" />
          Salvando...
        </div>
      ) : null}
    </div>
  )
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
