"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Scale,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  Loader2,
  DollarSign,
  User,
  HardHat,
  ShieldCheck,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { apiGet, apiPost } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"

type DisputeItem = {
  id: string
  bookingId: string
  reason: string
  status: "OPEN" | "RESOLVED" | "REJECTED"
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
  openDays: number
  booking: {
    id: string
    amount: number
    status: string
    paymentStatus: string
    scheduledAt: string
    createdAt: string
    beforePhotos?: string[]
    afterPhotos?: string[]
    completionNote?: string | null
    escrowDisputeReason?: string | null
    client: {
      id: string
      name: string
      email: string
      whatsapp?: string | null
      avatarUrl?: string | null
    }
    provider: {
      id: string
      name: string
      email: string
      whatsapp?: string | null
      avatarUrl?: string | null
    }
    service: {
      id: string
      title: string
    }
  }
}

type DisputesResponse = {
  items: DisputeItem[]
  meta: {
    total: number
    open: number
    totalAmountInDispute: number
  }
}

type MediationRecommendation = {
  bookingId: string
  verdict: "FULL_REFUND" | "PARTIAL_REFUND" | "REDO_SERVICE" | "NO_REFUND" | "SPLIT_DECISION"
  confidence: number
  refundPercentage: number
  refundAmount: number
  providerPayout: number
  reasoning: string
  suggestedActions: string[]
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  source: string
}

export function AdminDisputes() {
  const qc = useQueryClient()
  const [filter, setFilter] = React.useState<"OPEN" | "RESOLVED" | "ALL">("OPEN")
  const [selectedDispute, setSelectedDispute] = React.useState<DisputeItem | null>(null)
  const [resolveDialogOpen, setResolveDialogOpen] = React.useState(false)

  // Decisão
  const [decision, setDecision] = React.useState<"FULL_REFUND" | "RELEASE_TO_PROVIDER" | "SPLIT">(
    "FULL_REFUND",
  )
  const [splitPct, setSplitPct] = React.useState(50)
  const [notes, setNotes] = React.useState("")

  const { data, isLoading } = useQuery<DisputesResponse>({
    queryKey: ["admin", "disputes", filter],
    queryFn: () => apiGet<DisputesResponse>(`/api/admin/disputes?status=${filter}`),
  })

  // Consulta IA / motor de mediação
  const aiMediationMutation = useMutation({
    mutationFn: (dispute: DisputeItem) =>
      apiPost<{ success: boolean; data: MediationRecommendation }>("/api/admin/disputes/mediate", {
        bookingId: dispute.bookingId,
        clientId: dispute.booking.client.id,
        clientName: dispute.booking.client.name,
        providerId: dispute.booking.provider.id,
        providerName: dispute.booking.provider.name,
        serviceTitle: dispute.booking.service.title,
        serviceDescription: dispute.booking.service.title,
        totalAmount: dispute.booking.amount,
        clientComplaint: dispute.reason,
        providerResponse: dispute.booking.completionNote || "",
        chatMessageCount: 12,
        hasBeforePhotos: !!(
          dispute.booking.beforePhotos && dispute.booking.beforePhotos.length > 0
        ),
        hasAfterPhotos: !!(dispute.booking.afterPhotos && dispute.booking.afterPhotos.length > 0),
        providerRating: 4.8,
        providerCompletedJobs: 34,
        providerDisputeRate: 0.02,
      }),
    onSuccess: (res) => {
      triggerHaptic("success")
      if (res.data) {
        if (res.data.verdict === "FULL_REFUND") {
          setDecision("FULL_REFUND")
        } else if (res.data.verdict === "NO_REFUND") {
          setDecision("RELEASE_TO_PROVIDER")
        } else {
          setDecision("SPLIT")
          setSplitPct(res.data.refundPercentage)
        }
        setNotes(res.data.reasoning)
        setResolveDialogOpen(true)
        toast.success("Recomendação da IA aplicada ao formulário de arbitragem!")
      }
    },
    onError: () => {
      triggerHaptic("error")
      toast.error("Falha ao consultar recomendação do mediador.")
    },
  })

  // Executar decisão
  const resolveMutation = useMutation({
    mutationFn: ({
      disputeId,
      body,
    }: {
      disputeId: string
      body: {
        decision: string
        refundPercentage?: number
        resolutionNotes: string
      }
    }) => apiPost(`/api/admin/disputes/${disputeId}/resolve`, body),
    onSuccess: () => {
      triggerHaptic("success")
      toast.success("Disputa resolvida e custódia liquidada com sucesso!")
      setResolveDialogOpen(false)
      setSelectedDispute(null)
      qc.invalidateQueries({ queryKey: ["admin", "disputes"] })
    },
    onError: (err: { message?: string }) => {
      triggerHaptic("error")
      toast.error(err.message || "Erro ao aplicar resolução da disputa.")
    },
  })

  const handleOpenResolve = (dispute: DisputeItem) => {
    setSelectedDispute(dispute)
    setDecision("FULL_REFUND")
    setSplitPct(50)
    setNotes("")
    setResolveDialogOpen(true)
  }

  const handleApplyResolution = () => {
    if (!selectedDispute) return
    if (!notes.trim()) {
      toast.error("Informe a justificativa do veredito.")
      return
    }

    resolveMutation.mutate({
      disputeId: selectedDispute.id,
      body: {
        decision,
        refundPercentage: decision === "SPLIT" ? splitPct : undefined,
        resolutionNotes: notes.trim(),
      },
    })
  }

  const items = data?.items || []
  const meta = data?.meta || { total: 0, open: 0, totalAmountInDispute: 0 }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Scale className="text-primary size-7" /> Mediação & Disputas de Escrow
          </h2>
          <p className="text-muted-foreground text-sm">
            Arbitragem de conflitos, retenção de custódia e garantia de serviço Severinno.
          </p>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="OPEN" className="gap-1.5">
              Em Aberto
              {meta.open > 0 && (
                <span className="bg-destructive text-destructive-foreground py-0.2 ml-1 rounded-full px-1.5 text-[10px] font-bold">
                  {meta.open}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="RESOLVED">Resolvidas</TabsTrigger>
            <TabsTrigger value="ALL">Todas ({meta.total})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Casos em Aberto</CardTitle>
            <AlertTriangle className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{meta.open}</div>
            <p className="text-muted-foreground text-xs">Aguardando parecer de mediação</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Saldo Retido em Custódia</CardTitle>
            <DollarSign className="size-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBRL(meta.totalAmountInDispute)}</div>
            <p className="text-muted-foreground text-xs">Bloqueado para liberação após disputa</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Resolução</CardTitle>
            <ShieldCheck className="text-primary size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {meta.total > 0
                ? `${(((meta.total - meta.open) / meta.total) * 100).toFixed(0)}%`
                : "100%"}
            </div>
            <p className="text-muted-foreground text-xs">Casos encerrados com parecer emitido</p>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Disputas */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="text-primary size-8 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-500/70" />
          <h3 className="mt-4 text-lg font-semibold">Nenhuma disputa encontrada</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {filter === "OPEN"
              ? "Excelente! Não há transações pendentes de mediação no momento."
              : "Nenhum registro para o filtro selecionado."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((dispute) => (
            <Card key={dispute.id} className="transition-all hover:shadow-md">
              <CardContent className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  {/* Informações Centrais */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground font-semibold">
                        {dispute.booking.service.title}
                      </span>
                      <span className="text-muted-foreground text-xs">•</span>
                      <span className="text-muted-foreground text-xs">
                        Agendamento #{dispute.bookingId.slice(-6)}
                      </span>
                      {dispute.status === "OPEN" ? (
                        <Badge variant="destructive" className="gap-1 text-[10px] font-semibold">
                          <Clock className="size-3" /> Em Aberto ({dispute.openDays}d)
                        </Badge>
                      ) : (
                        <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 size-3" /> Resolvido
                        </Badge>
                      )}
                      <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 text-xs font-bold">
                        {formatBRL(dispute.booking.amount)}
                      </span>
                    </div>

                    {/* Queixa */}
                    <div className="bg-muted/40 rounded-lg p-3 text-sm">
                      <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wider uppercase">
                        Motivo da Contestação pelo Cliente:
                      </p>
                      <p className="text-foreground italic">"{dispute.reason}"</p>
                    </div>

                    {/* Parecer se já resolvido */}
                    {dispute.resolution && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                        <span className="font-semibold">Parecer do Mediador:</span>{" "}
                        {dispute.resolution}
                      </div>
                    )}

                    {/* Partes */}
                    <div className="text-muted-foreground flex flex-wrap items-center gap-4 pt-1 text-xs">
                      <span className="flex items-center gap-1.5">
                        <User className="size-3.5 text-blue-500" />
                        Cliente: <strong>{dispute.booking.client.name}</strong>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1.5">
                        <HardHat className="size-3.5 text-amber-500" />
                        Prestador: <strong>{dispute.booking.provider.name}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Ações */}
                  {dispute.status === "OPEN" && (
                    <div className="flex shrink-0 flex-row gap-2 lg:flex-col">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedDispute(dispute)
                          aiMediationMutation.mutate(dispute)
                        }}
                        disabled={aiMediationMutation.isPending}
                        className="gap-1.5 border-purple-500/30 text-xs text-purple-600 hover:bg-purple-500/10 dark:text-purple-400"
                      >
                        <Sparkles className="size-3.5" />
                        {aiMediationMutation.isPending ? "Analisando..." : "Sugerir com IA"}
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => handleOpenResolve(dispute)}
                        className="bg-primary gap-1.5 text-xs"
                      >
                        <Scale className="size-3.5" />
                        Arbitrar Decisão
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de Arbitragem */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="text-primary size-5" /> Arbitragem de Disputa & Custódia
            </DialogTitle>
            <DialogDescription>
              Selecione o veredito para liberar a custódia ou estornar o valor de{" "}
              <strong>{selectedDispute ? formatBRL(selectedDispute.booking.amount) : ""}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Escolha da Decisão */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setDecision("FULL_REFUND")}
                className={`rounded-xl border p-3 text-center transition ${
                  decision === "FULL_REFUND"
                    ? "border-destructive bg-destructive/10 text-destructive font-semibold"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <div className="text-xs tracking-wider uppercase">Estorno Total</div>
                <div className="mt-1 text-sm font-bold">100% Cliente</div>
              </button>

              <button
                type="button"
                onClick={() => setDecision("RELEASE_TO_PROVIDER")}
                className={`rounded-xl border p-3 text-center transition ${
                  decision === "RELEASE_TO_PROVIDER"
                    ? "border-emerald-500 bg-emerald-500/10 font-semibold text-emerald-600"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <div className="text-xs tracking-wider uppercase">Liberação Total</div>
                <div className="mt-1 text-sm font-bold">100% Prestador</div>
              </button>

              <button
                type="button"
                onClick={() => setDecision("SPLIT")}
                className={`rounded-xl border p-3 text-center transition ${
                  decision === "SPLIT"
                    ? "border-amber-500 bg-amber-500/10 font-semibold text-amber-600"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <div className="text-xs tracking-wider uppercase">Acordo Split</div>
                <div className="mt-1 text-sm font-bold">Divisão Parcial</div>
              </button>
            </div>

            {/* Slider de Split se aplicável */}
            {decision === "SPLIT" && selectedDispute && (
              <div className="bg-muted/40 space-y-2 rounded-xl p-3">
                <div className="flex justify-between text-xs">
                  <span>
                    Cliente: <strong>{splitPct}%</strong> (
                    {formatBRL((selectedDispute.booking.amount * splitPct) / 100)})
                  </span>
                  <span>
                    Prestador: <strong>{100 - splitPct}%</strong> (
                    {formatBRL((selectedDispute.booking.amount * (100 - splitPct)) / 100)})
                  </span>
                </div>
                <Slider
                  min={5}
                  max={95}
                  step={5}
                  value={[splitPct]}
                  onValueChange={(val) => setSplitPct(val[0])}
                />
              </div>
            )}

            {/* Parecer */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Justificativa e Parecer da Resolução</Label>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Ex: Após análise das fotos e do diálogo no chat, determinou-se estorno parcial devido a atraso injustificado..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <p className="text-muted-foreground text-[11px]">
                Este parecer será enviado automaticamente via WhatsApp e Notificação para ambas as
                partes.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResolveDialogOpen(false)}
              disabled={resolveMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleApplyResolution}
              disabled={resolveMutation.isPending || !notes.trim()}
              className="gap-2"
            >
              {resolveMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Confirmar Resolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AdminDisputes
