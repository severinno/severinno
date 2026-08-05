"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { MessageSquareReply, Star } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import { useAuthStore } from "@/store/auth"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Review = {
  id: string
  rating: number
  comment?: string | null
  createdAt: string
  booking?: { id: string; serviceId: string | null } | null
  service?: { id: string; title: string } | null
  client: { id: string; name: string; avatarUrl?: string | null }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderReviews() {
  const user = useAuthStore((s) => s.user)

  const query = useQuery<{ items: Review[]; total: number }>({
    queryKey: ["provider", "reviews", user?.id],
    queryFn: async () => {
      if (!user) return { items: [], total: 0 }
      return apiGet("/api/reviews", { providerId: user.id })
    },
    enabled: !!user,
  })

  const reviews = query.data?.items ?? []

  const avg =
    reviews.length > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0

  const distribution = React.useMemo(() => {
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    for (const r of reviews) {
      dist[r.rating] = (dist[r.rating] ?? 0) + 1
    }
    return dist
  }, [reviews])

  return (
    <div className="grid gap-6">
      {/* Summary */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-muted-foreground text-xs tracking-wider uppercase">
              Avaliação média
            </p>
            <p className="text-primary text-5xl font-bold tabular-nums">{avg.toFixed(1)}</p>
            <StarRatingDisplay value={avg} size={20} showCount={false} />
            <p className="text-muted-foreground text-xs tabular-nums">
              {reviews.length} {reviews.length === 1 ? "avaliação" : "avaliações"}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-sm">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">Distribuição</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ul className="grid gap-2">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = distribution[star] ?? 0
                const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0
                return (
                  <li key={star} className="flex items-center gap-3 text-sm">
                    <span className="flex w-12 items-center gap-1">
                      {star} <Star className="size-3 fill-amber-400 text-amber-400" />
                    </span>
                    <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          star >= 4
                            ? "bg-emerald-500"
                            : star === 3
                              ? "bg-amber-500"
                              : "bg-rose-500",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground w-8 text-right text-xs tabular-nums">
                      {count}
                    </span>
                    <span className="text-muted-foreground hidden w-10 text-right text-[10px] tabular-nums sm:inline">
                      {pct.toFixed(0)}%
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      {query.isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/30 h-32 animate-pulse rounded-xl border" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
            <Star className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">Ainda não há avaliações</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Realize serviços para receber avaliações dos seus clientes.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {reviews.map((r) => (
            <Card key={r.id} className="rounded-xl shadow-sm">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar className="size-10 border">
                    {r.client.avatarUrl ? (
                      <AvatarImage src={r.client.avatarUrl} alt={r.client.name} />
                    ) : null}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials(r.client.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{r.client.name}</p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {formatDateTime(r.createdAt)}
                    </p>
                  </div>
                  <StarRatingDisplay value={r.rating} size={16} showCount={false} />
                </div>
                {r.comment && (
                  <p className="text-foreground text-sm leading-relaxed">“{r.comment}”</p>
                )}
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {r.service?.title && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquareReply className="size-3" />
                      Serviço:{" "}
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {r.service.title}
                      </Badge>
                    </span>
                  )}
                  {r.booking && (
                    <span className="tabular-nums">
                      Agendamento:{" "}
                      <span className="text-foreground font-medium">#{r.booking.id.slice(-6)}</span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProviderReviews
