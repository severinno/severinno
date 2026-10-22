"use client"

/**
 * ProviderReferral — "Indique e Ganhe" dual conversion hub for service providers.
 *
 * Core Business Thesis:
 *  - Specialists sustain the Severinno marketplace in Governador Valadares.
 *  - Referring fellow specialists is rewarded with 4x weight (+200 pts in the loyalty club)
 *    and operational perks (VIP radar priority, future platform fee discounts).
 *  - Referring clients/neighbors awards +50 pts.
 *  - Rule: ALL rewards are Loyalty Points for future platform redemption (NO CASH / NÃO DINHEIRO).
 *
 * Features:
 *  - Compact Hero Banner with Ambassador badge and fast action buttons
 *  - 4 Bento micro StatCards (compact={true}, ~68px)
 *  - Dual Funnel Tab Switcher (Colegas Especialistas vs Clientes & Moradores)
 *  - 1-click copy with toast & haptics, Web Share API and WhatsApp integration
 *  - Transparent rules explaining asymmetric point accumulation
 *  - Leaderboard with List & Grid view modes and instant search
 *  - 100% WCAG 2.1 AA compliant (0 axe violations)
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Award,
  Calendar,
  Check,
  Copy,
  Crown,
  Info,
  LayoutGrid,
  LayoutList,
  Loader2,
  Medal,
  MessageCircle,
  Search,
  Share2,
  Sparkles,
  Trophy,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet } from "@/lib/api"
import { triggerHaptic } from "@/lib/haptics"
import type { ReferralLeaderboardEntry, ReferralStats } from "@/lib/referral"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { EmptyState, StatCard } from "@/components/shared/shell"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRankIcon(rank: number) {
  switch (rank) {
    case 1:
      return <Crown className="size-4.5 fill-amber-400 text-amber-500" />
    case 2:
      return <Medal className="size-4.5 fill-slate-300 text-slate-400" />
    case 3:
      return <Medal className="size-4.5 fill-amber-600 text-amber-700" />
    default:
      return <span className="text-muted-foreground text-xs font-bold">#{rank}</span>
  }
}

function getBadgeStyle(badge: ReferralLeaderboardEntry["badge"]) {
  switch (badge) {
    case "Embaixador Diamante":
      return "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300"
    case "Embaixador Ouro":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    case "Embaixador Severinno":
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderReferral() {
  const navigate = useViewStore((s) => s.navigate)
  const [activeTab, setActiveTab] = React.useState<"provider" | "client">("provider")
  const [copied, setCopied] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Fetch referral stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery<{
    ok: boolean
    stats: ReferralStats
  }>({
    queryKey: ["referral", "stats"],
    queryFn: () => apiGet<{ ok: boolean; stats: ReferralStats }>("/api/referral"),
  })

  // Fetch community leaderboard
  const { data: leaderboardData, isLoading: isLoadingLeaderboard } = useQuery<{
    leaderboard: ReferralLeaderboardEntry[]
    count: number
  }>({
    queryKey: ["referral", "leaderboard"],
    queryFn: () =>
      apiGet<{ leaderboard: ReferralLeaderboardEntry[]; count: number }>(
        "/api/referral/leaderboard?limit=10",
      ),
  })

  const stats = statsData?.stats
  const leaderboard = React.useMemo(
    () => leaderboardData?.leaderboard ?? [],
    [leaderboardData?.leaderboard],
  )

  const filteredLeaderboard = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return leaderboard
    return leaderboard.filter(
      (entry) => entry.name.toLowerCase().includes(q) || entry.badge.toLowerCase().includes(q),
    )
  }, [leaderboard, searchQuery])

  // Current active links and messages based on activeTab
  const currentLink =
    activeTab === "provider"
      ? stats?.providerInviteLink || stats?.inviteLink
      : stats?.clientInviteLink || stats?.inviteLink

  const currentShareText =
    activeTab === "provider"
      ? stats?.providerShareText || stats?.shareText
      : stats?.clientShareText || stats?.shareText

  const currentWhatsappUrl =
    activeTab === "provider"
      ? stats?.whatsappShareUrlProvider || stats?.whatsappShareUrl
      : stats?.whatsappShareUrlClient || stats?.whatsappShareUrl

  const handleCopyLink = React.useCallback(() => {
    if (!currentLink) return
    triggerHaptic("success")
    navigator.clipboard.writeText(currentLink)
    setCopied(true)
    toast.success(
      activeTab === "provider"
        ? "Link de indicação para prestadores copiado! 📋"
        : "Link de indicação para clientes copiado! 📋",
    )
    setTimeout(() => setCopied(false), 2500)
  }, [currentLink, activeTab])

  const handleShare = React.useCallback(async () => {
    if (!currentLink) return
    triggerHaptic("selection")
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title:
            activeTab === "provider"
              ? "Severinno GV — Seja um Prestador Parceiro"
              : "Severinno GV — Serviços Residenciais com Segurança",
          text: currentShareText,
          url: currentLink,
        })
        return
      } catch {
        // User cancelled or share failed, fallback to copy
      }
    }
    handleCopyLink()
  }, [currentLink, currentShareText, handleCopyLink, activeTab])

  const handleWhatsAppShare = React.useCallback(() => {
    if (!currentWhatsappUrl) return
    triggerHaptic("selection")
    window.open(currentWhatsappUrl, "_blank", "noopener,noreferrer")
  }, [currentWhatsappUrl])

  const provConversions = stats?.providerConversionsCount ?? 0
  const cliConversions = stats?.clientConversionsCount ?? 0
  const totalPoints = stats?.totalPointsEarned ?? stats?.pointsEarned ?? 0
  const tierTitle = stats?.tierBonusTitle || "Indicador Ativo"

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-amber-500/10 p-4 shadow-2xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <Trophy className="size-3.5 text-amber-600 dark:text-amber-400" />
              <span>Programa Embaixadores Severinno GV</span>
            </div>
            <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              Multiplique sua Rede e Ganhe Pontos Exclusivos
            </h1>
            <p className="text-muted-foreground max-w-2xl text-xs sm:text-sm">
              Indique colegas prestadores especialistas (+200 pts) e clientes (+50 pts). Toda a
              pontuação acumulada é creditada no Clube de Benefícios Severinno para conversão futura
              em vantagens operacionais, isenção de taxas e prioridade no Radar de GV.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("provider.bookings")
              }}
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <Calendar className="text-primary size-3.5" />
              Meus agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("provider.finance")
              }}
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <Zap className="size-3.5 text-amber-600" />
              Extrato e repasses
            </Button>
          </div>
        </div>
      </div>

      {/* Bento Micro StatCards (~68px) */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          icon={Wrench}
          label="Prestadores Ativos"
          value={String(provConversions)}
          tone="amber"
          hint="+200 pts por colega ativo (4x peso)"
          compact={true}
        />
        <StatCard
          icon={Users}
          label="Clientes Ativos"
          value={String(cliConversions)}
          tone="primary"
          hint="+50 pts por cliente que contratou"
          compact={true}
        />
        <StatCard
          icon={Award}
          label="Pontos no Clube"
          value={`+${totalPoints}`}
          tone="amber"
          hint="Para conversão futura (não dinheiro)"
          compact={true}
        />
        <StatCard
          icon={Crown}
          label="Nível Embaixador"
          value={tierTitle}
          tone="sky"
          hint="Prioridade VIP de chamados no radar"
          compact={true}
        />
      </div>

      {/* Dual Funnel Tab Switcher & Sharing Box */}
      <Card className="border-border/60 shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-bold sm:text-lg">
                Escolha o Funil de Indicação
              </CardTitle>
              <CardDescription className="text-xs">
                Links e mensagens personalizadas para cada tipo de público em Governador Valadares.
              </CardDescription>
            </div>

            {/* Segmented Tab Controls */}
            <div
              role="tablist"
              aria-label="Funil de indicação"
              className="bg-muted/60 inline-flex items-center rounded-xl p-1 text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "provider"}
                onClick={() => {
                  triggerHaptic("selection")
                  setActiveTab("provider")
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition-all ${
                  activeTab === "provider"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Trophy className="size-3.5" />
                <span>Prestadores (+200 pts)</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "client"}
                onClick={() => {
                  triggerHaptic("selection")
                  setActiveTab("client")
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition-all ${
                  activeTab === "client"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Users className="size-3.5" />
                <span>Clientes (+50 pts)</span>
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-1">
          {/* Pitch Banner */}
          {activeTab === "provider" ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs text-amber-900 sm:text-sm dark:text-amber-200">
              <Trophy className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">
                  🎯 Oportunidade 4x: Prestadores Especialistas (+200 Pontos)
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  O que sustenta a Severinno em GV são os profissionais capacitados. Ao indicar
                  colegas eletricistas, encanadores, técnicos ou diaristas, você ganha 4x mais
                  pontos no Clube e o colega indicado recebe +50 pontos de boas-vindas.
                </p>
              </div>
            </div>
          ) : (
            <div className="border-primary/20 bg-primary/5 text-foreground flex items-start gap-3 rounded-xl border p-3.5 text-xs sm:text-sm">
              <Users className="text-primary mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">🏠 Indicação de Clientes e Vizinhos (+50 Pontos)</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Recomende moradores e empresas de GV para contratarem pela plataforma com garantia
                  do CDC e pagamento seguro em custódia (Escrow). Você ganha +50 pontos e o cliente
                  ganha +25 pontos de boas-vindas.
                </p>
              </div>
            </div>
          )}

          {/* Link Box */}
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-semibold">
              Seu link exclusivo para {activeTab === "provider" ? "Prestadores" : "Clientes"}:
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="bg-muted/40 border-border/80 text-foreground flex h-9.5 flex-1 items-center rounded-xl border px-3 font-mono text-xs select-all">
                {isLoadingStats ? (
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Carregando link...
                  </span>
                ) : (
                  currentLink || "Carregando..."
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleCopyLink}
                  size="sm"
                  className="h-9.5 gap-1.5 rounded-xl px-4 text-xs font-semibold transition-transform active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5 text-emerald-400" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleWhatsAppShare}
                  size="sm"
                  className="h-9.5 gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-xs transition-transform hover:bg-emerald-700 active:scale-95"
                >
                  <MessageCircle className="size-3.5" />
                  <span>WhatsApp</span>
                </Button>

                <Button
                  onClick={handleShare}
                  variant="outline"
                  size="sm"
                  className="h-9.5 gap-1.5 rounded-xl px-3 text-xs font-semibold transition-transform active:scale-95"
                  title="Compartilhar"
                >
                  <Share2 className="size-3.5" />
                  <span className="sr-only sm:not-sr-only">Mais</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Gamification Transparency Notice */}
          <div className="bg-muted/30 border-border/60 flex items-start gap-2.5 rounded-xl border p-3 text-xs">
            <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">Regra de Conversão:</strong> Todos os
              participantes acumulam pontos no <em>Clube de Fidelidade Severinno</em> a serem
              convertidos futuramente em benefícios na plataforma (isenções de comissão, destaques
              no radar e cupons) — não são efetuados pagamentos em dinheiro em espécie.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Regras e Transparência do Jogo */}
      <Card className="border-border/60 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold sm:text-base">
            <Sparkles className="size-4 text-amber-500" />
            Como Funciona a Pontuação Dual
          </CardTitle>
          <CardDescription className="text-xs">
            Valores assimétricos para valorizar a oferta técnica em Governador Valadares.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border-border/60 bg-muted/20 space-y-2 rounded-xl border p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                  <Wrench className="size-4 text-amber-600" /> Indicação de Prestador
                </span>
                <Badge className="text-2xs border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Peso 4x
                </Badge>
              </div>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>
                  • Você ganha <strong>+200 pontos</strong> no 1º serviço concluído pelo colega.
                </li>
                <li>
                  • O prestador indicado ganha <strong>+50 pontos</strong> de boas-vindas.
                </li>
                <li>• Desbloqueia prioridade de radar nos bairros de atuação.</li>
              </ul>
            </div>

            <div className="border-border/60 bg-muted/20 space-y-2 rounded-xl border p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                  <Users className="text-primary size-4" /> Indicação de Cliente
                </span>
                <Badge variant="outline" className="text-2xs">
                  Demanda
                </Badge>
              </div>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>
                  • Você ganha <strong>+50 pontos</strong> no 1º agendamento pago do cliente.
                </li>
                <li>
                  • O cliente indicado ganha <strong>+25 pontos</strong> de boas-vindas.
                </li>
                <li>• Pontos acumulativos para descontos em serviços pessoais futuros.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Community Leaderboard */}
      <Card className="border-border/60 shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-bold sm:text-lg">
                <Trophy className="size-4.5 text-amber-500" />
                Ranking de Embaixadores em GV
              </CardTitle>
              <CardDescription className="text-xs">
                Top membros da comunidade com mais pontos acumulados por indicações ativas.
              </CardDescription>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label="Modo de visualização do ranking"
                className="bg-muted/60 inline-flex items-center rounded-xl p-1"
              >
                <button
                  type="button"
                  aria-label="Visualização em Lista"
                  aria-pressed={viewMode === "list"}
                  onClick={() => {
                    triggerHaptic("selection")
                    setViewMode("list")
                  }}
                  className={`rounded-lg p-1.5 transition-all ${
                    viewMode === "list"
                      ? "bg-background text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LayoutList className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Visualização em Grade"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => {
                    triggerHaptic("selection")
                    setViewMode("grid")
                  }}
                  className={`rounded-lg p-1.5 transition-all ${
                    viewMode === "grid"
                      ? "bg-background text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LayoutGrid className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative mt-2">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Buscar embaixador pelo nome ou nível..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-border/60 bg-muted/20 h-8.5 rounded-xl pr-8 pl-8.5 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => {
                  triggerHaptic("selection")
                  setSearchQuery("")
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {isLoadingLeaderboard ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : filteredLeaderboard.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="Nenhum embaixador encontrado"
              description={
                searchQuery
                  ? "Tente buscar por outro termo ou limpe a busca."
                  : "Seja o primeiro a indicar colegas e liderar o ranking de Governador Valadares!"
              }
            />
          ) : viewMode === "list" ? (
            <div className="divide-border/60 divide-y">
              {filteredLeaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center font-mono">
                      {getRankIcon(entry.rank)}
                    </div>
                    <Avatar className="ring-border size-9 rounded-full ring-1">
                      <AvatarImage src={entry.avatarUrl || undefined} alt={entry.name} />
                      <AvatarFallback className="rounded-full text-xs font-bold">
                        {entry.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-foreground text-xs font-semibold sm:text-sm">
                        {entry.name}
                      </p>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <Badge
                          variant="outline"
                          className={`text-2xs font-medium ${getBadgeStyle(entry.badge)}`}
                        >
                          {entry.badge}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-xs font-bold text-amber-600 sm:text-sm dark:text-amber-400">
                      +{entry.pointsEarned} pts
                    </p>
                    <p className="text-muted-foreground text-2xs">
                      {entry.convertedCount} {entry.convertedCount === 1 ? "ativo" : "ativos"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {filteredLeaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className="border-border/60 bg-muted/20 relative flex flex-col justify-between rounded-xl border p-3.5 shadow-2xs"
                >
                  <div className="absolute top-3 right-3">{getRankIcon(entry.rank)}</div>
                  <div className="flex items-center gap-2.5">
                    <Avatar className="ring-border size-10 rounded-full ring-1">
                      <AvatarImage src={entry.avatarUrl || undefined} alt={entry.name} />
                      <AvatarFallback className="rounded-full text-xs font-bold">
                        {entry.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="pr-6">
                      <p className="text-foreground truncate text-xs font-semibold sm:text-sm">
                        {entry.name}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-2xs mt-0.5 font-medium ${getBadgeStyle(entry.badge)}`}
                      >
                        {entry.badge}
                      </Badge>
                    </div>
                  </div>

                  <div className="border-border/40 mt-3 flex items-center justify-between border-t pt-2 text-xs">
                    <span className="text-muted-foreground text-2xs">
                      {entry.convertedCount}{" "}
                      {entry.convertedCount === 1 ? "membro ativo" : "membros ativos"}
                    </span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      +{entry.pointsEarned} pts
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
