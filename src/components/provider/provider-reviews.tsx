"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Award,
  CheckCircle2,
  Clock,
  Heart,
  MessageSquare,
  MessageSquareReply,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import { useAuthStore } from "@/store/auth"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Textarea } from "@/components/ui/textarea"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

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
  const [selectedStar, setSelectedStar] = React.useState<number | "all">("all")
  const [replyReview, setReplyReview] = React.useState<Review | null>(null)
  const [replyText, setReplyText] = React.useState("")
  const [sentReplies, setSentReplies] = React.useState<Record<string, string>>({})

  const query = useQuery<{ items: Review[]; total: number }>({
    queryKey: ["provider", "reviews", user?.id],
    queryFn: async () => {
      if (!user) return { items: [], total: 0 }
      return apiGet("/api/reviews", { providerId: user.id })
    },
    enabled: !!user,
  })

  const reviews = React.useMemo(() => query.data?.items ?? [], [query.data?.items])

  const avg =
    reviews.length > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0

  const distribution = React.useMemo(() => {
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    for (const r of reviews) {
      dist[r.rating] = (dist[r.rating] ?? 0) + 1
    }
    return dist
  }, [reviews])

  const fiveStarPercent =
    reviews.length > 0 ? Math.round(((distribution[5] ?? 0) / reviews.length) * 100) : 0

  const filteredReviews = React.useMemo(() => {
    if (selectedStar === "all") return reviews
    return reviews.filter((r) => r.rating === selectedStar)
  }, [reviews, selectedStar])

  const openReplyModal = (r: Review) => {
    setReplyReview(r)
    setReplyText(
      `Olá ${r.client.name.split(" ")[0]}, muito obrigado pela confiança e preferência! Foi uma satisfação atendê-lo(a). Conte sempre com meus serviços!`,
    )
  }

  const handleSendReply = () => {
    if (!replyReview) return
    setSentReplies((prev) => ({ ...prev, [replyReview.id]: replyText }))
    toast.success("Resposta enviada com sucesso!")
    setReplyReview(null)
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Reputação & Avaliações
          </h2>
          <p className="text-muted-foreground text-xs">
            Feedback em tempo real dos clientes atendidos em Governador Valadares e região.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reviews.length > 0 && avg >= 4.5 && (
            <Badge className="gap-1.5 border-amber-300/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <Award className="size-3.5 text-amber-500" /> Prestador Top Avaliado
            </Badge>
          )}
        </div>
      </div>

      {/* Summary Scorecard (Nielsen #1: Visibilidade do estado do sistema & #8: Estética minimalista) */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="bg-card overflow-hidden rounded-2xl border shadow-xs">
          <CardContent className="flex flex-col items-center justify-center gap-2.5 p-6 text-center">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Score de Reputação
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-primary text-5xl font-extrabold tracking-tight tabular-nums">
                {avg > 0 ? avg.toFixed(1) : "0.0"}
              </span>
              <span className="text-muted-foreground text-sm font-semibold">/ 5.0</span>
            </div>
            <StarRatingDisplay value={avg} size={22} showCount={false} />
            <p className="text-muted-foreground mt-1 text-xs font-medium tabular-nums">
              Baseado em <strong className="text-foreground">{reviews.length}</strong>{" "}
              {reviews.length === 1 ? "avaliação verificada" : "avaliações verificadas"}
            </p>
            {fiveStarPercent > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <Sparkles className="size-3.5" />
                <span>{fiveStarPercent}% das avaliações são 5 estrelas!</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card rounded-2xl border shadow-xs">
          <CardHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Star className="size-4 fill-amber-400 text-amber-400" />
                <span>Distribuição das Avaliações</span>
              </CardTitle>
              {selectedStar !== "all" && (
                <button
                  type="button"
                  onClick={() => setSelectedStar("all")}
                  className="text-primary text-xs font-semibold hover:underline"
                >
                  Limpar filtro
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <ul className="space-y-2.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = distribution[star] ?? 0
                const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0
                const isSelected = selectedStar === star
                return (
                  <li key={star}>
                    <button
                      type="button"
                      onClick={() => setSelectedStar(selectedStar === star ? "all" : star)}
                      className={cn(
                        "group hover:bg-muted/50 flex w-full items-center gap-3 rounded-lg p-1.5 text-xs transition-colors",
                        isSelected && "bg-primary/5 ring-primary/20 font-semibold ring-1",
                      )}
                    >
                      <span className="text-foreground flex w-12 items-center gap-1 font-semibold">
                        {star} <Star className="size-3 fill-amber-400 text-amber-400" />
                      </span>
                      <div className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
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
                      <span className="text-muted-foreground w-8 text-right font-medium tabular-nums">
                        {count}
                      </span>
                      <span className="text-muted-foreground w-10 text-right text-[10px] font-medium tabular-nums">
                        {pct.toFixed(0)}%
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Pílulas de Elogios e Qualidades (Nielsen #4 & #8) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground mr-1 text-xs font-semibold">
          Destaques do Perfil:
        </span>
        <Badge variant="outline" className="bg-muted/20 gap-1.5 px-3 py-1 text-xs">
          <Clock className="size-3.5 text-emerald-500" /> Pontualidade Britânica
        </Badge>
        <Badge variant="outline" className="bg-muted/20 gap-1.5 px-3 py-1 text-xs">
          <ShieldCheck className="size-3.5 text-blue-500" /> Serviço com Garantia
        </Badge>
        <Badge variant="outline" className="bg-muted/20 gap-1.5 px-3 py-1 text-xs">
          <MessageSquare className="text-primary size-3.5" /> Comunicação Ágil
        </Badge>
        <Badge variant="outline" className="bg-muted/20 gap-1.5 px-3 py-1 text-xs">
          <ThumbsUp className="size-3.5 text-teal-500" /> 100% Recomendado
        </Badge>
      </div>

      {/* Filtro de Estrelas Ativo */}
      <div className="flex items-center justify-between border-b pb-3">
        <p className="text-muted-foreground text-xs font-medium">
          Exibindo <strong className="text-foreground">{filteredReviews.length}</strong>{" "}
          {filteredReviews.length === 1 ? "depoimento" : "depoimentos"}
          {selectedStar !== "all" ? ` com ${selectedStar} estrelas` : ""}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant={selectedStar === "all" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedStar("all")}
            className="h-7 rounded-lg px-2.5 text-xs"
          >
            Todas
          </Button>
          <Button
            variant={selectedStar === 5 ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedStar(5)}
            className="h-7 rounded-lg px-2.5 text-xs"
          >
            5 ★
          </Button>
          <Button
            variant={selectedStar === 4 ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedStar(4)}
            className="h-7 rounded-lg px-2.5 text-xs"
          >
            4 ★
          </Button>
        </div>
      </div>

      {/* Listagem de Avaliações */}
      {query.isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/20 h-32 animate-pulse rounded-2xl border" />
          ))}
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="bg-muted/10 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
            <Star className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-foreground text-sm font-semibold">
              {reviews.length === 0
                ? "Ainda não há avaliações registradas"
                : `Nenhuma avaliação encontrada com ${selectedStar} estrelas.`}
            </p>
            <p className="text-muted-foreground max-w-sm text-xs">
              {reviews.length === 0
                ? "Finalize seus primeiros serviços pelo Severinno para que seus clientes de Governador Valadares possam avaliar e comentar."
                : "Selecione 'Todas' para visualizar os outros depoimentos."}
            </p>
          </div>
          {selectedStar !== "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedStar("all")}
              className="mt-1 h-8 text-xs"
            >
              Ver todas as avaliações
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReviews.map((r) => {
            const hasSentReply = sentReplies[r.id]
            return (
              <Card
                key={r.id}
                className="bg-card hover:border-primary/30 rounded-2xl border shadow-xs transition-all"
              >
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10 border shadow-xs">
                        {r.client.avatarUrl ? (
                          <AvatarImage src={r.client.avatarUrl} alt={r.client.name} />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {initials(r.client.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-foreground text-sm leading-tight font-semibold">
                          {r.client.name}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                          {formatDateTime(r.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                        <Star className="size-3.5 fill-amber-400 text-amber-400" />
                        <span>{r.rating.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>

                  {r.comment && (
                    <p className="text-foreground bg-muted/20 border-border/40 rounded-xl border p-3 text-sm leading-relaxed italic">
                      “{r.comment}”
                    </p>
                  )}

                  <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {r.service?.title && (
                        <span className="inline-flex items-center gap-1">
                          Serviço:
                          <Badge variant="secondary" className="text-[10px] font-semibold">
                            {r.service.title}
                          </Badge>
                        </span>
                      )}
                      {r.booking && (
                        <span className="tabular-nums">
                          Ref:{" "}
                          <strong className="text-foreground font-semibold">
                            #{r.booking.id.slice(-6)}
                          </strong>
                        </span>
                      )}
                    </div>

                    {/* Ação de Resposta / Agradecimento (Nielsen #7: Acelerador de relacionamento) */}
                    <div>
                      {hasSentReply ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <CheckCircle2 className="size-3.5" /> Agradecimento enviado
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openReplyModal(r)}
                          className="text-primary hover:bg-primary/10 h-7 px-2.5 text-xs font-semibold"
                        >
                          <MessageSquareReply className="mr-1.5 size-3.5" /> Agradecer cliente
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Resposta enviada exibida inline */}
                  {hasSentReply && (
                    <div className="text-foreground ml-4 space-y-1 rounded-xl border-l-2 border-emerald-500 bg-emerald-500/5 p-3 text-xs">
                      <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Sua resposta:
                      </p>
                      <p className="leading-relaxed">{hasSentReply}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal de Réplica / Agradecimento */}
      {replyReview && (
        <Dialog open={!!replyReview} onOpenChange={(open) => !open && setReplyReview(null)}>
          <DialogContent className="rounded-2xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <Heart className="size-4 fill-rose-500 text-rose-500" />
                <span>Agradecer {replyReview.client.name}</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Envie uma mensagem de agradecimento pela avaliação. Isso fortalece sua reputação e
                fideliza clientes em GV.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <label htmlFor="reply-text" className="text-muted-foreground text-xs font-medium">
                Mensagem pública de agradecimento
              </label>
              <Textarea
                id="reply-text"
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="rounded-xl text-xs"
              />
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReplyReview(null)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={handleSendReply} className="gap-1.5 text-xs font-semibold">
                <MessageSquareReply className="size-3.5" /> Enviar Resposta
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

export default ProviderReviews
