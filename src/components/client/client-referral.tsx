"use client"

/**
 * ClientReferral — referral and "Indique e Ganhe" panel for clients.
 *
 * Polish & Service Design:
 *  - Modern Hero Banner with subtle emerald/card gradient & Community Growth Badge.
 *  - Quick access actions: "Buscar prestadores" & "Meus agendamentos".
 *  - 3 High-impact StatCards (Convites Enviados, Amigos Ativos, Pontos Conquistados).
 *  - Interactive Invite & Share Box:
 *    - 1-click copy with toast & visual check feedback.
 *    - Native Web Share API integration (navigator.share) with automatic fallback.
 *    - Quick WhatsApp share for inviting personal friends/family with pre-filled message.
 *  - Visual "Como Funciona" 3-step guide:
 *    - 1. Compartilhe seu link exclusivo
 *    - 2. Amigo contrata com garantia e segurança
 *    - 3. Recompensas automáticas para ambos
 *  - Reward Tiers (Bronze, Prata, Ouro, Diamante) with current status highlight.
 *  - Community Leaderboard of Ambassadors with 100% circular avatars (rounded-full).
 *  - Accessible and fully compliant with WCAG 2.1 AA.
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
  Loader2,
  MapPin,
  Medal,
  MessageCircle,
  Share2,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet } from "@/lib/api"
import type { ReferralLeaderboardEntry, ReferralStats } from "@/lib/referral"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { EmptyState, StatCard } from "@/components/shared/dashboard-shell"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRankIcon(rank: number) {
  switch (rank) {
    case 1:
      return <Crown className="size-5 fill-amber-400 text-amber-500" />
    case 2:
      return <Medal className="size-5 fill-slate-300 text-slate-400" />
    case 3:
      return <Medal className="size-5 fill-amber-600 text-amber-700" />
    default:
      return <span className="text-muted-foreground text-sm font-bold">#{rank}</span>
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
  const leaderboard = leaderboardData?.leaderboard ?? []

  const inviteLink = stats?.inviteLink
  const shareText = stats?.shareText
  const whatsappShareUrl = stats?.whatsappShareUrl

  const handleCopyLink = React.useCallback(() => {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    toast.success("Link de indicação copiado! 📋")
    setTimeout(() => setCopied(false), 2500)
  }, [inviteLink])

  const handleShare = React.useCallback(async () => {
    if (!inviteLink) return
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
    window.open(whatsappShareUrl, "_blank", "noopener,noreferrer")
  }, [whatsappShareUrl])

  const totalInvites = stats?.totalInvites ?? 0
  const activeFriends = stats?.activeFriends ?? 0
  const pointsEarned = stats?.pointsEarned ?? 0

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-emerald-500/5 p-6 shadow-sm">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Gift className="size-3.5 text-emerald-500" />
              <span>Programa Indique e Ganhe</span>
            </div>
            <h1 className="text-foreground mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Indique Amigos e Ganhe Recompensas
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Convide amigos e familiares para o Severinno em Governador Valadares. A cada novo
              serviço concluído com segurança pela plataforma, ambos ganham vantagens e pontos no
              Clube de Fidelidade.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.bookings")}
              className="gap-1.5 text-xs font-medium"
            >
              <Calendar className="size-3.5" />
              Meus agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.providers")}
              className="gap-1.5 text-xs font-medium"
            >
              <MapPin className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Impact StatCards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label="Convites Enviados"
          value={String(totalInvites)}
          tone="primary"
          hint="Pessoas que receberam seu convite"
        />
        <StatCard
          icon={CheckCircle2}
          label="Amigos Ativos"
          value={String(activeFriends)}
          tone="primary"
          hint="Concluíram o 1º serviço seguro"
        />
        <StatCard
          icon={Award}
          label="Pontos Conquistados"
          value={`+${pointsEarned}`}
          tone="amber"
          hint="No Clube de Fidelidade"
        />
      </div>

      {/* Main Referral Sharing Card */}
      {isLoadingStats ? (
        <Card>
          <CardContent className="flex h-48 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </CardContent>
        </Card>
      ) : (
        <Card className="from-card via-card/95 overflow-hidden border border-emerald-500/20 bg-gradient-to-br to-emerald-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600 dark:text-emerald-400">
                  <Gift className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">
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

          <CardContent className="space-y-4 pt-1">
            {/* Link Box */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="border-border/70 bg-muted/40 flex flex-1 items-center justify-between rounded-xl border px-3.5 py-2.5 font-mono text-xs shadow-inner">
                <span className="text-muted-foreground truncate" title={stats?.inviteLink}>
                  {stats?.inviteLink || "Carregando link..."}
                </span>
                <span className="bg-background text-foreground ml-2 shrink-0 rounded px-2 py-0.5 font-bold shadow-xs">
                  {stats?.code}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyLink}
                  className="h-9 gap-1.5 text-xs font-medium"
                  aria-label="Copiar link de convite"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  <span>{copied ? "Copiado!" : "Copiar Link"}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  className="h-9 gap-1.5 text-xs font-medium"
                  aria-label="Compartilhar convite"
                >
                  <Share2 className="size-3.5" />
                  <span>Compartilhar</span>
                </Button>

                <Button
                  size="sm"
                  onClick={handleWhatsAppShare}
                  className="h-9 gap-1.5 bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
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

      {/* How it Works Section */}
      <div className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          Como Funciona o Programa
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-border/60 rounded-xl border p-4 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                1
              </span>
              <h3 className="text-foreground text-sm font-semibold">Compartilhe o Convite</h3>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Envie seu link exclusivo para amigos, familiares ou vizinhos que precisam de serviços
              de qualidade.
            </p>
          </Card>

          <Card className="border-border/60 rounded-xl border p-4 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                2
              </span>
              <h3 className="text-foreground text-sm font-semibold">Seu Amigo Contrata</h3>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Ele se cadastra e contrata qualquer prestador com garantia legal de 90 dias e
              pagamento protegido por custódia.
            </p>
          </Card>

          <Card className="border-border/60 rounded-xl border p-4 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                3
              </span>
              <h3 className="text-foreground text-sm font-semibold">Vocês Dois Ganham</h3>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Assim que o serviço for finalizado com sucesso, os pontos são creditados na sua conta
              e seu amigo ganha desconto.
            </p>
          </Card>
        </div>
      </div>

      {/* Reward Tiers Section */}
      <Card className="border-border/60 rounded-xl border shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                <Award className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Níveis de Recompensa</CardTitle>
                <CardDescription className="text-xs">
                  Quanto mais amigos ativos você tiver, maiores são suas vantagens
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-xs font-normal">
              Clube Fidelidade
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2.5 sm:grid-cols-4">
          <div
            className={`rounded-lg border p-3 ${
              activeFriends >= 0 && activeFriends < 3
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Iniciante</span>
              <span className="text-muted-foreground text-[10px]">1-2 amigos</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              +50 pts / serviço
            </p>
            <p className="text-muted-foreground text-[11px]">Pontos no Clube</p>
          </div>

          <div
            className={`rounded-lg border p-3 ${
              activeFriends >= 3 && activeFriends < 6
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Prata</span>
              <span className="text-muted-foreground text-[10px]">3-5 amigos</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              +75 pts / serviço
            </p>
            <p className="text-muted-foreground text-[11px]">+ Selo de Indicador</p>
          </div>

          <div
            className={`rounded-lg border p-3 ${
              activeFriends >= 6 && activeFriends < 11
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Ouro</span>
              <span className="text-muted-foreground text-[10px]">6-10 amigos</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              +100 pts / serviço
            </p>
            <p className="text-muted-foreground text-[11px]">Prioridade de Suporte</p>
          </div>

          <div
            className={`rounded-lg border p-3 ${
              activeFriends >= 11
                ? "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-bold">Diamante</span>
              <span className="text-muted-foreground text-[10px]">11+ amigos</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              +150 pts / serviço
            </p>
            <p className="text-muted-foreground text-[11px]">Voucher VIP Anual</p>
          </div>
        </CardContent>
      </Card>

      {/* Ambassadors Leaderboard */}
      <Card className="border-border/60 rounded-xl border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                <Trophy className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">
                  Ranking de Embaixadores & Indicadores
                </CardTitle>
                <CardDescription className="text-xs">
                  Membros da comunidade que mais expandem nossa rede de confiança
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="outline"
              className="gap-1 border-amber-200 text-amber-800 dark:border-amber-800 dark:text-amber-300"
            >
              <Sparkles className="size-3 text-amber-500" /> Top Comunidade
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoadingLeaderboard ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-muted/60 h-12 w-full animate-pulse rounded-lg" />
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
          ) : (
            <div className="divide-border/50 divide-y">
              {leaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className="hover:bg-muted/40 flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 items-center justify-center">
                      {getRankIcon(entry.rank)}
                    </div>
                    <Avatar className="ring-border/50 size-9 rounded-full border ring-1">
                      {entry.avatarUrl ? (
                        <AvatarImage
                          src={entry.avatarUrl}
                          alt={entry.name}
                          className="rounded-full object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                        {entry.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-foreground text-sm leading-none font-medium">
                        {entry.name}
                      </p>
                      <span
                        className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getBadgeStyle(
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

                  <div className="text-right">
                    <p className="text-foreground text-sm font-semibold">
                      {entry.convertedCount} {entry.convertedCount === 1 ? "amigo" : "amigos"}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      +{entry.pointsEarned} pts
                    </p>
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
