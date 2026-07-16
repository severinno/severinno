"use client"

/**
 * AdminUsers — manage all personas (Clients, Providers, Admins).
 *
 * Data source: GET /api/admin/users?role=&q=&page=
 *              PATCH /api/admin/users/[id] { verified?, active?, role?, name?, ... }
 *              DELETE /api/admin/users/[id]
 *
 * Note: the `verified` and `active` filters are applied client-side on the
 * current page's items (the API does not yet support them as query params).
 * A small "Filtro aplicado à página atual" hint is shown when active.
 */

import * as React from "react"
import {
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  BadgeCheck,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  X,
  Users,
  User,
  HardHat,
  ShieldCheck,
  ShieldQuestion,
  CircleUser,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPatch, apiDelete } from "@/lib/api"
import {
  ROLE_LABELS,
  type UserRole,
} from "@/lib/constants"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Types
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

type RoleFilter = "ALL" | UserRole
type VerifiedFilter = "ALL" | "true" | "false"
type ActiveFilter = "ALL" | "true" | "false"

type StatsResponse = {
  usersByRole: Record<string, number>
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AdminUsers() {
  const queryClient = useQueryClient()
  const [role, setRole] = React.useState<RoleFilter>("ALL")
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [verified, setVerified] = React.useState<VerifiedFilter>("ALL")
  const [active, setActive] = React.useState<ActiveFilter>("ALL")
  const [page, setPage] = React.useState(1)

  const [editTarget, setEditTarget] = React.useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<AdminUser | null>(null)

  const limit = 10

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  // Lightweight role counts for the pill tabs (cached 60s, shared with dashboard)
  const { data: stats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiGet<StatsResponse>("/api/admin/stats"),
    staleTime: 60_000,
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "users", { role, debouncedQ, verified, active, page, limit }],
    queryFn: () =>
      apiGet<AdminUsersResponse>("/api/admin/users", {
        ...(role !== "ALL" ? { role } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        page,
        limit,
      }),
    staleTime: 15_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] })

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<AdminUser>
    }) => apiPatch<{ user: AdminUser }>(`/api/admin/users/${id}`, patch),
    onSuccess: () => {
      invalidate()
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Falha ao atualizar usuário."))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/users/${id}`),
    onSuccess: () => {
      toast.success("Usuário excluído.")
      invalidate()
      setDeleteTarget(null)
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Não foi possível excluir o usuário."))
    },
  })

  // Client-side filter for verified/active (API does not support these yet)
  const rawItems = data?.items ?? []
  const items = React.useMemo(() => {
    return rawItems.filter((u) => {
      if (verified === "true" && !u.verified) return false
      if (verified === "false" && u.verified) return false
      if (active === "true" && !u.active) return false
      if (active === "false" && u.active) return false
      return true
    })
  }, [rawItems, verified, active])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const clientFilterActive = verified !== "ALL" || active !== "ALL"

  const activeFilterCount =
    (role !== "ALL" ? 1 : 0) +
    (debouncedQ ? 1 : 0) +
    (verified !== "ALL" ? 1 : 0) +
    (active !== "ALL" ? 1 : 0)

  const clearFilters = () => {
    setRole("ALL")
    setQ("")
    setDebouncedQ("")
    setVerified("ALL")
    setActive("ALL")
    setPage(1)
  }

  const roleCounts = React.useMemo(() => {
    const byRole = stats?.usersByRole ?? {}
    return {
      ALL:
        (byRole.CLIENT ?? 0) + (byRole.PROVIDER ?? 0) + (byRole.ADMIN ?? 0),
      CLIENT: byRole.CLIENT ?? 0,
      PROVIDER: byRole.PROVIDER ?? 0,
      ADMIN: byRole.ADMIN ?? 0,
    }
  }, [stats])

  return (
    <div className="flex flex-col gap-4">
      {/* Pill segmented control — role tabs with counts */}
      <Tabs
        value={role}
        onValueChange={(v) => {
          setRole(v as RoleFilter)
          setPage(1)
        }}
      >
        <TabsList className="h-auto flex-wrap gap-1 bg-card p-1 shadow-sm">
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
              className="h-8 gap-1.5 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
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

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="u-search"
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
              )} de ${total.toLocaleString("pt-BR")} usuário(s)`
            : "Nenhum usuário"}
        </p>
        {clientFilterActive ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
            <ShieldQuestion className="size-3" />
            Filtro aplicado à página atual
          </span>
        ) : null}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">
                <ShieldAlert className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Não foi possível carregar os usuários
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
                      Usuário
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Perfil
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                      Contato
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">
                      Cidade
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Verificado
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                      Criado em
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
                        <TableCell colSpan={8}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : items.length === 0 ? (
                    <TableRow className="h-14 hover:bg-transparent">
                      <TableCell colSpan={8} className="py-12">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <User className="size-7" />
                          </div>
                          <div>
                            <p className="text-base font-semibold">
                              Nenhum usuário encontrado
                            </p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              Ajuste os filtros ou cadastre um novo usuário.
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
                    items.map((u) => (
                      <TableRow
                        key={u.id}
                        className="h-14 border-b transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-9 shrink-0">
                              {u.avatarUrl ? (
                                <AvatarImage
                                  src={u.avatarUrl}
                                  alt={u.name}
                                />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                {initials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {u.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {u.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <RoleBadge role={u.role} />
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 md:table-cell">
                          <div className="flex flex-col text-xs">
                            {u.whatsapp ? (
                              <span className="text-foreground/80">
                                {u.whatsapp}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {u.cpfCnpj ? (
                              <span className="font-mono text-muted-foreground">
                                {u.cpfCnpj}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
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
                          <Switch
                            checked={u.verified}
                            onCheckedChange={(v) => {
                              patchMutation.mutate({
                                id: u.id,
                                patch: { verified: v },
                              })
                              toast.message(
                                v
                                  ? "Usuário marcado como verificado."
                                  : "Verificação removida.",
                              )
                            }}
                            disabled={patchMutation.isPending}
                            aria-label="Alternar verificação"
                            className="data-[state=checked]:bg-emerald-600"
                          />
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          {u.active ? (
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
                          {formatDate(u.createdAt)}
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
                              <DropdownMenuLabel>{u.name}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setEditTarget(u)}
                                className="gap-2"
                              >
                                <Pencil className="size-3.5" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  patchMutation.mutate({
                                    id: u.id,
                                    patch: { verified: !u.verified },
                                  })
                                }
                                className="gap-2"
                              >
                                <BadgeCheck className="size-3.5" />
                                {u.verified
                                  ? "Remover verificação"
                                  : "Marcar verificado"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  patchMutation.mutate({
                                    id: u.id,
                                    patch: { active: !u.active },
                                  })
                                }
                                className="gap-2"
                              >
                                <User className="size-3.5" />
                                {u.active ? "Desativar" : "Ativar"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(u)}
                                className="gap-2 text-red-600 focus:text-red-700"
                              >
                                <Trash2 className="size-3.5" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                  className="h-8 gap-1"
                >
                  <ChevronLeft className="size-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 gap-1"
                >
                  Próxima
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <EditUserDialog
        user={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        submitting={patchMutation.isPending}
        onSubmit={(patch) => {
          if (!editTarget) return
          patchMutation.mutate(
            { id: editTarget.id, patch },
            {
              onSuccess: () => {
                toast.success("Usuário atualizado.")
                setEditTarget(null)
              },
              onError: (e: unknown) =>
                toast.error(errMsg(e, "Falha ao atualizar.")),
            },
          )
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir{" "}
              <strong className="text-foreground">
                {deleteTarget?.name}
              </strong>{" "}
              ({deleteTarget?.email}). Esta ação removerá todos os dados
              relacionados (serviços, agendamentos, mensagens, avaliações) e
              não pode ser desfeita.
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
// Sub-components
// ---------------------------------------------------------------------------

const ROLE_BADGE_CLS: Record<UserRole, string> = {
  CLIENT:
    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
  PROVIDER:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  ADMIN: "bg-primary text-primary-foreground",
}

function RoleBadge({ role }: { role: UserRole }) {
  const cls = ROLE_BADGE_CLS[role]
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 text-[10px] font-medium uppercase tracking-wide", cls)}
    >
      {role === "ADMIN" ? (
        <ShieldCheck className="size-3" />
      ) : role === "PROVIDER" ? (
        <HardHat className="size-3" />
      ) : (
        <CircleUser className="size-3" />
      )}
      {ROLE_LABELS[role]}
    </Badge>
  )
}

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
  const [name, setName] = React.useState("")
  const [role, setRole] = React.useState<UserRole>("CLIENT")
  const [whatsapp, setWhatsapp] = React.useState("")
  const [city, setCity] = React.useState("")
  const [state, setState] = React.useState("")

  React.useEffect(() => {
    if (user) {
      setName(user.name)
      setRole(user.role)
      setWhatsapp(user.whatsapp ?? "")
      setCity(user.city ?? "")
      setState(user.state ?? "")
    }
  }, [user])

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>
            Edição administrativa limitada aos campos abaixo. Para alterar
            senha, o usuário deve usar o fluxo de recuperação.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit({ name, role, whatsapp, city, state })
          }}
          className="flex flex-col gap-3 py-1"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-name">Nome</Label>
            <Input
              id="u-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-role">Perfil</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="u-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLIENT">Cliente</SelectItem>
                <SelectItem value="PROVIDER">Prestador</SelectItem>
                <SelectItem value="ADMIN">Administrador</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-whats">WhatsApp</Label>
              <Input
                id="u-whats"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(11) 99999-9999"
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
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting} className="gap-1.5">
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
