"use client"

/**
 * ClientReferral — referral and "Indique e Ganhe" panel for clients.
 *
 * Polish & Service Design:
 *  - Modern Compact Hero Banner with subtle emerald/card gradient & Community Growth Badge.
 *  - Quick access actions: "Buscar prestadores" & "Meus agendamentos".
 *  - 3 High-impact Bento micro StatCards (compact={true}, ~68px) (Convites Enviados, Amigos Ativos, Pontos Conquistados).
 *  - Interactive Invite & Share Box:
 *    - 1-click copy with toast, visual check feedback & haptics.
 *    - Native Web Share API integration (navigator.share) with automatic fallback.
 *    - Quick WhatsApp share for inviting personal friends/family with pre-filled message.
 *  - List and Grid view toggles for the Ambassadors Leaderboard with haptics and aria-pressed attributes.
 *  - Prominent search input with instant clear 'X' button (aria-label="Limpar busca").
 *  - Visual "Como Funciona" 3-step compact guide:
 *    - 1. Compartilhe seu link exclusivo
 *    - 2. Amigo contrata com garantia e segurança
 *    - 3. Recompensas automáticas para ambos
 *  - Reward Tiers (Iniciante, Prata, Ouro, Diamante) with current status highlight.
 *  - Community Leaderboard of Ambassadors with 100% circular avatars (rounded-full) in both List and Grid views.
 *  - Accessible and fully compliant with WCAG 2.1 AA (0 axe violations).
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Award,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Gift,
  LayoutGrid,
  LayoutList,
  Loader2,
  MapPin,
  Medal,
  MessageCircle,
  Search,
  Share2,
  Sparkles,
  Trophy,
  Users,
  X,
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
import { EmptyState, StatCard } from "@/components/shared/dashboard-shell"

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

export function ClientReferral() {
  const navigate = useViewStore((s) => s.navigate)
  const [copied, setCopied] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Fetch stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery<{
    ok: boolean
    stats: ReferralStats
  }>({
    queryKey: ["referral", "stats"],
    queryFn: () => apiGet<{ ok: boolean; stats: ReferralStats }>("/api/referral"),
  })

  // Fetch leaderboard
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

  const inviteLink = stats?.inviteLink
  const shareText = stats?.shareText
  const whatsappShareUrl = stats?.whatsappShareUrl

  const handleCopyLink = React.useCallback(() => {
    if (!inviteLink) return
    triggerHaptic("success")
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    toast.success("Link de indicação copiado! 📋")
    setTimeout(() => setCopied(false), 2500)
  }, [inviteLink])

  const handleShare = React.useCallback(async () => {
    if (!inviteLink) return
    triggerHaptic("selection")
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Severinno — Conheça e Contrate com Segurança",
          text:
            shareText ||
            "Estou usando o Severinno para serviços em Governador Valadares. Use meu convite para ganhar vantagens no 1º serviço:",
          url: inviteLink,
        })
        return
      } catch {
        // User cancelled share or browser failed, fallback to copy
      }
    }
    handleCopyLink()
  }, [inviteLink, shareText, handleCopyLink])

  const handleWhatsAppShare = React.useCallback(() => {
    if (!whatsappShareUrl) return
    triggerHaptic("selection")
    window.open(whatsappShareUrl, "_blank", "noopener,noreferrer")
  }, [whatsappShareUrl])

  const totalInvites = stats?.totalInvites ?? 0
  const activeFriends = stats?.activeFriends ?? 0
  const pointsEarned = stats?.pointsEarned ?? 0

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-emerald-500/5 p-4 shadow-2xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <Gift className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Programa Indique e Ganhe</span>
            </div>
            <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              Indique Amigos e Ganhe Recompensas
            </h1>
            <p className="text-muted-foreground max-w-2xl text-xs sm:text-sm">
              Convide amigos e familiares para o Severinno em Governador Valadares. A cada novo
              serviço concluído com segurança pela plataforma, ambos ganham vantagens e pontos no
              Clube de Fidelidade.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.bookings")
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
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <MapPin className="text-primary size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Impact StatCards — Bento micro-cards (~68px) */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label="Convites Enviados"
          value={String(totalInvites)}
          tone="primary"
          hint="Pessoas que receberam seu convite"
          compact={true}
        />
        <StatCard
          icon={CheckCircle2}
          label="Amigos Ativos"
          value={String(activeFriends)}
          tone="primary"
          hint="Concluíram o 1º serviço seguro"
          compact={true}
        />
        <StatCard
          icon={Award}
          label="Pontos Conquistados"
          value={`+${pointsEarned}`}
          tone="amber"
          hint="No Clube de Fidelidade"
          compact={true}
        />
      </div>

      {/* Main Referral Sharing Card */}
      {isLoadingStats ? (
        <Card className="border-border/60 rounded-xl p-6 shadow-2xs">
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-primary size-6 animate-spin" />
          </div>
        </Card>
      ) : (
        <Card className="from-card via-card/95 overflow-hidden rounded-xl border border-emerald-500/25 bg-gradient-to-br to-emerald-500/5 shadow-2xs">
          <CardHeader className="p-3.5 pb-2 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
                  <Gift className="size-4.5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold sm:text-base">
                    Seu Link de Convite Exclusivo
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Ganhe +50 pontos no Clube de Fidelidade quando seu amigo contratar o 1º serviço.
                  </CardDescription>
                </div>
              </div>
              {stats?.tierBonusTitle && (
                <Badge
                  variant="outline"
                  className="self-start border-emerald-500/30 bg-emerald-500/10 text-emerald-700 sm:self-auto dark:text-emerald-300"
                >
                  <Sparkles className="mr-1 size-3" />
                  {stats.tierBonusTitle}
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-3 p-3.5 pt-0 sm:p-4 sm:pt-0">
            {/* Link Box */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="border-border/70 bg-muted/40 flex flex-1 items-center justify-between rounded-lg border px-3 py-2 font-mono text-xs shadow-inner">
                <span className="text-muted-foreground truncate" title={stats?.inviteLink}>
                  {stats?.inviteLink || "Carregando link..."}
                </span>
                <span className="bg-background text-foreground border-border/60 ml-2 shrink-0 rounded border px-2 py-0.5 text-xs font-bold shadow-2xs">
                  {stats?.code}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLink}
                  className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-2xs"
                  aria-label="Copiar link de convite"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  <span>{copied ? "Copiado!" : "Copiar Link"}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-2xs"
                  aria-label="Compartilhar convite"
                >
                  <Share2 className="size-3.5" />
                  <span>Compartilhar</span>
                </Button>

                <Button
                  size="sm"
                  onClick={handleWhatsAppShare}
                  className="h-8 gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                  aria-label="Enviar convite pelo WhatsApp para amigos"
                >
                  <MessageCircle className="size-3.5" />
                  <span>Convidar no WhatsApp</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* How it Works Section — Compact 3-step Bento */}
      <div className="space-y-2">
        <h2 className="text-muted-foreground px-0.5 text-xs font-bold tracking-wider uppercase">
          Como Funciona o Programa
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Card className="border-border/60 bg-card rounded-xl border p-3 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                1
              </span>
              <h3 className="text-foreground text-xs font-bold sm:text-sm">
                Compartilhe o Convite
              </h3>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              Envie seu link exclusivo para amigos, familiares ou vizinhos que precisam de serviços
              de qualidade.
            </p>
          </Card>

          <Card className="border-border/60 bg-card rounded-xl border p-3 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                2
              </span>
              <h3 className="text-foreground text-xs font-bold sm:text-sm">Seu Amigo Contrata</h3>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              Ele se cadastra e contrata qualquer prestador com garantia legal de 90 dias e
              pagamento protegido por custódia.
            </p>
          </Card>

          <Card className="border-border/60 bg-card rounded-xl border p-3 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                3
              </span>
              <h3 className="text-foreground text-xs font-bold sm:text-sm">Vocês Dois Ganham</h3>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              Assim que o serviço for finalizado com sucesso, os pontos são creditados na sua conta
              e seu amigo ganha desconto.
            </p>
          </Card>
        </div>
      </div>

      {/* Reward Tiers Section */}
      <Card className="border-border/60 bg-card rounded-xl border shadow-2xs">
        <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-500/10 p-1.5 text-amber-700 dark:text-amber-400">
                <Award className="size-4" />
              </div>
              <div>
                <CardTitle className="text-xs font-bold sm:text-sm">Níveis de Recompensa</CardTitle>
                <CardDescription className="text-[11px] sm:text-xs">
                  Quanto mais amigos ativos você tiver, maiores são suas vantagens
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="border-border/60 text-[11px] font-medium">
              Clube Fidelidade
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 p-3.5 pt-0 sm:grid-cols-4 sm:p-4 sm:pt-0">
          <div
            className={`rounded-lg border p-2.5 transition-all ${
              activeFriends >= 0 && activeFriends < 3
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Iniciante</span>
              <span className="text-muted-foreground text-[10px]">1-2 amigos</span>
            </div>
            <p className="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              +50 pts / serviço
            </p>
            <p className="text-muted-foreground text-[10.5px]">Pontos no Clube</p>
          </div>

          <div
            className={`rounded-lg border p-2.5 transition-all ${
              activeFriends >= 3 && activeFriends < 6
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Prata</span>
              <span className="text-muted-foreground text-[10px]">3-5 amigos</span>
            </div>
            <p className="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              +75 pts / serviço
            </p>
            <p className="text-muted-foreground text-[10.5px]">+ Selo de Indicador</p>
          </div>

          <div
            className={`rounded-lg border p-2.5 transition-all ${
              activeFriends >= 6 && activeFriends < 11
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Ouro</span>
              <span className="text-muted-foreground text-[10px]">6-10 amigos</span>
            </div>
            <p className="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              +100 pts / serviço
            </p>
            <p className="text-muted-foreground text-[10.5px]">Prioridade de Suporte</p>
          </div>

          <div
            className={`rounded-lg border p-2.5 transition-all ${
              activeFriends >= 11
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Diamante</span>
              <span className="text-muted-foreground text-[10px]">11+ amigos</span>
            </div>
            <p className="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              +150 pts / serviço
            </p>
            <p className="text-muted-foreground text-[10.5px]">Voucher VIP Anual</p>
          </div>
        </CardContent>
      </Card>

      {/* Ambassadors Leaderboard with View Mode (List vs Grid) & Search */}
      <Card className="border-border/60 bg-card rounded-xl border shadow-2xs">
        <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-2">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-500/10 p-1.5 text-amber-700 dark:text-amber-400">
                <Trophy className="size-4.5" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold sm:text-base">
                  Ranking de Embaixadores & Indicadores
                </CardTitle>
                <CardDescription className="text-xs">
                  Membros da comunidade que mais expandem nossa rede de confiança
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/30 bg-amber-500/10 text-xs font-semibold text-amber-800 dark:text-amber-300"
              >
                <Sparkles className="size-3 text-amber-500" /> Top Comunidade
              </Badge>
            </div>
          </div>

          {/* Toolbar: Search + View Mode Switcher */}
          <div className="border-border/50 mt-2 flex flex-wrap items-center justify-between gap-2.5 border-t pt-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="Buscar no ranking por nome ou selo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8.5 rounded-lg pr-8 pl-8.5 text-xs"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    setSearchQuery("")
                  }}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
                  title="Limpar busca"
                  aria-label="Limpar busca"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>

            {/* List vs Grid switch */}
            <div className="bg-muted/40 flex items-center rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setViewMode("list")
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  viewMode === "list"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Visualização em Lista"
                aria-pressed={viewMode === "list"}
              >
                <LayoutList className="size-3.5" />
                <span className="hidden sm:inline">Lista</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setViewMode("grid")
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  viewMode === "grid"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Visualização em Grade"
                aria-pressed={viewMode === "grid"}
              >
                <LayoutGrid className="size-3.5" />
                <span className="hidden sm:inline">Grade</span>
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3.5 pt-1 sm:p-4 sm:pt-1">
          {isLoadingLeaderboard ? (
            <div className="space-y-2 py-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-muted/60 h-10 w-full animate-pulse rounded-lg" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nenhum embaixador ranqueado ainda"
              description="Compartilhe seu link com amigos para acumular pontos e liderar o ranking!"
              action={
                <Button onClick={handleCopyLink} variant="outline" size="sm" className="mt-2 gap-2">
                  <Copy className="size-3.5" />
                  Copiar meu convite
                </Button>
              }
            />
          ) : filteredLeaderboard.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Nenhum embaixador encontrado"
              description="Nenhum membro do ranking corresponde aos termos digitados na busca."
              action={
                <Button
                  onClick={() => setSearchQuery("")}
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-2"
                >
                  Limpar filtro
                </Button>
              }
            />
          ) : viewMode === "list" ? (
            /* List View — Compact rows (~50px) */
            <div className="divide-border/40 divide-y">
              {filteredLeaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className="hover:bg-muted/40 flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      {getRankIcon(entry.rank)}
                    </div>
                    {/* 100% Round Avatar */}
                    <Avatar className="ring-border/50 size-8 shrink-0 rounded-full border ring-1">
                      {entry.avatarUrl ? (
                        <AvatarImage
                          src={entry.avatarUrl}
                          alt={entry.name}
                          className="rounded-full object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                        {entry.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-xs font-bold sm:text-sm">
                        {entry.name}
                      </p>
                      <span
                        className={`py-0.2 mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 text-[9.5px] font-semibold ${getBadgeStyle(
                          entry.badge,
                        )}`}
                      >
                        {entry.badge === "Embaixador Diamante" ? (
                          <Crown className="size-2.5" />
                        ) : (
                          <Award className="size-2.5" />
                        )}
                        {entry.badge}
                      </span>
                    </div>
                  </div>

                  <div className="ml-2 shrink-0 text-right">
                    <p className="text-foreground text-xs font-bold sm:text-sm">
                      {entry.convertedCount} {entry.convertedCount === 1 ? "amigo" : "amigos"}
                    </p>
                    <p className="text-muted-foreground font-mono text-[11px]">
                      +{entry.pointsEarned} pts
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Grid View — Bento micro-cards (~110px) */
            <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {filteredLeaderboard.map((entry) => (
                <Card
                  key={entry.userId}
                  className="border-border/60 bg-card hover:border-primary/40 rounded-xl border p-3 shadow-2xs transition-all duration-200 hover:shadow-xs"
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      {getRankIcon(entry.rank)}
                    </div>
                    <span
                      className={`py-0.2 inline-flex items-center gap-1 truncate rounded-full border px-1.5 text-[9px] font-semibold ${getBadgeStyle(
                        entry.badge,
                      )}`}
                    >
                      {entry.badge === "Embaixador Diamante" ? (
                        <Crown className="size-2.5" />
                      ) : (
                        <Award className="size-2.5" />
                      )}
                      <span className="truncate">{entry.badge}</span>
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-2.5">
                    {/* 100% Round Avatar */}
                    <Avatar className="ring-border/50 size-9 shrink-0 rounded-full border ring-1">
                      {entry.avatarUrl ? (
                        <AvatarImage
                          src={entry.avatarUrl}
                          alt={entry.name}
                          className="rounded-full object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                        {entry.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-xs font-bold">{entry.name}</p>
                      <p className="text-muted-foreground text-[11px] font-medium">
                        {entry.convertedCount} {entry.convertedCount === 1 ? "amigo" : "amigos"}
                      </p>
                    </div>
                  </div>

                  <div className="border-border/40 bg-muted/20 mt-2.5 flex items-center justify-between rounded-lg border px-2 py-1">
                    <span className="text-muted-foreground text-[10.5px]">Pontuação:</span>
                    <span className="text-foreground font-mono text-xs font-bold">
                      +{entry.pointsEarned} pts
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
