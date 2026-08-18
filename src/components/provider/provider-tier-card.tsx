"use client"

/**
 * ProviderTierCard — Visual Gamification & Pro Tier status for providers.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Award,
  CheckCircle2,
  Crown,
  Lock,
  Medal,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import type { GamificationProfile } from "@/lib/gamification"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

const TIER_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  BRONZE: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
    badge: "bg-amber-700 text-white",
  },
  SILVER: {
    bg: "bg-slate-100 dark:bg-slate-900/50",
    text: "text-slate-800 dark:text-slate-200",
    border: "border-slate-300 dark:border-slate-700",
    badge: "bg-slate-500 text-white",
  },
  GOLD: {
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    text: "text-yellow-800 dark:text-yellow-300",
    border: "border-yellow-400 dark:border-yellow-700",
    badge: "bg-yellow-500 text-zinc-950 font-bold",
  },
  DIAMOND: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-800 dark:text-emerald-200",
    border: "border-emerald-400 dark:border-emerald-700",
    badge: "bg-gradient-to-r from-emerald-600 to-teal-500 text-white",
  },
}

export function ProviderTierCard() {
  const { data, isLoading } = useQuery<{ ok: boolean; profile: GamificationProfile }>({
    queryKey: ["provider-gamification"],
    queryFn: () => apiGet<{ ok: boolean; profile: GamificationProfile }>("/api/provider/gamification"),
  })

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }

  const profile = data?.profile
  if (!profile) return null

  const colors = TIER_COLORS[profile.tier] ?? TIER_COLORS.BRONZE

  return (
    <Card className={`rounded-xl border ${colors.border} ${colors.bg} shadow-sm transition-all`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-amber-500" />
            <CardTitle className="text-base font-bold">Programa Severinno Pro</CardTitle>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold shadow-sm ${colors.badge} flex items-center gap-1`}>
            <Medal className="size-3.5" />
            Nível {profile.tierLabel}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* XP Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">
              Pontuação Pro: <strong>{profile.score} pts</strong>
            </span>
            {profile.nextTierScore ? (
              <span className="text-muted-foreground">
                Faltam {profile.nextTierScore - profile.score} pts para o nível {profile.nextTier}
              </span>
            ) : (
              <span className="font-bold text-emerald-600">Nível Máximo Atingido! 🏆</span>
            )}
          </div>
          <Progress value={profile.progressToNextTierPercent} className="h-2 bg-muted/60" />
        </div>

        {/* Benefits Unlocked */}
        <div className="rounded-lg bg-background/80 p-3 border space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Sparkles className="size-3.5 text-emerald-600" />
            Benefícios Ativos do seu Nível:
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs text-muted-foreground">
            {profile.benefits.map((b, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Badges Grid */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-foreground">Conquistas & Selos:</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {profile.badges.map((b) => (
              <div
                key={b.id}
                className={`rounded-lg border p-2.5 text-center transition-all ${
                  b.unlocked
                    ? "bg-background border-emerald-300 dark:border-emerald-800 shadow-sm"
                    : "bg-muted/40 border-muted opacity-50 grayscale"
                }`}
              >
                <div className="flex justify-center mb-1">
                  {b.id === "verified_pro" && <ShieldCheck className="size-5 text-emerald-600" />}
                  {b.id === "top_rated" && <Star className="size-5 text-amber-500 fill-amber-500" />}
                  {b.id === "veteran" && <Award className="size-5 text-blue-600" />}
                  {b.id === "master" && <Crown className="size-5 text-purple-600" />}
                </div>
                <div className="text-[11px] font-bold leading-tight text-foreground">{b.name}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                  {b.unlocked ? "Desbloqueado" : <span className="flex items-center justify-center gap-0.5"><Lock className="size-2.5" /> Bloqueado</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
