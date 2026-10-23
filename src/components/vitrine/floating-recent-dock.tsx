"use client"

import * as React from "react"
import { History, Star, X, GitCompare, CalendarDays, Sparkles } from "lucide-react"
import Image from "next/image"
import { useRecentlyViewedStore } from "@/store/recently-viewed"
import { useUIStore } from "@/store/ui"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { formatBRL } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function FloatingRecentDock() {
  const items = useRecentlyViewedStore((s) => s.items)
  const clear = useRecentlyViewedStore((s) => s.clear)
  const openProvider = useUIStore((s) => s.openProvider)
  const openBooking = useUIStore((s) => s.openBooking)
  const compareIds = useCompareStore((s) => s.ids) ?? []
  const toggleCompare = useCompareStore((s) => s.toggle)

  const [expanded, setExpanded] = React.useState(false)

  // Don't render until user has actually viewed at least 1 provider
  if (!items || items.length === 0) return null

  const handleCompareAll = () => {
    items.slice(0, MAX_COMPARE).forEach((p) => {
      if (!compareIds.includes(p.id)) {
        toggleCompare(p.id)
      }
    })
    toast.success(`${Math.min(items.length, MAX_COMPARE)} prestadores adicionados à comparação!`)
  }

  return (
    <div data-testid="floating-recent-dock" className="fixed bottom-5 left-4 z-40 sm:left-6">
      {/* Expanded Mini-Drawer / Card */}
      {expanded ? (
        <div className="border-border/80 bg-background/95 animate-in slide-in-from-bottom-3 w-[320px] rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all duration-200 sm:w-[350px]">
          <div className="border-border/50 flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <History className="size-4" />
              </div>
              <div>
                <h4 className="text-foreground text-xs font-bold">Vistos Recentemente</h4>
                <p className="text-muted-foreground text-[10px]">{items.length} profissionais</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                className="text-muted-foreground hover:text-destructive h-7 px-2 text-[10px]"
              >
                Limpar
              </Button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1"
                aria-label="Minimizar dock"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* List of items */}
          <div className="max-h-[260px] [scrollbar-width:thin] space-y-2 overflow-y-auto py-2.5">
            {items.map((p) => {
              const minPrice = p.services?.[0]?.basePrice
              return (
                <div
                  key={p.id}
                  data-provider-id={p.id}
                  data-compare-name={p.name}
                  data-compare-avatar={p.avatarUrl ?? ""}
                  onClick={() => openProvider(p.id)}
                  className="group border-border/50 bg-card/60 hover:bg-muted/40 flex cursor-pointer items-center justify-between gap-2.5 rounded-xl border p-2 transition-all hover:border-emerald-500/40"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="bg-muted relative size-9 shrink-0 overflow-hidden rounded-lg">
                      {p.avatarUrl ? (
                        <Image
                          src={p.avatarUrl}
                          alt={p.name}
                          fill
                          className="object-cover"
                          sizes="36px"
                        />
                      ) : (
                        <div className="text-muted-foreground flex size-full items-center justify-center text-xs font-bold">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-foreground truncate text-xs font-semibold transition-colors group-hover:text-emerald-600">
                        {p.name}
                      </p>
                      <div className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
                        <span className="flex items-center gap-0.5 font-medium text-amber-500">
                          <Star className="size-2.5 fill-current" />
                          {p.rating > 0 ? p.rating.toFixed(1) : "Novo"}
                        </span>
                        {typeof minPrice === "number" && (
                          <span>· a partir de {formatBRL(minPrice)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        openBooking({ providerId: p.id, serviceId: p.services?.[0]?.id })
                      }}
                      className="h-7 shrink-0 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                    >
                      <CalendarDays className="mr-1 size-3" />
                      Agendar
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Bottom Actions */}
          {items.length >= 2 && (
            <div className="border-border/50 flex gap-2 border-t pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCompareAll}
                className="h-8 w-full gap-1.5 border-emerald-500/30 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
              >
                <GitCompare className="size-3.5" />
                Comparar prestadores
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Minimized Floating Pill */
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group bg-background/95 flex cursor-pointer items-center gap-2 rounded-full border border-emerald-500/30 px-3 py-1.5 shadow-lg backdrop-blur-md transition-all hover:scale-105 hover:border-emerald-500"
          aria-label="Abrir prestadores vistos recentemente"
        >
          {/* Overlapping Avatar Stack */}
          <div className="flex -space-x-2 overflow-hidden">
            {items.slice(0, 3).map((p, idx) => (
              <div
                key={p.id}
                className="ring-background bg-muted relative inline-block size-6 overflow-hidden rounded-full ring-2"
                style={{ zIndex: 3 - idx }}
              >
                {p.avatarUrl ? (
                  <Image
                    src={p.avatarUrl}
                    alt={p.name}
                    fill
                    className="object-cover"
                    sizes="24px"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-[9px] font-bold">
                    {p.name.slice(0, 1)}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs font-medium">
            <span className="text-foreground font-semibold">
              {items.length} {items.length === 1 ? "visto" : "vistos"}
            </span>
            <span className="py-0.2 inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="mr-0.5 size-2" /> Reabrir
            </span>
          </div>
        </button>
      )}
    </div>
  )
}
