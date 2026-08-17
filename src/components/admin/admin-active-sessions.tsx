"use client"

/**
 * AdminActiveSessions — página dedicada de sessões ativas em tempo real.
 *
 * Data source: GET /api/admin/realtime/sessions (proxy do GET /sessions do
 * mini-service realtime, Bearer-protected). Poll a cada 5s (refetchInterval)
 * para o admin acompanhar quem está online AGORA — sem refresh manual
 * (o refresh manual existe como fallback, H7).
 *
 * Lista UMA linha por usuário online (sockets com sessão verificada + join
 * na sala user:{id}):
 *   - Usuário (avatar + nome + e-mail — resolvidos pelo route via users map)
 *   - Perfil (role do socket)
 *   - Sessões (contador; badge âmbar de CONFLITO quando >1 socket simultâneo
 *     — o sintoma do órfão/HMR — com tooltip listando cada socket)
 *   - Entrou (joinedAt — quando a sessão atual começou; tooltip por socket)
 *   - Último kick (motivo: limite de sessões / TTL expirado / revogada, com
 *     histórico recente no tooltip — mesmo contrato do OnlineSessionsCell)
 *
 * Filtros: busca por NOME/E-MAIL (client-side, debounced — a API retorna os
 * online completos, então a busca é instantânea) e por role (segmented
 * button group — mesmo visual dos tabs do AdminUsers, sem aria-controls
 * órfão do Radix Tabs quando não há TabsContent).
 *
 * Degradação graciosa: realtime fora do ar (ok: false) → EmptyState com
 * aviso, nunca quebra o painel (mesmo contrato do OnlineUsersKpiCard).
 *
 * Nielsen heuristics (design system em admin-shared.tsx):
 *   H1 — FreshnessLabel ("Atualizado há X") + poll 5s + refresh manual
 *   H4 — RoleBadge / badges de kick com tons consistentes (admin-shared)
 *   H6 — ícones em todos os badges, tooltips nos campos técnicos
 *   H7 — busca debounced + filtro por role sem paginação (dados são poucos)
 *   H8 — layout de tabela limpo, sem poluição
 *   H9 — ErrorState com retry + EmptyState de degradação do realtime
 *   H10— tooltips explicam conflito de sessão e motivo do último kick
 */

import * as React from "react"
import {
  AlertTriangle,
  CircleUser,
  HardHat,
  RefreshCcw,
  SearchX,
  ShieldCheck,
  Users,
  Wifi,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { type UserRole } from "@/lib/constants"
import { formatDateTime, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import {
  EmptyState,
  ErrorState,
  FilterBar,
  FreshnessLabel,
  initials,
  PageSectionHeader,
  RoleBadge,
  SearchInput,
  TableSkeleton,
} from "./_shared"

// ---------------------------------------------------------------------------
// Types — espelham a resposta do GET /api/admin/realtime/sessions (route.ts)
// ---------------------------------------------------------------------------

type ActiveSocket = {
  userId: string
  role: string
  socketId: string
  connectedAt: string
  joinedAt: string | null
  /** Idade do socket em ms desde o handshake. */
  ageMs?: number
}

type KickReason = "session_limit" | "session_expired" | "revoke"

type KickInfo = {
  reason: KickReason
  at: string
  count: number
  /** Limite de sessões por role aplicado no kick (session_limit). */
  max?: number
  history?: Array<{ reason: KickReason; at: string; socketId: string; max?: number }>
}

type SessionsResponse = {
  ok: boolean
  sessions: Record<string, ActiveSocket[]>
  /** userId → { name, email, avatarUrl } — enriquecido pelo route (fail-open). */
  users?: Record<string, { name: string; email: string; avatarUrl: string | null }>
  totalSockets: number
  onlineUsers: number
  /** Motivo do último kick por usuário + histórico (Redis do realtime). */
  kicks: Record<string, KickInfo>
}

/** Uma linha = um usuário online (agrupa os sockets ativos do usuário). */
type SessionRow = {
  userId: string
  name: string
  email: string
  avatarUrl: string | null
  role: string
  sockets: ActiveSocket[]
  kick: KickInfo | null
}

type RoleFilter = "ALL" | UserRole

const ROLE_TABS: Array<{ value: RoleFilter; label: string; icon: React.ElementType }> = [
  { value: "ALL", label: "Todos", icon: Users },
  { value: "CLIENT", label: "Clientes", icon: CircleUser },
  { value: "PROVIDER", label: "Prestadores", icon: HardHat },
  { value: "ADMIN", label: "Administradores", icon: ShieldCheck },
]

const KICK_META: Record<KickReason, { label: string; className: string }> = {
  session_limit: {
    label: "Limite de sessões",
    className:
      "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300",
  },
  session_expired: {
    label: "TTL expirado",
    className:
      "border-zinc-300/70 bg-zinc-100 text-zinc-700 dark:border-zinc-700/40 dark:bg-zinc-900/40 dark:text-zinc-300",
  },
  revoke: {
    label: "Revogada",
    className:
      "border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/40 dark:text-rose-300",
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminActiveSessions() {
  const [role, setRole] = React.useState<RoleFilter>("ALL")
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")

  // Debounce search (mesmo padrão do AdminUsers) — a busca é client-side
  // sobre a resposta completa de online (sem paginação: o nº de online é
  // pequeno), então o debounce só evita re-render a cada tecla.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  // Poll do GET /sessions do realtime a cada 5s (via proxy admin). staleTime
  // curto para o refetchInterval ter efeito; degrada graciosamente se o
  // realtime estiver fora do ar (ok: false → EmptyState).
  const { data, isLoading, isError, refetch, isRefetching, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "realtime", "sessions", "live"],
    queryFn: () => apiGet<SessionsResponse>("/api/admin/realtime/sessions"),
    refetchInterval: 5_000,
    staleTime: 2_500,
  })

  const rows = React.useMemo<SessionRow[]>(() => {
    const out: SessionRow[] = []
    for (const [userId, sockets] of Object.entries(data?.sessions ?? {})) {
      const user = data?.users?.[userId]
      out.push({
        userId,
        name: user?.name ?? userId,
        email: user?.email ?? "",
        avatarUrl: user?.avatarUrl ?? null,
        role: sockets[0]?.role ?? "unknown",
        sockets,
        kick: data?.kicks?.[userId] ?? null,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [data])

  const filtered = React.useMemo(() => {
    const needle = debouncedQ.toLowerCase()
    return rows.filter((r) => {
      if (role !== "ALL" && r.role !== role) return false
      if (
        needle &&
        !r.name.toLowerCase().includes(needle) &&
        !r.email.toLowerCase().includes(needle)
      ) {
        return false
      }
      return true
    })
  }, [rows, role, debouncedQ])

  const conflictCount = React.useMemo(() => rows.filter((r) => r.sockets.length > 1).length, [rows])
  const online = data?.onlineUsers ?? 0
  const totalSockets = data?.totalSockets ?? 0

  const filterActive = role !== "ALL" || debouncedQ !== ""
  const clearFilters = () => {
    setRole("ALL")
    setQ("")
    setDebouncedQ("")
  }

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Sessões ativas em tempo real"
        description="Quem está online agora no realtime — sockets com sessão verificada e join ativo. Atualiza automaticamente a cada 5s."
        action={
          <div className="flex items-center gap-3">
            <FreshnessLabel updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isRefetching}
              className="h-8 gap-1.5"
              aria-label="Atualizar sessões agora"
            >
              <RefreshCcw className={cn("size-3.5", isRefetching && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        }
      />
      {/* Resumo — H1: visibilidade do estado em tempo real */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Wifi} label="Usuários online" value={online} />
        <SummaryCard icon={ShieldCheck} label="Sockets ativos" value={totalSockets} />
        <SummaryCard
          icon={AlertTriangle}
          label="Conflitos de sessão"
          value={conflictCount}
          highlight={conflictCount > 0}
        />
      </div>{" "}
      {/* Filtros — busca por e-mail/nome + role */}
      <FilterBar onClear={clearFilters} activeCount={filterActive ? 1 : 0}>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por nome ou e-mail"
          className="min-w-[200px] flex-1"
        />
        {/* Segmented role filter (buttons, não Radix Tabs): mesmo visual dos
            tabs do AdminUsers, mas sem aria-controls apontando para conteúdo
            inexistente (a lista inteira vive numa única tabela) — axe verde. */}
        <div
          role="group"
          aria-label="Filtrar por perfil"
          className="bg-card inline-flex h-auto w-fit items-center justify-center gap-1 rounded-lg p-1"
        >
          {ROLE_TABS.map((t) => {
            const active = role === t.value
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={active}
                onClick={() => setRole(t.value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </FilterBar>
      {/* Estado: erro / carregando / realtime fora / vazio / tabela */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar as sessões"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : data?.ok === false ? (
        <EmptyState
          icon={Wifi}
          title="Realtime indisponível"
          description="O serviço de tempo real não respondeu. O painel segue funcionando — as sessões ativas aparecerão quando ele voltar."
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5">
              <RefreshCcw className="size-3.5" />
              Tentar novamente
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={rows.length === 0 ? "Ninguém online agora" : "Nenhuma sessão encontrada"}
          description={
            rows.length === 0
              ? "Quando um usuário entrar na plataforma, a sessão aparece aqui em até 5s."
              : "Ajuste os filtros de busca ou perfil."
          }
          action={
            filterActive ? (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                <RefreshCcw className="size-3.5" />
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
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Usuário
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Perfil
                    </TableHead>
                    <TableHead className="text-muted-foreground text-center text-[11px] font-semibold tracking-wider uppercase">
                      Sessões
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Entrou
                    </TableHead>
                    <TableHead className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Último kick
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow
                      key={row.userId}
                      className="border-border/50 hover:bg-muted/20 h-14 border-b transition-colors last:border-0"
                    >
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 shrink-0">
                            {row.avatarUrl ? (
                              <AvatarImage src={row.avatarUrl} alt={row.name} />
                            ) : null}
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                              {initials(row.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{row.name}</p>
                            <p className="text-muted-foreground truncate text-xs">{row.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <RoleBadge role={row.role as UserRole} />
                      </TableCell>
                      <TableCell className="px-4 py-3 text-center">
                        <SocketsCell sockets={row.sockets} />
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <JoinedCell sockets={row.sockets} />
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <KickCell kick={row.kick} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <Card
      className={cn(
        "border-border/50 rounded-xl border transition-colors",
        highlight &&
          "border-amber-300/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20",
      )}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg",
            highlight && "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs">{label}</p>
          <p className="text-foreground text-xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** Badge de nº de sessões com tooltip por socket (conflito >1 → âmbar). */
function SocketsCell({ sockets }: { sockets: ActiveSocket[] }) {
  const count = sockets.length
  const conflict = count > 1
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
            conflict
              ? "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300"
              : "border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300",
          )}
        >
          {conflict ? <AlertTriangle className="size-3" /> : <Wifi className="size-3" />}
          {count} {count === 1 ? "sessão" : "sessões"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        {conflict ? (
          <p className="text-amber-500">
            Conflito: mais de um socket ativo simultâneo (órfão/HMR ou multi-abas).
          </p>
        ) : null}
        <div className="space-y-0.5">
          {sockets.map((s) => (
            <p key={s.socketId} className="text-muted-foreground text-xs">
              {s.socketId} · {formatRelative(s.connectedAt)}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** Entrou: o join mais recente da sessão atual (tooltip lista todos). */
function JoinedCell({ sockets }: { sockets: ActiveSocket[] }) {
  const newest = [...sockets].sort(
    (a, b) => new Date(b.joinedAt ?? 0).getTime() - new Date(a.joinedAt ?? 0).getTime(),
  )[0]
  const joinedAt = newest?.joinedAt
  if (!joinedAt) return <span className="text-muted-foreground/50 text-xs">—</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground cursor-help text-xs whitespace-nowrap">
          {formatRelative(joinedAt)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p className="text-foreground text-xs font-semibold">Joins desta sessão</p>
        <div className="space-y-0.5">
          {[...sockets]
            .sort(
              (a, b) => new Date(b.joinedAt ?? 0).getTime() - new Date(a.joinedAt ?? 0).getTime(),
            )
            .map((s) => (
              <p key={s.socketId} className="text-muted-foreground text-xs">
                {formatDateTime(s.joinedAt ?? "")} · {s.socketId}
              </p>
            ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** Motivo do último kick + histórico (mesmo contrato do OnlineSessionsCell). */
function KickCell({ kick }: { kick: KickInfo | null }) {
  if (!kick) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground/50 cursor-help text-xs">—</span>
        </TooltipTrigger>
        <TooltipContent>Sem kicks registrados para este usuário.</TooltipContent>
      </Tooltip>
    )
  }
  const meta = KICK_META[kick.reason] ?? KICK_META.session_limit
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
            meta.className,
          )}
        >
          {meta.label}
          <span className="opacity-70">· {kick.count}×</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p className="text-xs">
          <span className="text-foreground font-medium">{meta.label}</span>
          <span className="text-muted-foreground"> · {formatRelative(kick.at)}</span>
        </p>
        {kick.reason === "session_limit" && typeof kick.max === "number" ? (
          <p className="text-muted-foreground text-xs">
            Limite aplicado: {kick.max} socket{kick.max === 1 ? "" : "s"} simultâneo
            {kick.max === 1 ? "" : "s"} (config por role/plano)
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
                    {KICK_META[h.reason]?.label ?? h.reason} · {formatRelative(h.at)}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export default AdminActiveSessions
