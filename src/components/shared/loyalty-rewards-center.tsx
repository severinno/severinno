"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Award,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  HelpCircle,
  History,
  Info,
  Loader2,
  Percent,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react"

import { apiGet, apiPost } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// ---------------------------------------------------------------------------
// Types (matching backend)
// ---------------------------------------------------------------------------

export type LoyaltyRewardItem = {
  id: string
  title: string
  description: string
  pointsCost: number
  category: "taxa" | "visibilidade" | "parceiro" | "cupom"
  icon: string
  badgeText?: string
  expiresInDays: number
}

export type RedeemedPerk = {
  id: string
  rewardId: string
  title: string
  code: string
  pointsCost: number
  category: "taxa" | "visibilidade" | "parceiro" | "cupom"
  redeemedAt: string
  expiresAt: string
  status: "active" | "used" | "expired"
}

export type LoyaltyTransactionRecord = {
  action: string
  label: string
  points: number
  at: number
}

export type LoyaltyBadge = {
  id: string
  name: string
  emoji: string
  description: string
  earnedAt: string
}

export type LoyaltyStats = {
  points: number
  tier: "bronze" | "prata" | "ouro" | "diamante"
  tierName: string
  badges: LoyaltyBadge[]
  streak: number
  totalBookings: number
  totalReviews: number
  nextTier: { name: string; pointsNeeded: number } | null
}

export type LoyaltyApiResponse = {
  ok: boolean
  stats: LoyaltyStats
  catalog: LoyaltyRewardItem[]
  transactions: LoyaltyTransactionRecord[]
  perks: RedeemedPerk[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  all: "Todos",
  taxa: "Taxa Severinno",
  visibilidade: "Destaque & Visibilidade",
  parceiro: "Parceiros & Materiais",
  cupom: "Cupons de Serviço",
}

function getRewardIcon(category: string, sizeClass = "size-5") {
  switch (category) {
    case "taxa":
      return <Percent className={sizeClass} />
    case "visibilidade":
      return <Sparkles className={sizeClass} />
    case "parceiro":
      return <Wrench className={sizeClass} />
    case "cupom":
      return <Ticket className={sizeClass} />
    default:
      return <Gift className={sizeClass} />
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function LoyaltyRewardsCenter({
  role = "provider",
  onNavigateToServices,
}: {
  role?: "provider" | "client"
  onNavigateToServices?: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  const [selectedReward, setSelectedReward] = React.useState<LoyaltyRewardItem | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [activeCategory, setActiveCategory] = React.useState<string>("all")
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null)

  const { data, isLoading } = useQuery<LoyaltyApiResponse>({
    queryKey: ["loyalty", user?.id],
    queryFn: () => apiGet("/api/loyalty"),
    enabled: !!user,
    staleTime: 15_000,
  })

  const redeemMutation = useMutation({
    mutationFn: (rewardId: string) => apiPost("/api/loyalty", { rewardId }),
    onSuccess: (res: any) => {
      toast.success(res?.message ?? "Benefício resgatado com sucesso no Severinno Clube!")
      queryClient.invalidateQueries({ queryKey: ["loyalty", user?.id] })
      setConfirmOpen(false)
      setSelectedReward(null)
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Erro ao resgatar benefício. Tente novamente.")
    },
  })

  const stats = data?.stats ?? {
    points: 0,
    tier: "bronze" as const,
    tierName: "🥉 Bronze",
    badges: [],
    streak: 0,
    totalBookings: 0,
    totalReviews: 0,
    nextTier: null,
  }

  const catalog = data?.catalog ?? []
  const perks = data?.perks ?? []
  const transactions = data?.transactions ?? []

  const filteredCatalog = React.useMemo(() => {
    if (activeCategory === "all") return catalog
    return catalog.filter((item) => item.category === activeCategory)
  }, [catalog, activeCategory])

  const activePerks = React.useMemo(() => {
    return perks.filter((p) => p.status === "active")
  }, [perks])

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    toast.success(`Código ${code} copiado para a área de transferência!`)
    setTimeout(() => setCopiedCode(null), 3000)
  }

  const progressPercent = React.useMemo(() => {
    if (!stats.nextTier) return 100
    const totalNeeded = stats.points + stats.nextTier.pointsNeeded
    if (totalNeeded <= 0) return 100
    return Math.min(100, Math.max(5, Math.round((stats.points / totalNeeded) * 100)))
  }, [stats])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Loader2 className="text-primary size-7 animate-spin" />
        <p className="text-muted-foreground text-xs font-medium">
          Carregando Clube de Benefícios & Pontos…
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Banner HUD: Anti-Cash Mandate & Core Values */}
      <div className="border-border/60 bg-card/70 relative overflow-hidden rounded-2xl border p-5 shadow-2xs backdrop-blur-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Award className="size-4.5" />
              </span>
              <h3 className="text-foreground text-lg font-bold tracking-tight">
                Severinno Clube &amp; Benefícios
              </h3>
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50/70 text-[10px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              >
                100% Pontos &amp; Vantagens
              </Badge>
            </div>
            <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
              Aqui, sua excelência e indicações acumulam pontos conversíveis em abatimento de taxas,
              destaque de vitrine e descontos em parceiros credenciados. Sem dinheiro físico:
              vantagens reais para acelerar seu negócio.
            </p>
          </div>

          <div className="border-border/50 bg-background/50 flex shrink-0 items-center gap-3 rounded-xl border p-3">
            <div className="text-right">
              <span className="text-muted-foreground block text-[10px] font-semibold tracking-wider uppercase">
                Saldo Atual
              </span>
              <span className="text-foreground text-2xl font-bold tracking-tight tabular-nums">
                {stats.points}
              </span>
              <span className="text-muted-foreground ml-1 text-xs">pts</span>
            </div>
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl font-bold shadow-xs">
              <Flame className="size-5 text-amber-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid: 3 Clean Micro-Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Tier Card */}
        <div className="border-border/60 bg-card/70 flex flex-col justify-between rounded-2xl border p-4.5 shadow-2xs backdrop-blur-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Nível do Clube
              </span>
              <span className="text-xs font-semibold">{stats.tierName}</span>
            </div>
            <p className="text-foreground mt-2 text-xl font-bold tracking-tight capitalize">
              Categoria {stats.tier}
            </p>
            {stats.nextTier ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Faltam{" "}
                <strong className="text-foreground">{stats.nextTier.pointsNeeded} pts</strong> para{" "}
                {stats.nextTier.name}
              </p>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs">Você atingiu o nível máximo 💎</p>
            )}
          </div>
          <div className="mt-3 space-y-1">
            <Progress
              value={progressPercent}
              className="h-1.5"
              aria-label="Progresso para o próximo nível do Clube"
            />
            <div className="text-muted-foreground flex justify-between text-[10px] font-medium">
              <span>{stats.points} pts</span>
              <span>{stats.nextTier ? stats.nextTier.name : "Diamante"}</span>
            </div>
          </div>
        </div>

        {/* Streaks & Performance */}
        <div className="border-border/60 bg-card/70 flex flex-col justify-between rounded-2xl border p-4.5 shadow-2xs backdrop-blur-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Sequência Ativa
              </span>
              <Flame className="size-4 text-amber-500" />
            </div>
            <p className="text-foreground mt-2 text-xl font-bold tracking-tight tabular-nums">
              {stats.streak} {stats.streak === 1 ? "semana" : "semanas"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Atendimentos consecutivos geram bônus de pontos automáticos toda semana.
            </p>
          </div>
          <div className="border-border/40 bg-muted/30 mt-3 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px]">
            <span className="text-muted-foreground">Avaliações recebidas:</span>
            <span className="text-foreground font-semibold tabular-nums">{stats.totalReviews}</span>
          </div>
        </div>

        {/* Active Perks Counter */}
        <div className="border-border/60 bg-card/70 flex flex-col justify-between rounded-2xl border p-4.5 shadow-2xs backdrop-blur-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Benefícios Ativos
              </span>
              <Gift className="text-primary size-4" />
            </div>
            <p className="text-foreground mt-2 text-xl font-bold tracking-tight tabular-nums">
              {activePerks.length} {activePerks.length === 1 ? "cupom" : "cupons"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {activePerks.length > 0
                ? "Vouchers prontos para uso em suas operações ou compras."
                : "Nenhum benefício ativo. Escolha um item no catálogo abaixo."}
            </p>
          </div>
          <div className="border-border/40 bg-muted/30 mt-3 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px]">
            <span className="text-muted-foreground">Total resgatados:</span>
            <span className="text-foreground font-semibold tabular-nums">{perks.length}</span>
          </div>
        </div>
      </div>

      {/* Tabs: Catálogo de Resgate / Benefícios Ativos / Extrato */}
      <Tabs defaultValue="catalog" className="w-full space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="catalog" className="gap-1.5 text-xs font-semibold">
              <Gift className="size-3.5" />
              Catálogo de Resgate ({catalog.length})
            </TabsTrigger>
            <TabsTrigger value="perks" className="gap-1.5 text-xs font-semibold">
              <Ticket className="size-3.5" />
              Meus Benefícios ({activePerks.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5 text-xs font-semibold">
              <History className="size-3.5" />
              Extrato &amp; Conquistas
            </TabsTrigger>
          </TabsList>

          {/* Category Filter Pills (when on catalog) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => (
              <Button
                key={catKey}
                variant={activeCategory === catKey ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveCategory(catKey)}
                className={cn(
                  "h-7 rounded-lg px-2.5 text-[11px] font-medium transition-all",
                  activeCategory === catKey
                    ? "bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {catLabel}
              </Button>
            ))}
          </div>
        </div>

        {/* Tab 1: Catálogo de Resgate */}
        <TabsContent value="catalog" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCatalog.map((item) => {
              const canAfford = stats.points >= item.pointsCost
              const pointsShort = item.pointsCost - stats.points

              return (
                <div
                  key={item.id}
                  className={cn(
                    "group border-border/60 bg-card/70 relative flex flex-col justify-between rounded-2xl border p-5 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:shadow-xs",
                    !canAfford && "opacity-90",
                  )}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                        {getRewardIcon(item.category)}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant="outline"
                          className="border-primary/20 bg-primary/5 text-primary text-[10px] font-semibold"
                        >
                          {item.badgeText ?? "Clube"}
                        </Badge>
                        <span className="text-muted-foreground text-[10px]">
                          Válido por {item.expiresInDays} dias
                        </span>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-foreground text-sm font-bold tracking-tight">
                        {item.title}
                      </h4>
                      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>

                  <div className="border-border/40 mt-5 border-t pt-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-muted-foreground text-xs font-medium">Custo:</span>
                      <span className="text-foreground text-base font-bold tabular-nums">
                        {item.pointsCost} <span className="text-xs font-normal">pts</span>
                      </span>
                    </div>

                    <Button
                      size="sm"
                      disabled={!canAfford || redeemMutation.isPending}
                      onClick={() => {
                        setSelectedReward(item)
                        setConfirmOpen(true)
                      }}
                      className={cn(
                        "w-full rounded-xl text-xs font-semibold shadow-xs transition-all",
                        canAfford
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border-border/60 bg-muted text-muted-foreground hover:bg-muted cursor-not-allowed border",
                      )}
                    >
                      {canAfford ? (
                        <>
                          <Gift className="mr-1.5 size-3.5" />
                          Resgatar Benefício
                        </>
                      ) : (
                        `Faltam ${pointsShort} pts`
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </TabsContent>

        {/* Tab 2: Meus Benefícios Ativos */}
        <TabsContent value="perks" className="space-y-4">
          {activePerks.length === 0 ? (
            <Card className="border-border/60 bg-card/70 rounded-2xl border shadow-2xs backdrop-blur-xs">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
                  <Ticket className="size-6" />
                </div>
                <h4 className="text-foreground text-sm font-bold">Nenhum cupom ativo no momento</h4>
                <p className="text-muted-foreground max-w-sm text-xs">
                  Você ainda não possui benefícios resgatados em vigor. Explore o catálogo acima e
                  utilize seus pontos acumulados.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {activePerks.map((perk) => (
                <div
                  key={perk.id}
                  className="border-border/60 bg-card/70 relative flex flex-col justify-between rounded-2xl border p-5 shadow-2xs backdrop-blur-xs"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        {getRewardIcon(perk.category)}
                      </div>
                      <Badge
                        variant="outline"
                        className="border-emerald-300 bg-emerald-50/70 text-[10px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        Pronto para Uso
                      </Badge>
                    </div>

                    <div>
                      <h4 className="text-foreground text-sm font-bold tracking-tight">
                        {perk.title}
                      </h4>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Resgatado por {perk.pointsCost} pontos &middot; Válido até{" "}
                        {formatDateTime(perk.expiresAt)}
                      </p>
                    </div>

                    {/* Voucher Code Box */}
                    <div className="border-border/60 bg-muted/30 flex items-center justify-between rounded-xl border px-3.5 py-2.5">
                      <div>
                        <span className="text-muted-foreground block text-[9px] font-semibold tracking-wider uppercase">
                          Código do Voucher
                        </span>
                        <code className="text-foreground font-mono text-sm font-bold tracking-wider">
                          {perk.code}
                        </code>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(perk.code)}
                        className="h-8 gap-1.5 rounded-lg text-xs font-semibold"
                      >
                        {copiedCode === perk.code ? (
                          <>
                            <CheckCircle2 className="size-3.5 text-emerald-600" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" />
                            Copiar
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="border-border/40 text-muted-foreground mt-4 flex items-center justify-between border-t pt-3 text-[11px]">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> Status: Ativo
                    </span>
                    <span>100% Severinno Clube</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab 3: Extrato de Pontos & Conquistas */}
        <TabsContent value="history" className="space-y-6">
          {/* Badges Grid */}
          <Card className="border-border/60 bg-card/70 rounded-2xl border shadow-2xs backdrop-blur-xs">
            <CardHeader className="border-border/40 border-b px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-amber-500" />
                Selos e Conquistas do Especialista
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              {stats.badges.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Continue concluindo atendimentos e acumulando avaliações 5 estrelas para
                  desbloquear seus primeiros selos de prestígio.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {stats.badges.map((b) => (
                    <div
                      key={b.id}
                      className="border-border/40 bg-muted/20 flex items-center gap-3 rounded-xl border p-3"
                    >
                      <span className="text-2xl">{b.emoji}</span>
                      <div className="min-w-0">
                        <p className="text-foreground truncate text-xs font-bold">{b.name}</p>
                        <p className="text-muted-foreground truncate text-[10px]">
                          {b.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Statement Timeline */}
          <Card className="border-border/60 bg-card/70 rounded-2xl border shadow-2xs backdrop-blur-xs">
            <CardHeader className="border-border/40 border-b px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <History className="text-muted-foreground size-4" />
                Histórico de Movimentação de Pontos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center text-xs">
                  Nenhuma movimentação de pontos registrada ainda.
                </div>
              ) : (
                <div className="divide-border/40 divide-y">
                  {transactions.map((tx, idx) => (
                    <div
                      key={idx}
                      className="hover:bg-muted/20 flex items-center justify-between px-5 py-3 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <p className="text-foreground text-xs font-semibold">{tx.label}</p>
                        <p className="text-muted-foreground text-[10px]">
                          {formatDateTime(new Date(tx.at).toISOString())}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "text-xs font-bold tabular-nums",
                          tx.points > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-sky-600 dark:text-sky-400",
                        )}
                      >
                        {tx.points > 0 ? `+${tx.points}` : tx.points} pts
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Redemption Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-xl">
                <Gift className="size-4" />
              </div>
              Confirmar Resgate de Benefício
            </DialogTitle>
            <DialogDescription className="text-xs">
              Você está prestes a trocar seus pontos do Severinno Clube por este benefício
              exclusivo.
            </DialogDescription>
          </DialogHeader>

          {selectedReward && (
            <div className="space-y-3 py-2">
              <div className="border-border/50 bg-muted/40 space-y-2 rounded-xl border p-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-foreground text-sm font-bold">{selectedReward.title}</h4>
                  <Badge variant="outline" className="text-primary text-xs font-bold">
                    {selectedReward.pointsCost} pts
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {selectedReward.description}
                </p>
              </div>

              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-muted-foreground">Saldo após resgate:</span>
                <span className="text-foreground font-bold tabular-nums">
                  {stats.points - selectedReward.pointsCost} pts
                </span>
              </div>

              <div className="border-border/50 flex items-start gap-2 rounded-xl border bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-900 dark:text-amber-300">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>
                  <strong>Anti-Cash:</strong> O voucher gerado será exibido na aba &apos;Meus
                  Benefícios&apos; e terá validade de {selectedReward.expiresInDays} dias.
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={redeemMutation.isPending}
              className="rounded-xl text-xs"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => selectedReward && redeemMutation.mutate(selectedReward.id)}
              disabled={redeemMutation.isPending}
              className="bg-primary rounded-xl text-xs font-semibold shadow-xs"
            >
              {redeemMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Processando Resgate…
                </>
              ) : (
                "Confirmar Resgate"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default LoyaltyRewardsCenter
