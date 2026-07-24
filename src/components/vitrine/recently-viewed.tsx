"use client"

/**
 * RecentlyViewed — "Prestadores que você visualizou" section.
 *
 * Nielsen heuristics:
 *   H6  Reconhecimento > memorização → no need to remember/search again
 *   H7  Eficiência                 → 1 click to reopen a provider
 *   H3  Controle e liberdade       → "limpar" to reset
 *
 * Shown in the vitrine below the hero, above the main results.
 */

import * as React from "react"
import { Star, MapPin, X, History, ArrowRight } from "lucide-react"
import Image from "next/image"

import { useRecentlyViewedStore } from "@/store/recently-viewed"
import { useUIStore } from "@/store/ui"
import { formatBRL } from "@/lib/format"
import { SERVICE_UNIT_SHORT } from "@/lib/constants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function RecentlyViewed() {
  const items = useRecentlyViewedStore((s) => s.items)
  const clear = useRecentlyViewedStore((s) => s.clear)
  const openProvider = useUIStore((s) => s.openProvider)

  if (items.length === 0) return null

  return (
    <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Card className="overflow-hidden border-slate-200 dark:border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <History className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">
                Vistos recentemente
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? "prestador" : "prestadores"} que você visualizou
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                <X className="size-3.5" />
                Limpar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar histórico?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso vai remover todos os prestadores vistos recentemente. Você
                  não pode desfazer esta ação.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={clear}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Limpar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Horizontal scroll on mobile, grid on desktop */}
          <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4 sm:pb-0">
            {items.map((p) => {
              const firstService = p.services?.[0]
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openProvider(p.id)}
                  className="group flex min-w-[220px] flex-col rounded-xl border border-slate-200 bg-card p-3 text-left transition-all hover:border-emerald-300 hover:shadow-md dark:border-slate-800 dark:hover:border-emerald-800 sm:min-w-0"
                >
                  {/* Header: avatar + name + rating */}
                  <div className="flex items-center gap-2.5">
                    {p.avatarUrl ? (
                      <Image
                        src={p.avatarUrl}
                        alt={p.name}
                        width={40}
                        height={40}
                        className="size-10 rounded-full object-cover ring-2 ring-emerald-500/20"
                      />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                        {p.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {p.name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                        <span className="font-medium text-foreground">
                          {p.rating.toFixed(1)}
                        </span>
                        <span>·</span>
                        <span>{p.reviewCount} aval.</span>
                      </div>
                    </div>
                  </div>

                  {/* Distance / city */}
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" />
                    <span className="truncate">
                      {p.distanceKm != null
                        ? `${p.distanceKm.toFixed(1)} km · ${p.city || "São Paulo"}`
                        : p.city || "São Paulo, SP"}
                    </span>
                  </div>

                  {/* First service price */}
                  {firstService && (
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                      <span className="truncate text-xs text-muted-foreground">
                        {firstService.title}
                      </span>
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        {formatBRL(firstService.basePrice)}
                      </span>
                    </div>
                  )}

                  {/* Action hint */}
                  <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100 dark:text-emerald-400">
                    Ver perfil
                    <ArrowRight className="size-3" />
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
