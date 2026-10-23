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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
    <section className="mx-auto w-full max-w-[95%] px-4 py-4 sm:px-6 lg:px-8">
      <Card className="overflow-hidden border-slate-200/80 shadow-xs dark:border-slate-800/80">
        <CardHeader className="flex flex-row items-center justify-between gap-3 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <History className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Vistos recentemente</CardTitle>
              <p className="text-muted-foreground text-xs">
                {items.length} {items.length === 1 ? "prestador" : "prestadores"} que você
                visualizou
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground h-8 text-xs">
                <X className="size-3.5" />
                Limpar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar histórico?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso vai remover todos os prestadores vistos recentemente. Você não pode desfazer
                  esta ação.
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
        <CardContent className="pt-0 pb-4">
          {/* Horizontal scroll on mobile, 4-column grid on desktop */}
          <div className="flex [scrollbar-width:thin] gap-3.5 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-4">
            {items.map((p) => {
              const firstService = p.services?.[0]
              return (
                <button
                  key={p.id}
                  type="button"
                  data-provider-id={p.id}
                  data-compare-name={p.name}
                  data-compare-avatar={p.avatarUrl ?? ""}
                  onClick={() => openProvider(p.id)}
                  className="group bg-card flex min-w-[220px] flex-col rounded-xl border border-slate-200/80 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:min-w-0 dark:border-slate-800 dark:hover:border-slate-700"
                >
                  {/* Header: avatar + name + rating */}
                  <div className="flex items-center gap-3">
                    {p.avatarUrl ? (
                      <Image
                        src={p.avatarUrl}
                        alt={p.name}
                        width={40}
                        height={40}
                        className="size-10 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                      />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {p.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight font-semibold text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-slate-100 dark:group-hover:text-emerald-400">
                        {p.name}
                      </p>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                        <span className="text-foreground font-medium">{p.rating.toFixed(1)}</span>
                        <span>·</span>
                        <span>{p.reviewCount} aval.</span>
                      </div>
                    </div>
                  </div>

                  {/* Distance / city */}
                  <div className="text-muted-foreground mt-2.5 flex items-center gap-1 text-xs">
                    <MapPin className="size-3 shrink-0" />
                    <span className="truncate">
                      {p.distanceKm != null
                        ? `${p.distanceKm.toFixed(1)} km · ${p.city || "Governador Valadares"}`
                        : p.city || "Governador Valadares, MG"}
                    </span>
                  </div>

                  {/* First service price + action hint */}
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800/80">
                    {firstService ? (
                      <>
                        <span className="text-muted-foreground truncate pr-2 text-xs">
                          {firstService.title}
                        </span>
                        <span className="shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">
                          {formatBRL(firstService.basePrice)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">Sob consulta</span>
                    )}
                  </div>

                  {/* Action hint */}
                  <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <span>Reabrir perfil</span>
                    <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
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
