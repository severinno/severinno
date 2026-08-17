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
 * O tipo `AdminUser` no admin-providers.tsx inclui campos extras
 * (lat, lng, distanceKm) que o admin-users.tsx não tem, pois
 * a tabela de prestadores exibe distância geográfica. Mantenha os
 * campos BASE sincronizados entre os dois arquivos.
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
  Navigation,
  Power,
  RefreshCcw,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Wifi,
  X,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { type UserRole } from "@/lib/constants"
import { formatDate, formatRelative } from "@/lib/format"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useUIStore } from "@/store/ui"

import {
  ActiveBadge,
  AdminGeoFilter,
  ConfirmToggleDialog,
  DEFAULT_GEO_FILTER,
  EmptyState,
  ErrorState,
  errMsg,
  FilterBar,
  type GeoFilterState,
  initials,
  OnlineUsersKpiCard,
  PageSectionHeader,
  Pagination,
  ResultCount,
  SavingPill,
  SearchInput,
  TableSkeleton,
  VerifiedBadge,
} from "./_shared"

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
  lat?: number | null
  lng?: number | null
  distanceKm?: number | null
}

type AdminUsersResponse = {
  items: AdminUser[]
  total: number
  page: number
  limit: number
}

/** Sessões ativas por usuário (GET /api/admin/realtime/sessions).
 *  Definido IDÊNTICO em admin-users.tsx (H4 consistência) — mantenha sync. */
type RealtimeSessionsResponse = {
  ok: boolean
  sessions: Record<
    string,
    Array<{
      userId: string
      role: string
      socketId: string
      connectedAt: string
      joinedAt: string | null
    }>
  >
  totalSockets: number
  onlineUsers: number
  /** Motivo do último kick por usuário + histórico recente (conflito de
   *  sessão vs revoke vs TTL). Persistido no Redis — sobrevive a restart. */
  kicks: Record<
    string,
    {
      reason: "session_limit" | "session_expired" | "revoke"
      at: string
      count: number
      /** Limite de sessões por role aplicado no kick (session_limit). */
      max?: number
      /** Histórico recente de kicks (bounded, oldest → newest). */
      history?: Array<{
        reason: "session_limit" | "session_expired" | "revoke"
        at: string
        socketId: string
        max?: number
      }>
    }
  >
  /** Config atual de limites por role (default + perRole) — o card de
   *  status do dashboard e o tooltip do conflito a usam (limite real por
   *  role, não o default hardcoded). Espelho do SESSION_LIMITS_CONFIG do
   *  realtime. */
  limits?: { default: number; perRole: Record<string, number> }
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
  const [geoFilter, setGeoFilter] = React.useState<GeoFilterState>(DEFAULT_GEO_FILTER)
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
    queryKey: ["admin", "providers", { debouncedQ, verified, active, page, limit, geoFilter }],
    queryFn: () =>
      apiGet<AdminUsersResponse>("/api/admin/users", {
        role: "PROVIDER",
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(geoFilter.city ? { city: geoFilter.city } : {}),
        ...(geoFilter.state ? { state: geoFilter.state } : {}),
        ...(geoFilter.lat != null ? { lat: String(geoFilter.lat) } : {}),
        ...(geoFilter.lng != null ? { lng: String(geoFilter.lng) } : {}),
        ...(geoFilter.radiusKm ? { radius: String(geoFilter.radiusKm) } : {}),
        page,
        limit,
      }),
    staleTime: 15_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { verified?: boolean; active?: boolean } }) =>
      apiPatch<{ user: AdminUser }>(`/api/admin/users/${id}`, patch),
  })

  // ── Sessões realtime ativas (quem está online) ──────────────────────
  // Mesma fonte do AdminUsers (GET /api/admin/realtime/sessions): refetch a
  // cada 30s, degrada graciosamente se o realtime estiver fora do ar.
  const {
    data: sessionsData,
    refetch: refetchSessions,
    isRefetching: isSessionsRefetching,
  } = useQuery({
    queryKey: ["admin", "realtime", "sessions"],
    queryFn: () => apiGet<RealtimeSessionsResponse>("/api/admin/realtime/sessions"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const revokeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiPost<{ ok: boolean }>(`/api/admin/users/${userId}/revoke-sessions`),
  })

  // userId → sessões ativas (sockets com join na sala user:{id}).
  // O contador por usuário + o último kick alimentam o badge de conflito.
  const sessionsByUser = React.useMemo(() => {
    const map = new Map<string, RealtimeSessionsResponse["sessions"][string]>()
    for (const [userId, sockets] of Object.entries(sessionsData?.sessions ?? {})) {
      map.set(userId, sockets)
    }
    return map
  }, [sessionsData])

  const onlineByUser = React.useMemo(() => {
    const map = new Map<string, boolean>()
    for (const [userId, sockets] of sessionsByUser) {
      map.set(userId, sockets.length > 0)
    }
    return map
  }, [sessionsByUser])

  const rawItems = React.useMemo(() => data?.items ?? [], [data?.items])
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
    (geoFilter.city || geoFilter.state || geoFilter.lat != null ? 1 : 0) +
    (verified !== "ALL" ? 1 : 0) +
    (active !== "ALL" ? 1 : 0)

  const clearFilters = () => {
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
      className={cn(
        "hover:text-foreground inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase transition-colors",
        sort?.key === sortKey ? "text-foreground" : "text-muted-foreground",
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
        title="Prestadores"
        description="Gerencie prestadores de serviços, verificação e status."
      />

      {/* Usuários online — contador de sessões realtime ativas
          (GET /api/admin/realtime/sessions). Atualiza sozinho a cada 30s;
          o refresh manual fica na coluna "Online" da tabela. O tooltip do
          card mostra o breakdown por perfil (clientes/prestadores/admins). */}
      <OnlineUsersKpiCard sessionsData={sessionsData} sessionsByUser={sessionsByUser} />

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
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                <X className="size-3.5" />
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="border-border/50 bg-card overflow-hidden rounded-xl border shadow-none">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 h-10">
                    <TableHead>{renderSortHeader("Prestador", "name")}</TableHead>
                    <TableHead className="text-muted-foreground hidden text-[11px] font-semibold tracking-wider uppercase md:table-cell">
                      Contato
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden text-[11px] font-semibold tracking-wider uppercase lg:table-cell">
                      Localidade
                    </TableHead>
                    {geoFilter.lat != null ? (
                      <TableHead className="text-muted-foreground text-center text-[11px] font-semibold tracking-wider uppercase">
                        Distância
                      </TableHead>
                    ) : null}
                    <TableHead className="text-muted-foreground text-center text-[11px] font-semibold tracking-wider uppercase">
                      Verificação
                    </TableHead>
                    <TableHead className="text-muted-foreground text-center text-[11px] font-semibold tracking-wider uppercase">
                      Status
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase">
                        Online
                        {/* Refresh manual do indicador — atualiza o contador
                            do card e os badges de sessão imediatamente. */}
                        <button
                          type="button"
                          onClick={() => void refetchSessions()}
                          disabled={isSessionsRefetching}
                          aria-label="Atualizar status online"
                          className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded transition-colors disabled:opacity-50"
                        >
                          <RefreshCcw
                            className={cn("size-3", isSessionsRefetching && "animate-spin")}
                          />
                        </button>
                      </span>
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {renderSortHeader("Desde", "createdAt")}
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right text-[11px] font-semibold tracking-wider uppercase">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => {
                    const isPatchingThis = patchingId === p.id && patchMutation.isPending
                    const patchingField = isPatchingThis ? (pendingToggle?.field ?? null) : null
                    return (
                      <TableRow
                        key={p.id}
                        className="border-border/50 hover:bg-muted/20 h-12 border-b transition-colors last:border-0"
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8 shrink-0">
                              {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                                {initials(p.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{p.name}</p>
                              <p className="text-muted-foreground truncate text-xs">{p.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 md:table-cell">
                          <div className="flex flex-col text-xs">
                            {p.whatsapp ? (
                              <span className="text-foreground/80">{p.whatsapp}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {p.cpfCnpj ? (
                              <span className="text-muted-foreground font-mono">{p.cpfCnpj}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-xs lg:table-cell">
                          {p.city ? (
                            <span className="text-foreground/80 inline-flex items-center gap-1">
                              <MapPin className="text-muted-foreground size-3" />
                              {p.city}
                              {p.state ? `/${p.state}` : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {geoFilter.lat != null ? (
                          <TableCell className="px-4 py-3 text-center">
                            {p.distanceKm != null ? (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 text-xs font-medium",
                                  p.distanceKm <= 10
                                    ? "text-emerald-600"
                                    : p.distanceKm <= 50
                                      ? "text-amber-600"
                                      : "text-muted-foreground",
                                )}
                              >
                                <Navigation className="size-3" />
                                {p.distanceKm < 1
                                  ? "< 1 km"
                                  : `${p.distanceKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        ) : null}
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
                        <TableCell className="px-4 py-3 text-center">
                          {/* H1 — visibilidade do status: quem está online agora,
                              antes de o admin desativar a conta. O contador de
                              sessões por usuário + o último kick aparecem aqui:
                              >1 socket simultâneo = conflito (limite do realtime
                              é 1 por usuário) → badge âmbar + tooltip detalhado. */}
                          {onlineByUser.get(p.id) ? (
                            <OnlineSessionsCell
                              userId={p.id}
                              sessionsByUser={sessionsByUser}
                              kicks={sessionsData?.kicks ?? {}}
                              limits={sessionsData?.limits}
                            />
                          ) : (
                            <span className="text-muted-foreground/50 text-[11px]">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden px-4 py-3 text-xs tabular-nums sm:table-cell">
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
                                  <span className="hidden sm:inline">Ver perfil</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Ver perfil público do prestador</TooltipContent>
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
                                  {p.verified ? "Remover verificação" : "Verificar"}
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
                                {/* H1 — revogar sessões SEM desativar: desconecta os
                                    sockets realtime (o usuário precisa re-logar),
                                    mas a conta continua ativa. */}
                                <DropdownMenuItem
                                  onClick={() => {
                                    revokeMutation.mutate(p.id, {
                                      onSuccess: () => {
                                        toast.success(
                                          `Sessões de ${p.name} revogadas. O usuário foi desconectado — a conta continua ativa.`,
                                        )
                                        queryClient.invalidateQueries({
                                          queryKey: ["admin", "realtime", "sessions"],
                                        })
                                      },
                                      onError: (e: unknown) => {
                                        const msg = errMsg(
                                          e,
                                          "Não foi possível revogar as sessões.",
                                        )
                                        setErrorBanner(msg)
                                        toast.error(msg)
                                      },
                                    })
                                  }}
                                  disabled={!onlineByUser.get(p.id) || revokeMutation.isPending}
                                  className="gap-2"
                                >
                                  <RefreshCcw className="size-3.5" />
                                  Revogar sessões
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
          <ResultCount page={page} limit={limit} total={total} label="prestadores" />
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
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

// ---------------------------------------------------------------------------
// OnlineSessionsCell — badge de sessão ativa com contador por usuário,
// indicador de CONFLITO (>1 socket simultâneo = limite do realtime) e o
// motivo do último kick no tooltip (session_limit vs revoke vs expired).
// Espelho exato do definido em admin-users.tsx (H4 consistência).
// ---------------------------------------------------------------------------
function OnlineSessionsCell({
  userId,
  sessionsByUser,
  kicks,
  limits,
}: {
  userId: string
  sessionsByUser: Map<string, RealtimeSessionsResponse["sessions"][string]>
  kicks: RealtimeSessionsResponse["kicks"]
  /** Config atual de limites por role (default + perRole) — resolve o
   *  limite REAL do role do usuário (ex.: PROVIDER=2), não o default. */
  limits?: RealtimeSessionsResponse["limits"]
}) {
  const sockets = sessionsByUser.get(userId) ?? []
  const count = sockets.length
  const kick = kicks[userId]
  const conflict = count > 1

  // Limite real do role do usuário (override por role → fallback global):
  // exibe "limite N" no conflito em vez do default hardcoded 1.
  const role = sockets[0]?.role
  const roleLimit = limits && role ? (limits.perRole[role] ?? limits.default) : undefined

  const kickReasonLabel = (reason: RealtimeSessionsResponse["kicks"][string]["reason"]) =>
    ({
      session_limit: "limite de sessões (2ª aba derrubou a 1ª)",
      session_expired: "sessão expirada (TTL)",
      revoke: "revogada (logout ou ação do admin)",
    })[reason]

  const detail = (
    <>
      <p className="font-medium">
        {count} {count === 1 ? "sessão ativa" : "sessões ativas"} no realtime
      </p>{" "}
      {conflict ? (
        <p className="text-amber-500">
          Conflito: {count} sessões ativas — o limite{role ? ` de ${role}` : ""} é {roleLimit ?? 1}{" "}
          {(roleLimit ?? 1) === 1 ? "socket" : "sockets"} por usuário.
          {/* A cláusula de derrubada SÓ vale acima do limite: com PROVIDER=2 e 2
              sockets nada é derrubado até a 3ª aba — o texto honesto evita
              alarme falso de kick iminente. */}
          {roleLimit !== undefined && count > roleLimit ? (
            <> A mais antiga será derrubada a cada novo join.</>
          ) : (
            <> Dentro do limite — um novo join além dele derruba a mais antiga.</>
          )}
        </p>
      ) : null}
      {kick ? (
        <>
          <p className="text-muted-foreground">
            Último kick: {kickReasonLabel(kick.reason)} · {formatRelative(kick.at)} ({kick.count}×)
          </p>
          {kick.reason === "session_limit" && typeof kick.max === "number" ? (
            <p className="text-muted-foreground">
              Limite aplicado: {kick.max} socket{kick.max === 1 ? "" : "s"} simultâneo
              {kick.max === 1 ? "" : "s"} (config por role)
            </p>
          ) : null}
          {kick.history && kick.history.length > 0 ? (
            <div className="border-border/40 border-t pt-1">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                Histórico de kicks
              </p>
              <ul className="space-y-0.5">
                {kick.history
                  .slice(-3)
                  .reverse()
                  .map((h, i) => (
                    <li key={i} className="text-muted-foreground text-xs">
                      {kickReasonLabel(h.reason)} · {formatRelative(h.at)}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground">Sem kicks registrados.</p>
      )}
      <p className="text-muted-foreground">
        Pode ser desconectada com "Revogar sessões" antes de desativar.
      </p>
    </>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {conflict ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="size-3" />
            {count} sessões
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Wifi className="size-3 animate-pulse" />
            Online · {count}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 space-y-1">{detail}</TooltipContent>
    </Tooltip>
  )
}
