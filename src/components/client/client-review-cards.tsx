"use client"

import * as React from "react"
import { Clock, MapPin, MessageSquare, RotateCcw, Star, Wrench } from "lucide-react"

import { formatBRL, formatDate } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { StarRatingDisplay } from "@/components/modals/star-rating"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { CompletedBooking, ReviewItem } from "./client-reviews"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function providerInitials(name?: string | null): string {
  if (!name) return "PR"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Card: Pending Review — List Row (~75px)
// ---------------------------------------------------------------------------

export function PendingReviewListCard({
  booking,
  onReview,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  onReview: () => void
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="bg-card rounded-xl border border-amber-200/70 shadow-2xs transition-all duration-200 hover:border-amber-400/80 hover:shadow-xs dark:border-amber-900/40">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Left info cluster with round avatar */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-10.5 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors"
                >
                  {provider.name}
                </button>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <Clock className="size-2.5" />
                  Aguardando sua avaliação
                </span>
              </div>

              <p className="text-foreground/90 mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px]">
                <span className="tabular-nums">Concluído em {formatDate(booking.scheduledAt)}</span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatBRL(booking.amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 border-t pt-2 sm:border-0 sm:pt-0">
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onReview()
              }}
              className="h-7.5 gap-1 rounded-lg bg-amber-600 px-2.5 text-xs font-semibold text-white shadow-2xs hover:bg-amber-700"
            >
              <Star className="size-3 fill-white" />
              Avaliar agora
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onRebook()
              }}
              className="border-border/60 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2 text-xs font-semibold"
            >
              <RotateCcw className="text-primary size-3" />
              <span className="hidden sm:inline">Contratar novamente</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="border-border/60 hover:bg-muted/60 size-7.5 rounded-lg p-0"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card: Pending Review — Grid Bento (~160px)
// ---------------------------------------------------------------------------

export function PendingReviewCard({
  booking,
  onReview,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  onReview: () => void
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="bg-card relative overflow-hidden rounded-xl border border-amber-200/70 shadow-2xs transition-all duration-200 hover:border-amber-400/80 hover:shadow-xs dark:border-amber-900/40">
      <CardContent className="space-y-3 p-3.5 sm:p-4">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-11 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors sm:text-sm"
                >
                  {provider.name}
                </button>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <Clock className="size-2.5" />
                  Aguardando sua avaliação
                </span>
              </div>

              <p className="text-foreground/90 mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                <span className="tabular-nums">Concluído em {formatDate(booking.scheduledAt)}</span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatBRL(booking.amount)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Persuasive Callout Banner */}
        <div className="flex items-center gap-2 rounded-lg border border-amber-200/60 bg-amber-50/50 p-2 text-[11px] text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-200">
          <Star className="size-3.5 shrink-0 fill-amber-500 text-amber-500" />
          <span className="leading-relaxed">
            Seu feedback de 30 segundos valoriza o profissional e fortalece a comunidade.
          </span>
        </div>

        {/* Actions Bar */}
        <div className="border-border/40 flex flex-wrap items-center gap-1.5 border-t pt-2">
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onReview()
            }}
            className="h-8 gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-amber-700"
          >
            <Star className="size-3.5 fill-white" />
            Avaliar agora
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onRebook()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
          >
            <RotateCcw className="text-primary size-3" />
            Contratar novamente
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg px-2.5 text-xs font-medium"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
            Mensagem
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card: Submitted Review — List Row (~75px)
// ---------------------------------------------------------------------------

export function SubmittedReviewListCard({
  booking,
  review,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  review: ReviewItem
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 rounded-xl border shadow-2xs transition-all duration-200 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Left info cluster with round avatar */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-10.5 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors"
                >
                  {provider.name}
                </button>
                <div className="flex items-center gap-1">
                  <StarRatingDisplay value={review.rating} size={13} showCount={false} />
                  <span className="py-0.2 rounded bg-amber-500/10 px-1 text-[10px] font-bold text-amber-700 tabular-nums dark:text-amber-400">
                    {review.rating.toFixed(1)} ★
                  </span>
                </div>
              </div>

              <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-xs">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              <span className="text-muted-foreground text-[10.5px] tabular-nums">
                Avaliado em {formatDate(review.createdAt)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 border-t pt-2 sm:border-0 sm:pt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onRebook()
              }}
              className="border-border/60 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2 text-xs font-semibold"
            >
              <RotateCcw className="text-primary size-3" />
              <span className="hidden sm:inline">Contratar novamente</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="border-border/60 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2 text-xs font-medium"
            >
              <MapPin className="text-primary size-3" />
              <span className="hidden sm:inline">Ver perfil</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="border-border/60 hover:bg-muted/60 size-7.5 rounded-lg p-0"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Comment on mobile if present */}
        {review.comment && (
          <div className="border-border/40 bg-muted/20 text-foreground/90 mt-2 block rounded-lg border p-2 text-xs italic sm:hidden">
            &ldquo;{review.comment}&rdquo;
          </div>
        )}

        {/* Provider Reply */}
        {review.providerReply && (
          <div className="border-primary/20 bg-primary/5 text-foreground mt-2 rounded-lg border p-2 text-xs">
            <p className="text-primary text-[11px] font-semibold">Resposta de {provider.name}:</p>
            <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
              {review.providerReply}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card: Submitted Review — Grid Bento (~160px)
// ---------------------------------------------------------------------------

export function SubmittedReviewCard({
  booking,
  review,
  onViewProvider,
  onRebook,
  onMessage,
}: {
  booking: CompletedBooking
  review: ReviewItem
  onViewProvider: () => void
  onRebook: () => void
  onMessage: () => void
}) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-xl border shadow-2xs transition-all duration-200 hover:shadow-xs">
      <CardContent className="space-y-3 p-3.5 sm:p-4">
        {/* Header */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/60 size-11 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-xs font-bold transition-colors sm:text-sm"
                >
                  {provider.name}
                </button>
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  Avaliado em {formatDate(review.createdAt)}
                </span>
              </div>

              <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium">
                <Wrench className="text-primary size-3 shrink-0" />
                <span className="truncate">{booking.service.title}</span>
              </p>

              {/* Star Rating Display */}
              <div className="mt-1.5 flex items-center gap-1.5">
                <StarRatingDisplay value={review.rating} size={14} showCount={false} />
                <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10.5px] font-bold text-amber-700 tabular-nums dark:text-amber-400">
                  {review.rating.toFixed(1)} ★
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Comment Bubble */}
        {review.comment ? (
          <div className="border-border/40 bg-muted/30 text-foreground rounded-lg border p-2.5 text-xs leading-relaxed">
            <p className="text-foreground/90 whitespace-pre-line italic">
              &ldquo;{review.comment}&rdquo;
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs italic">
            Avaliação registrada sem comentário escrito.
          </p>
        )}

        {/* Provider Reply */}
        {review.providerReply && (
          <div className="border-primary/20 bg-primary/5 text-foreground rounded-lg border p-2.5 text-xs">
            <p className="text-primary font-semibold">Resposta de {provider.name}:</p>
            <p className="text-muted-foreground mt-0.5 leading-relaxed">{review.providerReply}</p>
          </div>
        )}

        {/* Actions Bar */}
        <div className="border-border/40 flex flex-wrap items-center gap-1.5 border-t pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onRebook()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg text-xs font-semibold"
          >
            <RotateCcw className="text-primary size-3" />
            Contratar novamente
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onViewProvider()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg text-xs font-medium"
          >
            <MapPin className="text-primary size-3" />
            Ver perfil
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-lg text-xs font-medium"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
            Mensagem
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
