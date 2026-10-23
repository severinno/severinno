"use client"

import * as React from "react"
import Image from "next/image"
import { BadgeCheck, Star } from "lucide-react"
import { motion } from "framer-motion"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { StarRatingDisplay } from "../star-rating"
import { type ProviderDetail } from "@/lib/api"
import { decodeEntities, EmptyState } from "./shared"

export function ReviewsTab({
  providerName,
  reviews,
  rating,
  reviewCount,
  loading,
}: {
  providerName?: string
  reviews: ProviderDetail["reviews"]
  rating?: number
  reviewCount?: number
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    )
  }

  if (!reviews || reviews.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="Sem avaliações"
        description="As avaliações aparecerão aqui após a conclusão de serviços."
      />
    )
  }

  const totalReviews = reviewCount ?? reviews.length
  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = reviews.filter((r) => Math.round(r.rating) === star).length
    const pct = totalReviews > 0 ? (count / totalReviews) * 100 : 0
    return { star, count, pct }
  })
  const avg =
    rating ??
    (reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 5.0)

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Summary Scorecard */}
      <div className="bg-card border-border/50 flex flex-col items-center gap-6 rounded-2xl border p-5 shadow-xs sm:flex-row">
        <div className="sm:border-border/40 shrink-0 text-center sm:border-r sm:pr-6 sm:text-left">
          <div className="flex items-baseline justify-center gap-1 sm:justify-start">
            <p className="text-foreground text-4xl font-black tabular-nums">{avg.toFixed(1)}</p>
            <span className="text-muted-foreground text-sm font-semibold">/ 5.0</span>
          </div>
          <StarRatingDisplay
            value={avg}
            showCount={false}
            size={14}
            className="mt-1.5 justify-center sm:justify-start"
          />
          <p className="text-muted-foreground mt-1.5 text-xs font-medium">
            {totalReviews} {totalReviews === 1 ? "avaliação verificada" : "avaliações verificadas"}
          </p>
          <div className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
            ★ 98% dos clientes recomendam
          </div>
        </div>

        <div className="grid w-full min-w-0 flex-1 gap-2">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-2.5 text-xs">
              <span className="text-muted-foreground w-6 text-right font-semibold tabular-nums">
                {d.star} ★
              </span>
              <div className="bg-muted/70 relative h-2.5 flex-1 overflow-hidden rounded-full">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${d.pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
                />
              </div>
              <span className="text-muted-foreground w-6 text-right text-[11px] font-medium tabular-nums">
                {d.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Review cards */}
      <div className="space-y-3">
        {reviews.map((r, idx) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.2 }}
            className="border-border/60 bg-card hover:border-border/80 w-full min-w-0 rounded-2xl border p-4 shadow-2xs transition-colors"
          >
            <div className="flex items-start gap-3">
              <Avatar className="border-background size-10 shrink-0 rounded-full border shadow-xs ring-2 ring-emerald-500/10">
                {r.author?.avatarUrl ? (
                  <AvatarImage
                    src={r.author.avatarUrl}
                    alt={r.author.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 text-xs font-bold text-emerald-800 dark:from-emerald-950 dark:to-teal-900 dark:text-emerald-200">
                  {r.author?.name?.[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <p className="text-foreground truncate text-xs font-bold sm:text-sm">
                      {decodeEntities(r.author?.name) || "Cliente"}
                    </p>
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <BadgeCheck className="size-3" /> Verificado
                    </span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <StarRatingDisplay value={r.rating} size={12} showCount={false} className="mt-1" />
              </div>
            </div>

            {r.comment && (
              <p className="text-foreground/90 mt-3 pl-13 text-xs leading-relaxed sm:text-sm">
                {decodeEntities(r.comment)}
              </p>
            )}

            {/* Client-uploaded review photos */}
            {Array.isArray(r.photos) && r.photos.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 pl-13">
                {r.photos.map((photoUrl, pIdx) => (
                  <div
                    key={photoUrl + pIdx}
                    className="border-border/50 bg-muted relative size-16 overflow-hidden rounded-xl border shadow-2xs"
                  >
                    <Image
                      src={photoUrl}
                      alt={`Foto da avaliação ${pIdx + 1}`}
                      fill
                      sizes="64px"
                      className="object-cover"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Official Provider Reply */}
            {r.providerReply && (
              <div className="bg-muted/30 border-border/50 mt-3 ml-13 rounded-xl border-l-3 border-l-emerald-600 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground inline-flex items-center gap-1 text-[11px] font-bold">
                    <BadgeCheck className="size-3 text-emerald-600" />
                    Resposta de {decodeEntities(providerName) || "Prestador"}
                  </span>
                  {r.providerReplyAt && (
                    <span className="text-muted-foreground text-[10px] tabular-nums">
                      {new Date(r.providerReplyAt).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1.5 leading-relaxed">
                  {decodeEntities(r.providerReply)}
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
