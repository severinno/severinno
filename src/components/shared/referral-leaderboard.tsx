"use client"

import { useEffect, useState } from "react"
import { Trophy, Crown, Medal, Award, Sparkles, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { ReferralLeaderboardEntry } from "@/lib/referral"

export function ReferralLeaderboard() {
  const [entries, setEntries] = useState<ReferralLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadLeaderboard() {
      try {
        const res = await fetch("/api/referral/leaderboard")
        if (res.ok) {
          const data = await res.json()
          setEntries(data.leaderboard || [])
        }
      } catch {
        // Fallback or offline state
      } finally {
        setLoading(false)
      }
    }
    loadLeaderboard()
  }, [])

  const getRankIcon = (rank: number) => {
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

  const getBadgeStyle = (badge: ReferralLeaderboardEntry["badge"]) => {
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

  return (
    <Card className="border shadow-sm">
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
              <p className="text-muted-foreground text-xs">
                Membros que mais expandem nossa rede de confiança
              </p>
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
        {loading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-muted/60 h-12 w-full animate-pulse rounded-lg" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-6 text-center">
            <Users className="text-muted-foreground/60 mx-auto size-8" />
            <p className="mt-2 text-sm font-medium">Nenhum embaixador ranqueado ainda</p>
            <p className="text-muted-foreground text-xs">
              Convide amigos e seja o primeiro a liderar o ranking!
            </p>
          </div>
        ) : (
          <div className="divide-border/50 divide-y">
            {entries.map((entry) => (
              <div
                key={entry.userId}
                className="hover:bg-muted/40 flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-7 items-center justify-center">
                    {getRankIcon(entry.rank)}
                  </div>
                  <Avatar className="size-9 border">
                    {entry.avatarUrl ? (
                      <AvatarImage src={entry.avatarUrl} alt={entry.name} />
                    ) : null}
                    <AvatarFallback className="text-xs font-semibold">
                      {entry.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm leading-none font-medium">{entry.name}</p>
                    <span
                      className={`py-0.2 mt-1 inline-flex items-center gap-1 rounded-full border px-2 text-[10px] font-semibold ${getBadgeStyle(
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
  )
}
