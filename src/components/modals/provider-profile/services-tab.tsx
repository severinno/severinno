"use client"

import * as React from "react"
import Image from "next/image"
import { Calendar, ChevronDown, ChevronUp, Clock, Quote, ShieldCheck, Wrench } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBRL } from "@/lib/format"
import { SERVICE_UNIT_SHORT } from "@/lib/constants"
import { type ProviderService } from "@/lib/api"
import { cn } from "@/lib/utils"
import { decodeEntities, EmptyState, getQuickSlotsForProvider } from "./shared"

export function ServicesTab({
  providerId,
  services,
  loading,
  onQuote,
  onBooking,
}: {
  providerId?: string
  services: ProviderService[]
  loading: boolean
  onQuote: (serviceId?: string) => void
  onBooking: (serviceId?: string) => void
}) {
  // Group by category
  const groups = React.useMemo(() => {
    const g = new Map<string, ProviderService[]>()
    for (const s of services) {
      const key = s.category?.name ?? "Outros"
      const arr = g.get(key) ?? []
      arr.push(s)
      g.set(key, arr)
    }
    return g
  }, [services])

  const [expandedCats, setExpandedCats] = React.useState<Set<string>>(() => new Set(groups.keys()))

  // Sync when services change
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setExpandedCats(new Set(groups.keys())))
    return () => cancelAnimationFrame(id)
  }, [groups])

  const quickSlots = React.useMemo(() => getQuickSlotsForProvider(providerId), [providerId])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (services.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="Nenhum serviço"
        description="Este prestador ainda não publicou serviços."
      />
    )
  }

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Quick-Book Next Available Slots Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 transition-all sm:px-4 sm:py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <Clock className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-foreground text-xs font-bold">
              Horários livres para agendamento rápido
            </p>
            <p className="text-muted-foreground text-[11px]">
              Agende direto com garantia e custódia segura
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {quickSlots.map((slot) => (
            <button
              key={slot.label}
              type="button"
              onClick={() => onBooking(services[0]?.id)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-2xs transition-all hover:scale-[1.02] active:scale-98",
                slot.isToday
                  ? "bg-emerald-600 text-white shadow-emerald-600/10 hover:bg-emerald-700"
                  : "bg-background border-border/80 text-foreground hover:bg-muted/80 border",
              )}
            >
              <Calendar className="size-3" />
              <span>{slot.label}</span>
            </button>
          ))}
        </div>
      </div>

      {Array.from(groups.entries()).map(([categoryName, items]) => {
        const expanded = expandedCats.has(categoryName)
        return (
          <div key={categoryName} className="w-full min-w-0">
            {/* Category header */}
            <button
              type="button"
              onClick={() => toggleCat(categoryName)}
              className="hover:bg-muted/40 mb-2 flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-6.5 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Wrench className="size-3.5" />
                </span>
                <span className="text-foreground text-xs font-bold sm:text-sm">
                  {decodeEntities(categoryName)}
                </span>
                <span className="bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold">
                  {items.length} {items.length === 1 ? "opção" : "opções"}
                </span>
              </div>
              {expanded ? (
                <ChevronUp className="text-muted-foreground size-4" />
              ) : (
                <ChevronDown className="text-muted-foreground size-4" />
              )}
            </button>

            {/* Service items */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 pb-1">
                    {items.map((s) => (
                      <ServiceCard
                        key={s.id}
                        service={s}
                        onQuote={() => onQuote(s.id)}
                        onBooking={() => onBooking(s.id)}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

export function ServiceCard({
  service,
  onQuote,
  onBooking,
}: {
  service: ProviderService
  onQuote: () => void
  onBooking: () => void
}) {
  const photos = service.photos ?? []

  return (
    <div className="group border-border/60 bg-card w-full min-w-0 rounded-2xl border p-4 transition-all hover:border-emerald-500/40 hover:shadow-xs">
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          {/* Thumbnail / Icon */}
          {photos.length > 0 ? (
            <div className="bg-muted border-border/40 relative size-14 shrink-0 overflow-hidden rounded-xl border shadow-2xs">
              <Image
                src={photos[0]}
                alt={service.title}
                fill
                sizes="56px"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/10 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Wrench className="size-5" />
            </div>
          )}

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-foreground text-sm leading-tight font-bold transition-colors group-hover:text-emerald-600 sm:text-base dark:group-hover:text-emerald-400">
                {decodeEntities(service.title)}
              </h4>
            </div>

            {service.description && (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                {decodeEntities(service.description)}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="inline-flex items-baseline gap-1">
                <span className="text-muted-foreground text-xs font-medium">A partir de</span>
                <span className="text-base font-black text-emerald-700 sm:text-lg dark:text-emerald-400">
                  {formatBRL(Number(service.basePrice))}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  /{SERVICE_UNIT_SHORT[service.unit as keyof typeof SERVICE_UNIT_SHORT] ?? "un"}
                </span>
              </div>
              <span className="text-muted-foreground/30 hidden sm:inline">•</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-3" /> Garantia 90 dias
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2 sm:pl-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onQuote}
            className="border-border/70 hover:bg-muted/70 h-9 cursor-pointer rounded-xl px-3.5 text-xs font-semibold shadow-none transition-colors active:scale-95"
          >
            <Quote className="mr-1.5 size-3.5" /> Orçamento
          </Button>
          <Button
            size="sm"
            onClick={onBooking}
            className="h-9 cursor-pointer rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95"
          >
            <Calendar className="mr-1.5 size-3.5" /> Agendar
          </Button>
        </div>
      </div>
    </div>
  )
}
