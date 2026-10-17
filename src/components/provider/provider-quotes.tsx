"use client"

import * as React from "react"
import Image from "next/image"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Hourglass,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  Send,
  TrendingUp,
  Wrench,
} from "lucide-react"

import { TransparentQuoteModal } from "@/components/shared/transparent-quote-modal"
import {
  formatTransparentQuoteNote,
  parseTransparentQuoteNote,
  type TransparentQuoteBreakdown,
} from "@/lib/materials-breakdown"

import { apiGet, apiPatch } from "@/lib/api"
import {
  QUOTE_STATUS_LABELS,
  QUOTE_ITEM_STATUS_LABELS,
  type QuoteStatus,
  type QuoteItemStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuoteItem = {
  id: string
  requestId: string
  providerId: string
  serviceId: string
  description: string
  quantity: number
  unit: ServiceUnit
  photos: string[]
  price: number | null
  providerNote: string | null
  status: QuoteItemStatus
  createdAt: string
  service: {
    id: string
    title: string
    basePrice: number
    unit: string
  }
  provider: {
    id: string
    name: string
    avatarUrl?: string | null
  }
}

type QuoteRequest = {
  id: string
  clientId: string
  providerId: string
  status: QuoteStatus
  address: string
  cep: string
  lat: number
  lng: number
  expiresAt: string
  createdAt: string
  updatedAt: string
  client: {
    id: string
    name: string
    avatarUrl?: string | null
  }
  items: QuoteItem[]
}

type Tab = "PENDING" | "RESPONDED" | "APPROVED" | "REJECTED" | "all"

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "PENDING", label: "Pendentes" },
  { value: "RESPONDED", label: "Respondidos" },
  { value: "APPROVED", label: "Aprovados" },
  { value: "REJECTED", label: "Rejeitados" },
  { value: "all", label: "Todos" },
]

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

const QUOTE_BADGE_STYLES: Record<QuoteStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border-amber-200/50",
  RESPONDED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-blue-200/50",
  APPROVED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border-emerald-200/50",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border-rose-200/50",
  EXPIRED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 border-zinc-200/50",
}

const ITEM_BADGE_STYLES: Record<QuoteItemStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border-amber-200/50",
  QUOTED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-blue-200/50",
  ACCEPTED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border-emerald-200/50",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border-rose-200/50",
}

function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const Icon =
    status === "APPROVED"
      ? CheckCircle2
      : status === "REJECTED" || status === "EXPIRED"
        ? AlertTriangle
        : Clock
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        QUOTE_BADGE_STYLES[status],
      )}
    >
      <Icon className="size-3" />
      {QUOTE_STATUS_LABELS[status]}
    </Badge>
  )
}

function ItemStatusBadge({ status }: { status: QuoteItemStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        ITEM_BADGE_STYLES[status],
      )}
    >
      {QUOTE_ITEM_STATUS_LABELS[status]}
    </Badge>
  )
}

const URGENT_HOURS = 24

function isUrgent(createdAt: string, status: QuoteStatus): boolean {
  if (status !== "PENDING") return false
  const created = new Date(createdAt).getTime()
  const ageHours = (Date.now() - created) / (1000 * 60 * 60)
  return ageHours >= URGENT_HOURS
}

// ---------------------------------------------------------------------------
// Item card with Interactive Net Calculator (Nielsen #5 & #2)
// ---------------------------------------------------------------------------

function QuoteItemCard({ item, clientName }: { item: QuoteItem; clientName?: string }) {
  const qc = useQueryClient()
  const [price, setPrice] = React.useState<string>(item.price != null ? String(item.price) : "")
  const [note, setNote] = React.useState<string>(item.providerNote ?? "")
  const [sending, setSending] = React.useState(false)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [breakdownModalOpen, setBreakdownModalOpen] = React.useState(false)
  const [breakdown, setBreakdown] = React.useState<TransparentQuoteBreakdown | null>(() =>
    parseTransparentQuoteNote(item.providerNote),
  )

  const numPrice = Number(price) || 0
  const platformFee = numPrice * 0.12
  const netEarnings = Math.max(0, numPrice - platformFee)

  const respond = async () => {
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      toast.error("Informe um preço válido maior que zero.")
      return
    }
    setSending(true)
    try {
      await apiPatch(`/api/quotes/${item.requestId}/items/${item.id}`, {
        price: numPrice,
        providerNote: note || "",
        status: "QUOTED",
      })
      toast.success("Orçamento enviado ao cliente.")
      qc.invalidateQueries({ queryKey: ["provider", "quotes"] })
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao enviar orçamento.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-card space-y-3 rounded-xl border p-4 shadow-2xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
              <Wrench className="size-3.5" />
            </div>
            <p className="text-foreground truncate text-sm font-semibold">{item.service.title}</p>
          </div>
          {item.description && (
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{item.description}</p>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Demanda solicitada:</span>
            <span className="text-foreground font-semibold">
              {item.quantity} {item.unit}
            </span>
          </div>
          {item.photos && item.photos.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {item.photos.map((p, i) => (
                <Image
                  key={i}
                  src={p}
                  alt={`Foto anexa ${i + 1}`}
                  width={52}
                  height={52}
                  className="rounded-lg border object-cover shadow-xs"
                />
              ))}
            </div>
          )}
        </div>
        <ItemStatusBadge status={item.status} />
      </div>

      {item.status === "PENDING" ? (
        <div className="border-primary/25 bg-primary/5 space-y-3 rounded-xl border p-4">
          <div className="border-primary/15 flex flex-wrap items-center justify-between gap-2 border-b pb-1">
            <div className="flex items-center gap-1.5">
              <Calculator className="text-primary size-4" />
              <p className="text-primary text-xs font-bold">Compor Proposta Comercial</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBreakdownModalOpen(true)}
              className="h-7 gap-1.5 border-blue-300 bg-blue-50/50 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
            >
              <Package className="size-3.5 text-blue-600" />
              {breakdown
                ? "Mão de Obra + Materiais (Configurado)"
                : "Discriminar Mão de Obra e Materiais (GV)"}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-start">
            <div className="space-y-1">
              <label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Valor Total (R$)
              </label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0,00"
                className="h-9 text-xs font-semibold tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Condições & Prazo (opcional)
              </label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: Material de primeira linha incluso. Atendimento em até 48h úteis."
                maxLength={500}
                className="resize-none text-xs"
              />
            </div>
          </div>

          {/* Calculadora em Tempo Real: Previsão Líquida no Bolso */}
          {numPrice > 0 && (
            <div className="bg-background/80 grid grid-cols-1 gap-2 rounded-lg border p-2.5 text-xs sm:grid-cols-3">
              <div>
                <span className="text-muted-foreground block text-[10px]">Valor Bruto</span>
                <span className="text-foreground font-semibold">{formatBRL(numPrice)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">
                  Taxa Severinno (12%)
                </span>
                <span className="text-muted-foreground font-medium">-{formatBRL(platformFee)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Líquido no Bolso
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {formatBRL(netEarnings)}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              disabled={!numPrice}
              className="text-muted-foreground hover:text-foreground h-8 gap-1.5 text-xs"
            >
              <Eye className="size-3.5" /> Pré-visualizar
            </Button>

            <Button
              size="sm"
              onClick={respond}
              disabled={sending || !price || numPrice <= 0}
              className="h-8 gap-1.5 px-4 text-xs font-semibold shadow-xs"
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Enviar Proposta
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-muted/20 space-y-2 rounded-xl border p-3.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-medium">Preço Enviado na Proposta</span>
            <span className="text-primary text-base font-bold tabular-nums">
              {item.price != null ? formatBRL(item.price) : "—"}
            </span>
          </div>
          {breakdown && (
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-muted-foreground text-[11px]">
                Discriminação Mão de Obra vs Materiais:
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBreakdownModalOpen(true)}
                className="h-6 gap-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
              >
                <Package className="size-3" />
                Ver Detalhes ({formatBRL(breakdown.laborCost)} +{" "}
                {formatBRL(breakdown.materialsCost)})
              </Button>
            </div>
          )}
          {item.providerNote && (
            <div className="border-t pt-2">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Sua Nota ao Cliente:
              </p>
              <p className="text-foreground mt-0.5 leading-relaxed">{item.providerNote}</p>
            </div>
          )}
        </div>
      )}

      {/* Modal de Pré-visualização da Proposta (Nielsen #5: Prevenção de erros) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Eye className="text-primary size-4" />
              <span>
                Como {clientName ? clientName.split(" ")[0] : "o cliente"} verá sua proposta
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Confira os valores e a apresentação antes de disparar a proposta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="bg-card space-y-2 rounded-xl border p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-foreground text-sm font-semibold">{item.service.title}</span>
                <span className="text-primary text-base font-bold">{formatBRL(numPrice)}</span>
              </div>
              {item.description && (
                <p className="text-muted-foreground text-[11px]">{item.description}</p>
              )}
              {breakdown && (
                <div className="bg-muted/40 space-y-1 rounded-lg p-2.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mão de obra:</span>
                    <span className="font-medium">{formatBRL(breakdown.laborCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Materiais:</span>
                    <span className="font-medium">{formatBRL(breakdown.materialsCost)}</span>
                  </div>
                </div>
              )}
              {note && (
                <div className="mt-2 border-t pt-2">
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                    Observações do prestador:
                  </p>
                  <p className="text-foreground mt-0.5 text-xs italic">“{note}”</p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(false)}
              className="text-xs"
            >
              Voltar e Ajustar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setPreviewOpen(false)
                respond()
              }}
              className="gap-1.5 text-xs font-semibold"
            >
              <Send className="size-3.5" /> Confirmar e Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transparent Quote Modal */}
      {breakdownModalOpen && (
        <TransparentQuoteModal
          open={breakdownModalOpen}
          onOpenChange={setBreakdownModalOpen}
          mode={item.status === "PENDING" ? "compose" : "view"}
          serviceTitle={item.service.title}
          initialBreakdown={breakdown}
          onSave={(bd, total) => {
            setBreakdown(bd)
            setPrice(total.toFixed(2))
            setNote((prev) =>
              formatTransparentQuoteNote(
                bd,
                prev.replace(/\[ORCAMENTO_TRANSPARENTE:.*?:ORCAMENTO_TRANSPARENTE\]/g, "").trim(),
              ),
            )
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quote request card (expandable)
// ---------------------------------------------------------------------------

function QuoteRequestCard({ request }: { request: QuoteRequest }) {
  const navigate = useViewStore((s) => s.navigate)
  const [open, setOpen] = React.useState(true)

  const pendingItems = request.items.filter((i) => i.status === "PENDING")
  const urgent = isUrgent(request.createdAt, request.status)
  const encodedAddress = encodeURIComponent(request.address)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
  const wazeUrl = `https://waze.com/ul?q=${encodedAddress}&navigate=yes`

  return (
    <Card
      className={cn(
        "bg-card overflow-hidden rounded-2xl border shadow-xs transition-all",
        urgent && "border-amber-300 ring-2 ring-amber-300/40 dark:border-amber-700",
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="bg-muted/30 border-b p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar className="size-10 border shadow-xs">
              {request.client.avatarUrl ? (
                <AvatarImage src={request.client.avatarUrl} alt={request.client.name} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials(request.client.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-foreground truncate text-sm font-semibold">
                  {request.client.name}
                </p>
                {urgent && (
                  <Badge className="bg-amber-100 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    <AlertTriangle className="mr-0.5 size-3" /> Urgente (+24h)
                  </Badge>
                )}
                {pendingItems.length > 0 && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 text-[10px] font-semibold text-amber-700"
                  >
                    {pendingItems.length}{" "}
                    {pendingItems.length === 1 ? "item pendente" : "itens pendentes"}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                Solicitado em {formatDateTime(request.createdAt)}
              </p>
            </div>

            <QuoteStatusBadge status={request.status} />

            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg"
                aria-label="Expandir ou recolher"
              >
                {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="grid gap-4 p-4">
            {/* Endereço & Rotas */}
            <div className="bg-muted/15 space-y-2 rounded-xl border p-3.5 text-xs">
              <div className="flex items-start gap-2.5">
                <MapPin className="text-primary mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    Local do Serviço
                  </p>
                  <p className="text-foreground mt-0.5 font-semibold">{request.address}</p>
                  <p className="text-muted-foreground text-[11px]">CEP: {request.cep}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="text-muted-foreground hover:text-foreground h-7 text-xs"
                >
                  <a href={googleMapsUrl} target="_blank" rel="noreferrer">
                    <Navigation className="mr-1 size-3 text-blue-500" /> Google Maps
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="text-muted-foreground hover:text-foreground h-7 text-xs"
                >
                  <a href={wazeUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 size-3 text-cyan-500" /> Waze
                  </a>
                </Button>
              </div>
            </div>

            {/* Itens do Pedido */}
            <div className="space-y-2.5">
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Serviços Solicitados ({request.items.length})
              </p>
              {request.items.map((item) => (
                <QuoteItemCard key={item.id} item={item} clientName={request.client.name} />
              ))}
            </div>

            <div className="flex justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("provider.messages", { peerId: request.clientId })}
                className="gap-1.5 text-xs font-medium"
              >
                <MessageSquare className="size-3.5 text-blue-500" /> Conversar com{" "}
                {request.client.name.split(" ")[0]}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderQuotes() {
  const [tab, setTab] = React.useState<Tab>("PENDING")
  const navigate = useViewStore((s) => s.navigate)

  const query = useQuery<{ items: QuoteRequest[]; total: number }>({
    queryKey: ["provider", "quotes", "all"],
    queryFn: async () =>
      apiGet("/api/quotes", {
        role: "PROVIDER",
        page: 1,
        limit: 200,
      }),
  })

  const requests = React.useMemo(() => query.data?.items ?? [], [query.data?.items])

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {
      PENDING: 0,
      RESPONDED: 0,
      APPROVED: 0,
      REJECTED: 0,
      all: requests.length,
    }
    for (const r of requests) {
      c[r.status] = (c[r.status] ?? 0) + 1
    }
    return c
  }, [requests])

  const filtered = React.useMemo(() => {
    if (tab === "all") return requests
    return requests.filter((r) => r.status === tab)
  }, [requests, tab])

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Orçamentos & Propostas
          </h2>
          <p className="text-muted-foreground text-xs">
            Responda solicitações de clientes em Governador Valadares com cálculo de margem e
            discriminação transparente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="px-2.5 py-1 text-xs font-semibold">
            {requests.length} {requests.length === 1 ? "solicitação" : "solicitações"} no total
          </Badge>
          {counts.PENDING > 0 && (
            <Badge className="border-amber-300 bg-amber-500/10 text-xs font-semibold text-amber-700 dark:text-amber-400">
              {counts.PENDING} pendente{counts.PENDING === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </div>

      {/* Pipeline Strip / Métricas Rápidas (Nielsen #1: Visibilidade do estado do sistema) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <button
          type="button"
          onClick={() => setTab("PENDING")}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none",
            tab === "PENDING"
              ? "border-amber-500/60 bg-amber-500/5 shadow-xs ring-1 ring-amber-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Aguardando Resposta</span>
            <Hourglass className="size-4 text-amber-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {counts.PENDING}
          </span>
          <span className="text-muted-foreground text-[10px]">Envie seu preço</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("RESPONDED")}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none",
            tab === "RESPONDED"
              ? "border-blue-500/60 bg-blue-500/5 shadow-xs ring-1 ring-blue-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Propostas Enviadas</span>
            <Send className="size-4 text-blue-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {counts.RESPONDED}
          </span>
          <span className="text-muted-foreground text-[10px]">Sob análise do cliente</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("APPROVED")}
          className={cn(
            "hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none",
            tab === "APPROVED"
              ? "border-emerald-500/60 bg-emerald-500/5 shadow-xs ring-1 ring-emerald-500/20"
              : "bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Aprovados / Fechados</span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {counts.APPROVED}
          </span>
          <span className="text-muted-foreground text-[10px]">Convertidos em serviço</span>
        </button>

        <div className="bg-card flex flex-col gap-1 rounded-xl border p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Taxa de Aceite</span>
            <TrendingUp className="text-primary size-4" />
          </div>
          <span className="text-foreground text-2xl font-bold tracking-tight">
            {counts.APPROVED + counts.RESPONDED > 0
              ? `${Math.round((counts.APPROVED / (counts.APPROVED + counts.REJECTED || 1)) * 100)}%`
              : "100%"}
          </span>
          <span className="text-muted-foreground text-[10px]">Eficiência comercial</span>
        </div>
      </div>

      {/* Toolbar: Tabs de Status */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="bg-muted/60 w-full justify-start overflow-x-auto p-1 sm:w-auto">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex-1 gap-1.5 text-xs sm:flex-none"
            >
              {t.label}
              {counts[t.value] > 0 && (
                <span className="bg-primary/15 text-primary ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
                  {counts[t.value]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {query.isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/20 h-32 animate-pulse rounded-2xl border" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-muted/10 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
            <FileText className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-foreground text-sm font-semibold">
              {tab === "all"
                ? "Nenhum orçamento recebido"
                : `Nenhum orçamento em "${TABS.find((t) => t.value === tab)?.label}"`}
            </p>
            <p className="text-muted-foreground max-w-sm text-xs">
              {requests.length > 0
                ? `Você possui ${requests.length} solicitação(ões) em outras etapas do painel.`
                : "Quando clientes em Governador Valadares solicitarem orçamentos personalizados, eles aparecerão aqui com fotos e detalhes."}
            </p>
          </div>
          {requests.length > 0 && tab !== "all" ? (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setTab("all")} className="text-xs">
                Ver todos ({requests.length})
              </Button>
              {counts.PENDING > 0 && tab !== "PENDING" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setTab("PENDING")}
                  className="text-xs"
                >
                  Ver pendentes ({counts.PENDING})
                </Button>
              )}
              {counts.APPROVED > 0 && tab !== "APPROVED" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTab("APPROVED")}
                  className="text-xs"
                >
                  Ver aprovados ({counts.APPROVED})
                </Button>
              )}
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("provider.services")}
                className="gap-1.5 text-xs"
              >
                <Wrench className="size-3.5" />
                Gerenciar catálogo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("provider.expediente")}
                className="gap-1.5 text-xs"
              >
                <Clock className="size-3.5" />
                Configurar expediente
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((r) => (
            <QuoteRequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  )
}

export default ProviderQuotes
