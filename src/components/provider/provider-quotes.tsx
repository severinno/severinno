"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  Send,
  Wrench,
} from "lucide-react"

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
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"
import ProviderMiniMap from "@/components/shared/provider-mini-map"

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

type Tab =
  | "PENDING"
  | "RESPONDED"
  | "APPROVED"
  | "REJECTED"
  | "all"

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
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  RESPONDED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  EXPIRED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
}

const ITEM_BADGE_STYLES: Record<QuoteItemStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  QUOTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  ACCEPTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
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
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
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
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
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
// Item card
// ---------------------------------------------------------------------------

function QuoteItemCard({ item }: { item: QuoteItem }) {
  const qc = useQueryClient()
  const [price, setPrice] = React.useState<string>(
    item.price != null ? String(item.price) : "",
  )
  const [note, setNote] = React.useState<string>(item.providerNote ?? "")
  const [sending, setSending] = React.useState(false)

  const respond = async () => {
    const num = Number(price)
    if (!Number.isFinite(num) || num < 0) {
      toast.error("Informe um preço válido.")
      return
    }
    setSending(true)
    try {
      await apiPatch(
        `/api/quotes/${item.requestId}/items/${item.id}`,
        {
          price: num,
          providerNote: note || "",
          status: "QUOTED",
        },
      )
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
    <div className="grid gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-medium">{item.service.title}</p>
          </div>
          {item.description && (
            <p className="mt-1 text-xs text-muted-foreground">
              {item.description}
            </p>
          )}
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Quantidade:</span>{" "}
            <span className="font-medium">
              {item.quantity} {item.unit}
            </span>
          </p>
          {item.photos && item.photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.photos.map((p, i) => (
                <img
                  key={i}
                  src={p}
                  alt={`Foto ${i + 1}`}
                  className="size-12 rounded border object-cover"
                />
              ))}
            </div>
          )}
        </div>
        <ItemStatusBadge status={item.status} />
      </div>

      {item.status === "PENDING" ? (
        <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-semibold text-primary">
            Responder orçamento
          </p>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-start">
            <div>
              <label className="text-xs text-muted-foreground">
                Preço (R$)
              </label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Nota para o cliente (opcional)
              </label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: Material incluso. Válido por 7 dias."
                maxLength={500}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={respond}
              disabled={sending || !price}
              className="gap-1.5"
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Enviar orçamento
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-1 rounded-lg bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Preço enviado</span>
            <span className="font-semibold tabular-nums text-primary">
              {item.price != null ? formatBRL(item.price) : "—"}
            </span>
          </div>
          {item.providerNote && (
            <div className="mt-1 border-t pt-2">
              <p className="text-xs text-muted-foreground">Sua nota:</p>
              <p className="text-sm">{item.providerNote}</p>
            </div>
          )}
        </div>
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

  return (
    <Card
      className={cn(
        "overflow-hidden py-0",
        urgent && "border-amber-300 ring-1 ring-amber-300/50 dark:border-amber-700 dark:ring-amber-700/30",
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="border-b bg-muted/30 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar className="size-10 border">
              {request.client.avatarUrl ? (
                <AvatarImage
                  src={request.client.avatarUrl}
                  alt={request.client.name}
                />
              ) : null}
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                {initials(request.client.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {request.client.name}
              </p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                Solicitado em {formatDateTime(request.createdAt)}
              </p>
            </div>
            {urgent && (
              <Badge className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                <AlertTriangle className="size-3" /> Urgente
              </Badge>
            )}
            {pendingItems.length > 0 && (
              <Badge className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                {pendingItems.length} pendente{pendingItems.length === 1 ? "" : "s"}
              </Badge>
            )}
            <QuoteStatusBadge status={request.status} />
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                {open ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-3 p-4">
            <div className="grid gap-2 rounded-lg border p-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Endereço</p>
                  <p className="font-medium">{request.address}</p>
                  <p className="text-xs text-muted-foreground">
                    CEP: {request.cep}
                  </p>
                </div>
              </div>
              {Number.isFinite(request.lat) &&
              Number.isFinite(request.lng) &&
              !(request.lat === 0 && request.lng === 0) ? (
                <ProviderMiniMap
                  providerLat={request.lat}
                  providerLng={request.lng}
                  providerName={request.address || "Endereço do serviço"}
                  height={160}
                  className="mt-1 border-0"
                />
              ) : null}
            </div>

            <div className="grid gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Itens ({request.items.length})
              </p>
              {request.items.map((item) => (
                <QuoteItemCard key={item.id} item={item} />
              ))}
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate("provider.messages", { peerId: request.clientId })
                }
                className="gap-1.5"
              >
                <MessageSquare className="size-3.5" /> Enviar mensagem ao cliente
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

  const query = useQuery<{ items: QuoteRequest[]; total: number }>({
    queryKey: ["provider", "quotes", "all"],
    queryFn: async () =>
      apiGet("/api/quotes", {
        role: "PROVIDER",
        page: 1,
        limit: 200,
      }),
  })

  const requests = query.data?.items ?? []

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
    <div className="grid gap-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="w-full overflow-x-auto sm:w-auto">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex-1 gap-1.5 sm:flex-none"
            >
              {t.label}
              {counts[t.value] > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary tabular-nums">
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
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border bg-muted/30"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FileText className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">Nenhum orçamento aqui</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando um cliente solicitar um orçamento, ele aparecerá aqui.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => (
            <QuoteRequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  )
}

export default ProviderQuotes
