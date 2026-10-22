"use client"

import * as React from "react"
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  X,
  XCircle,
  CheckCircle2,
} from "lucide-react"

import {
  QUOTE_ITEM_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type QuoteItemStatus,
  type QuoteStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDate, formatDateTime } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import {
  parseTransparentQuoteNote,
  type TransparentQuoteBreakdown,
} from "@/lib/materials-breakdown"
import { StatusBadge, quoteIcon, quoteTone } from "@/components/client/client-shared"
import { QuoteTimeline } from "@/components/shared/flow-timeline"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { QuoteRequest } from "./client-quotes"

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

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}

export type QuoteCardProps = {
  quote: QuoteRequest
  onApprove: () => void
  onReject: () => void
  onViewProvider: () => void
  onSchedule?: () => void
  onMessage: () => void
  onViewBreakdown?: (info: {
    title: string
    category?: string
    breakdown: TransparentQuoteBreakdown
  }) => void
  isApproving: boolean
  isRejecting: boolean
}

// ---------------------------------------------------------------------------
// QuoteListCard — Ultra-compact row (~80px)
// ---------------------------------------------------------------------------

export function QuoteListCard({
  quote,
  onApprove,
  onReject,
  onViewProvider,
  onSchedule,
  onMessage,
  onViewBreakdown,
  isApproving,
  isRejecting,
}: QuoteCardProps) {
  const [open, setOpen] = React.useState(false)
  const now = useNow()

  const provider = quote.provider
  const initials = providerInitials(provider.name)
  const status = quote.status as QuoteStatus
  const totalQuoted = quote.items.reduce((acc, i) => acc + (i.price ?? 0) * i.quantity, 0)
  const allQuoted = quote.items.every((i) => i.status === "QUOTED" || i.status === "ACCEPTED")
  const canApprove = status === "RESPONDED" || (status === "PENDING" && allQuoted)
  const canReject = status === "RESPONDED" || status === "PENDING" || status === "APPROVED"
  const isExpired =
    status === "EXPIRED" || (status !== "APPROVED" && new Date(quote.expiresAt).getTime() < now)

  const itemsCount = quote.items.length
  const firstServiceTitle = quote.items[0]?.service?.title ?? "—"

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 rounded-xl shadow-2xs transition-all duration-200 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
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
              <Avatar className="border-border/40 size-10.5 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials || "PR"}
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
                  className="text-foreground hover:text-primary truncate text-xs font-bold tracking-tight transition-colors"
                >
                  {provider.name}
                </button>
                <StatusBadge
                  tone={quoteTone(status)}
                  icon={quoteIcon(status)}
                  className="text-[10px]"
                >
                  {QUOTE_STATUS_LABELS[status]}
                </StatusBadge>
                {isExpired && status !== "EXPIRED" ? (
                  <StatusBadge tone="zinc" icon={Clock} className="text-[10px]">
                    Expirado
                  </StatusBadge>
                ) : null}
              </div>

              <p className="text-foreground/90 truncate text-xs font-medium">
                {firstServiceTitle}
                {itemsCount > 1
                  ? ` (+${itemsCount - 1} ${itemsCount === 2 ? "item" : "itens"})`
                  : ""}
              </p>

              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px]">
                <span className="tabular-nums">Solicitado {formatDate(quote.createdAt)}</span>
                <span className="hidden sm:inline">·</span>
                <span className="tabular-nums">Expira {formatDate(quote.expiresAt)}</span>
                <span className="hidden sm:inline">·</span>
                <span className="max-w-[12rem] truncate">{quote.address}</span>
              </div>
            </div>
          </div>

          {/* Right cluster: Price & Quick Action buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 sm:justify-end sm:border-0 sm:pt-0">
            <div className="text-left sm:text-right">
              {allQuoted && totalQuoted > 0 ? (
                <div>
                  <span className="text-foreground text-sm font-bold tracking-tight tabular-nums sm:text-base">
                    {formatBRL(totalQuoted)}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs font-medium">Aguardando preços</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {status === "APPROVED" && onSchedule && (
                <Button
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    onSchedule()
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs transition-all active:scale-95 sm:h-8"
                >
                  <CalendarDays className="size-3.5" />
                  Agendar Atendimento
                </Button>
              )}

              {canApprove && (
                <Button
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    onApprove()
                  }}
                  disabled={isApproving}
                  className="h-10 gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
                >
                  {isApproving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Aprovar orçamento
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onViewProvider()
                }}
                className="border-border/60 hover:bg-muted/60 h-8.5 gap-1.5 rounded-xl px-2 text-xs font-medium transition-all active:scale-95 sm:h-8"
              >
                <MapPin className="text-primary size-3" />
                <span className="hidden sm:inline">Ver prestador</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onMessage()
                }}
                className="border-border/60 hover:bg-muted/60 size-8.5 rounded-xl p-0 transition-all active:scale-95 sm:size-8"
                title="Enviar mensagem na plataforma"
                aria-label="Enviar mensagem na plataforma"
              >
                <MessageSquare className="size-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  setOpen(!open)
                }}
                className="text-primary hover:bg-primary/10 h-8.5 gap-1.5 rounded-xl px-2 text-xs font-semibold transition-all active:scale-95 sm:h-8"
                aria-label={
                  open
                    ? "Ocultar itens detalhados"
                    : `Ver ${itemsCount} ${itemsCount === 1 ? "item detalhado" : "itens detalhados"}`
                }
              >
                <FileText className="size-3" />
                <span className="hidden md:inline">
                  {open
                    ? "Ocultar"
                    : `Ver ${itemsCount} ${itemsCount === 1 ? "item detalhado" : "itens detalhados"}`}
                </span>
                {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Collapsible details for List view */}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent className="space-y-2.5 pt-2.5">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <QuoteTimeline status={status} />
            </div>

            <ul className="divide-border/40 border-border/60 bg-muted/20 divide-y overflow-hidden rounded-xl border">
              {quote.items.map((it) => {
                const subtotal = it.price != null ? it.price * it.quantity : null
                const itemStatus = it.status as QuoteItemStatus
                const unitStr = SERVICE_UNIT_SHORT[it.unit as ServiceUnit] || it.unit
                const breakdown = parseTransparentQuoteNote(it.providerNote)

                return (
                  <li key={it.id} className="space-y-1.5 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold">
                        <span>{it.service.title}</span>
                        <StatusBadge tone="zinc" className="text-[9px]">
                          {QUOTE_ITEM_STATUS_LABELS[itemStatus] ?? it.status}
                        </StatusBadge>
                      </div>
                      <span className="font-bold tabular-nums">
                        {subtotal != null ? formatBRL(subtotal) : "—"}
                      </span>
                    </div>

                    <p className="text-muted-foreground text-[11px]">
                      {it.quantity} {unitStr} ·{" "}
                      {it.price != null
                        ? `${formatBRL(it.price)} / ${unitStr}`
                        : "Aguardando preço"}
                    </p>

                    {breakdown && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          triggerHaptic("selection")
                          onViewBreakdown?.({
                            title: it.service.title,
                            category: it.service.title,
                            breakdown,
                          })
                        }}
                        className="h-6.5 gap-1 rounded-lg border-blue-300 bg-blue-50/60 px-2 text-[10.5px] font-semibold text-blue-700 shadow-2xs hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                      >
                        <Package className="size-3 text-blue-600 dark:text-blue-400" />
                        Ver Mão de Obra vs Materiais ({formatBRL(breakdown.laborCost)} +{" "}
                        {formatBRL(breakdown.materialsCost)})
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>

            {canReject && (
              <div className="flex justify-end pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    onReject()
                  }}
                  disabled={isRejecting}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive h-7 gap-1 rounded-lg text-xs font-medium"
                >
                  {isRejecting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                  Rejeitar orçamento
                </Button>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// QuoteCard — Grid Bento Card (~160px)
// ---------------------------------------------------------------------------

export function QuoteCard({
  quote,
  onApprove,
  onReject,
  onViewProvider,
  onSchedule,
  onMessage,
  onViewBreakdown,
  isApproving,
  isRejecting,
}: QuoteCardProps) {
  const [open, setOpen] = React.useState(false)
  const now = useNow()

  const provider = quote.provider
  const initials = providerInitials(provider.name)

  const status = quote.status as QuoteStatus
  const totalQuoted = quote.items.reduce((acc, i) => acc + (i.price ?? 0) * i.quantity, 0)
  const allQuoted = quote.items.every((i) => i.status === "QUOTED" || i.status === "ACCEPTED")
  const canApprove = status === "RESPONDED" || (status === "PENDING" && allQuoted)
  const canReject = status === "RESPONDED" || status === "PENDING" || status === "APPROVED"
  const isExpired =
    status === "EXPIRED" || (status !== "APPROVED" && new Date(quote.expiresAt).getTime() < now)

  const itemsCount = quote.items.length
  const firstServiceTitle = quote.items[0]?.service?.title ?? "—"

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-xl shadow-2xs transition-all duration-200 hover:shadow-xs">
      <CardContent className="space-y-3.5 p-3.5 sm:p-4">
        {/* Header */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {/* Round Avatar */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/40 size-11 rounded-full border shadow-2xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials || "PR"}
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
                  className="text-foreground hover:text-primary truncate text-sm font-bold tracking-tight transition-colors"
                >
                  {provider.name}
                </button>
                <StatusBadge
                  tone={quoteTone(status)}
                  icon={quoteIcon(status)}
                  className="text-[10px]"
                >
                  {QUOTE_STATUS_LABELS[status]}
                </StatusBadge>
                {isExpired && status !== "EXPIRED" ? (
                  <StatusBadge tone="zinc" icon={Clock} className="text-[10px]">
                    Expirado
                  </StatusBadge>
                ) : null}
              </div>

              <p className="text-foreground/90 mt-0.5 truncate text-xs font-medium">
                {itemsCount} {itemsCount === 1 ? "serviço solicitado" : "serviços solicitados"} ·{" "}
                <span className="text-muted-foreground">{firstServiceTitle}</span>
                {itemsCount > 1 ? ` (+${itemsCount - 1})` : ""}
              </p>

              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Clock className="text-primary size-3" />
                  {formatDateTime(quote.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <CalendarClock className="text-primary size-3" />
                  Expira {formatDate(quote.expiresAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="text-primary/70 size-3" />
                  <span className="max-w-[12rem] truncate">{quote.address}</span>
                </span>
              </div>
            </div>
          </div>

          {allQuoted && totalQuoted > 0 ? (
            <div className="flex shrink-0 flex-col sm:items-end">
              <span className="text-muted-foreground text-[11px] font-medium">Total orçado</span>
              <span className="text-foreground text-base font-bold tracking-tight tabular-nums sm:text-lg">
                {formatBRL(totalQuoted)}
              </span>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col sm:items-end">
              <span className="text-muted-foreground text-[11px]">Status</span>
              <span className="text-muted-foreground text-xs font-medium">Aguardando preços</span>
            </div>
          )}
        </div>

        {/* Contextual Reassurance Banner */}
        {status === "APPROVED" ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-2 text-xs font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Orçamento aprovado por você! Escolha o horário para agendar.</span>
            </div>
            <span className="hidden font-bold text-emerald-700 sm:inline dark:text-emerald-300">
              Pronto para agendar
            </span>
          </div>
        ) : status === "RESPONDED" ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200/60 bg-blue-50/50 p-2 text-xs font-medium text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
            <div className="flex items-center gap-1.5">
              <FileText className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              <span>Proposta enviada pelo prestador. Revise e aprove.</span>
            </div>
            <span className="font-bold text-blue-700 dark:text-blue-300">Aguardando aprovação</span>
          </div>
        ) : status === "PENDING" ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-200/60 bg-amber-50/40 p-2 text-xs font-medium text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
            <Clock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Aguardando o prestador formalizar valores e prazos.</span>
          </div>
        ) : status === "REJECTED" ? (
          <div className="border-border/50 bg-muted/30 text-muted-foreground flex items-center gap-1.5 rounded-lg border p-2 text-xs font-medium">
            <XCircle className="size-3.5 shrink-0 text-rose-500" />
            <span>Orçamento rejeitado · Você pode solicitar nova cotação quando desejar.</span>
          </div>
        ) : null}

        {/* Expandable items with flow transparency */}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => triggerHaptic("selection")}
              className="text-primary hover:bg-primary/10 h-7 gap-1.5 rounded-lg px-2 text-xs font-semibold"
            >
              <FileText className="size-3" />
              <span>
                {open
                  ? "Ocultar itens detalhados"
                  : `Ver ${itemsCount} ${itemsCount === 1 ? "item detalhado" : "itens detalhados"}`}
              </span>
              {open ? (
                <ChevronUp className="ml-0.5 size-3" />
              ) : (
                <ChevronDown className="ml-0.5 size-3" />
              )}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-2.5 space-y-2.5">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <QuoteTimeline status={status} />
            </div>

            <ul className="divide-border/40 border-border/60 bg-muted/20 divide-y overflow-hidden rounded-xl border">
              {quote.items.map((it) => {
                const subtotal = it.price != null ? it.price * it.quantity : null
                const itemStatus = it.status as QuoteItemStatus
                const unitStr = SERVICE_UNIT_SHORT[it.unit as ServiceUnit] || it.unit

                return (
                  <li key={it.id} className="grid gap-1.5 p-3 text-xs sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-foreground font-bold">{it.service.title}</p>
                        <StatusBadge tone="zinc" className="text-[9px]">
                          {QUOTE_ITEM_STATUS_LABELS[itemStatus] ?? it.status}
                        </StatusBadge>
                      </div>
                      <p className="text-muted-foreground text-[11px] font-medium tabular-nums">
                        {it.quantity} {unitStr} ·{" "}
                        {it.price != null
                          ? `${formatBRL(it.price)} / ${unitStr}`
                          : "Aguardando preço do prestador"}
                      </p>
                      <p className="text-muted-foreground line-clamp-2 text-[11px] leading-relaxed">
                        {it.description}
                      </p>
                      {it.providerNote ? (
                        <div className="space-y-1 pt-0.5">
                          {(() => {
                            const breakdown = parseTransparentQuoteNote(it.providerNote)
                            const cleanNote = it.providerNote
                              .replace(/\[ORCAMENTO_TRANSPARENTE:.*?:ORCAMENTO_TRANSPARENTE\]/g, "")
                              .trim()

                            return (
                              <>
                                {breakdown ? (
                                  <div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        triggerHaptic("selection")
                                        onViewBreakdown?.({
                                          title: it.service.title,
                                          category: it.service.title,
                                          breakdown,
                                        })
                                      }}
                                      className="h-7 gap-1.5 rounded-lg border-blue-300 bg-blue-50/60 px-2 text-xs font-semibold text-blue-700 shadow-2xs hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                    >
                                      <Package className="size-3 text-blue-600 dark:text-blue-400" />
                                      Ver Mão de Obra vs Materiais ({formatBRL(breakdown.laborCost)}{" "}
                                      + {formatBRL(breakdown.materialsCost)})
                                    </Button>
                                  </div>
                                ) : null}
                                {cleanNote ? (
                                  <p className="bg-background/80 border-border/40 text-muted-foreground rounded-lg border p-2 text-[11px] leading-relaxed">
                                    <strong className="text-foreground">Nota do prestador:</strong>{" "}
                                    {cleanNote}
                                  </p>
                                ) : null}
                              </>
                            )
                          })()}
                        </div>
                      ) : null}
                    </div>

                    <div className="self-start text-right text-xs">
                      {subtotal != null ? (
                        <>
                          <p className="text-muted-foreground text-[10px] font-medium">Subtotal</p>
                          <p className="text-foreground font-bold tabular-nums">
                            {formatBRL(subtotal)}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        {/* Actions Bar */}
        <div className="border-border/40 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
          {status === "APPROVED" && onSchedule && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onSchedule()
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 gap-1.5 rounded-xl text-xs font-semibold shadow-2xs transition-all active:scale-95 sm:h-8"
            >
              <CalendarDays className="size-3.5" />
              Agendar Atendimento
            </Button>
          )}

          {canApprove && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onApprove()
              }}
              disabled={isApproving}
              className="h-10 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
            >
              {isApproving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Aprovar orçamento
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onViewProvider()
            }}
            className="border-border/60 hover:bg-muted/60 h-8.5 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-8"
          >
            <MapPin className="text-primary size-3.5" />
            Ver prestador
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="border-border/60 hover:bg-muted/60 h-8.5 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-8"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
            Mensagem
          </Button>

          {canReject && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onReject()
              }}
              disabled={isRejecting}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto h-8.5 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-8"
            >
              {isRejecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Rejeitar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
