"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileCheck2,
  Loader2,
  Plus,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FilePhotos } from "@/components/modals/file-photos"
import { SafeImage } from "@/components/shared/safe-image"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"
import { toast } from "sonner"
import { enqueueOfflineReport } from "@/lib/offline-reports-queue"

export interface InspectionChecklistItem {
  id: string
  label: string
  category?: string
  checked: boolean
  required?: boolean
}

export interface ServiceDeliveryReportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  serviceTitle: string
  serviceCategory?: string
  clientName?: string
  providerName?: string
  userRole?: "CLIENT" | "PROVIDER" | "ADMIN"
  initialBeforePhotos?: string[]
  initialAfterPhotos?: string[]
  initialNotes?: string
  isCompleted?: boolean
  onSuccess?: () => void
}

/** Categorias e seus templates prévios de checagem técnica */
const CATEGORY_TEMPLATES: Record<string, string[]> = {
  hidraulica: [
    "Registro geral desligado com segurança antes do início",
    "Teste de estanqueidade e ausência de vazamento sob pressão",
    "Vedações e conexões novas com fita veda-rosca conferidas",
    "Registro religado e fluxo de água devidamente normalizado",
    "Área de intervenção limpa e seca sem respingos ou poças",
  ],
  eletrica: [
    "Quadro geral desenergizado e circuito testado com multímetro",
    "Fiação devidamente dimensionada e isolamento com fita antichama",
    "Conexões em bornes e disjuntores apertadas sem folga",
    "Circuito religado e teste de carga dos equipamentos realizado",
    "Identificação de circuitos no quadro e recolhimento de sobras",
  ],
  pintura: [
    "Proteção de rodapés, pisos, tomadas e móveis com lona/fita",
    "Correção de imperfeições, trincas e lixamento prévio uniforme",
    "Demãos aplicadas com cobertura completa e sem escorrimentos",
    "Remoção cuidadosa de fitas de mascaramento e recolocação de espelhos",
    "Limpeza completa de eventuais respingos e descarte de latas/rolos",
  ],
  ar_condicionado: [
    "Vistoria do ponto elétrico e disjuntor dedicado",
    "Teste de vácuo nas tubulações e estanqueidade do gás",
    "Dreno instalado com caimento adequado e sem retorno",
    "Teste de resfriamento/aquecimento com termômetro digital",
    "Limpeza do filtro e orientação de uso do controle remoto",
  ],
  chaveiro: [
    "Alinhamento da fechadura/cilindro sem atrito contra o batente",
    "Teste de giro da chave por dentro e por fora",
    "Lubrificação de trincos e mecanismos móveis",
    "Conferência e entrega de todas as vias de chaves",
  ],
  padrao: [
    "Avaliação inicial do estado prévio do local com o cliente",
    "Execução estrita do escopo acordado e especificado",
    "Demonstração prática do funcionamento satisfatório ao cliente",
    "Apresentação das peças ou insumos substituídos (se houver)",
    "Recolhimento de ferramentas, limpeza e organização do local",
    "Esclarecimento sobre a garantia legal de 90 dias (CDC art. 26)",
  ],
}

function resolveCategoryKey(cat?: string, title?: string): string {
  const text = `${cat || ""} ${title || ""}`.toLowerCase()
  if (
    text.includes("hidr") ||
    text.includes("encan") ||
    text.includes("vazament") ||
    text.includes("pia")
  )
    return "hidraulica"
  if (
    text.includes("eletr") ||
    text.includes("fio") ||
    text.includes("tomad") ||
    text.includes("disjuntor")
  )
    return "eletrica"
  if (text.includes("pint") || text.includes("massa") || text.includes("parede")) return "pintura"
  if (text.includes("ar ") || text.includes("condicion") || text.includes("clima"))
    return "ar_condicionado"
  if (text.includes("chav") || text.includes("fechad") || text.includes("tranc")) return "chaveiro"
  return "padrao"
}

export function ServiceDeliveryReportModal({
  open,
  onOpenChange,
  bookingId,
  serviceTitle,
  serviceCategory,
  clientName = "Cliente",
  providerName = "Prestador",
  userRole: _userRole = "PROVIDER",
  initialBeforePhotos = [],
  initialAfterPhotos = [],
  initialNotes = "",
  isCompleted = false,
  onSuccess,
}: ServiceDeliveryReportModalProps) {
  const draftKey = `severinno:inspection-draft:${bookingId}`

  // Carrega rascunho de forma síncrona/lazy na inicialização
  const draft = React.useMemo(() => {
    if (typeof window === "undefined" || isCompleted) return null
    try {
      const saved = localStorage.getItem(draftKey)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  }, [draftKey, isCompleted])

  const [activeStep, setActiveStep] = React.useState<1 | 2 | 3>(isCompleted ? 3 : 1)
  const [beforePhotos, setBeforePhotos] = React.useState<string[]>(
    () => draft?.beforePhotos || initialBeforePhotos,
  )
  const [afterPhotos, setAfterPhotos] = React.useState<string[]>(
    () => draft?.afterPhotos || initialAfterPhotos,
  )
  const [notes, setNotes] = React.useState<string>(() => draft?.notes || initialNotes)
  const [customItemText, setCustomItemText] = React.useState<string>("")
  const [isSaving, setIsSaving] = React.useState<boolean>(false)
  const [isCopied, setIsCopied] = React.useState<boolean>(false)

  // Sincroniza props quando mudarem (padrão React 18/19 de ajuste em render por valor)
  const beforeKey = initialBeforePhotos.join("|")
  const [prevBeforeKey, setPrevBeforeKey] = React.useState(beforeKey)
  if (beforeKey !== prevBeforeKey) {
    setPrevBeforeKey(beforeKey)
    if (initialBeforePhotos.length > 0) {
      setBeforePhotos(initialBeforePhotos)
    }
  }

  const afterKey = initialAfterPhotos.join("|")
  const [prevAfterKey, setPrevAfterKey] = React.useState(afterKey)
  if (afterKey !== prevAfterKey) {
    setPrevAfterKey(afterKey)
    if (initialAfterPhotos.length > 0) {
      setAfterPhotos(initialAfterPhotos)
    }
  }

  const [prevNotes, setPrevNotes] = React.useState(initialNotes)
  if (initialNotes !== prevNotes) {
    setPrevNotes(initialNotes)
    if (initialNotes) {
      setNotes(initialNotes)
    }
  }

  // Inicializar checklist baseado na categoria
  const [checklist, setChecklist] = React.useState<InspectionChecklistItem[]>(() => {
    if (draft?.checklist && draft.checklist.length > 0) return draft.checklist
    const key = resolveCategoryKey(serviceCategory, serviceTitle)
    const labels = CATEGORY_TEMPLATES[key] || CATEGORY_TEMPLATES.padrao
    return labels.map((label, idx) => ({
      id: `chk-${idx}`,
      label,
      checked: isCompleted,
      required: idx < 2, // os 2 primeiros são essenciais
    }))
  })

  // Salvar rascunho em tempo real
  React.useEffect(() => {
    if (!open || isCompleted) return
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ beforePhotos, afterPhotos, notes, checklist }),
      )
    } catch {
      // localStorage pode estar cheio ou indisponível
    }
  }, [beforePhotos, afterPhotos, notes, checklist, open, draftKey, isCompleted])

  // Contadores de progresso
  const totalItems = checklist.length
  const checkedItems = checklist.filter((i) => i.checked).length
  const progressPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0
  const missingRequired = checklist.some((i) => i.required && !i.checked)

  // Gerar código único de autenticidade / hash do laudo
  const reportCode = React.useMemo(() => {
    const raw = `${bookingId}-${serviceTitle}`.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    return `LAUDO-${raw.slice(0, 6) || "SEV"}-${new Date().getFullYear()}`
  }, [bookingId, serviceTitle])

  const toggleChecklist = (id: string) => {
    triggerHaptic("selection")
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
    )
  }

  const addCustomItem = () => {
    const trimmed = customItemText.trim()
    if (!trimmed) return
    setChecklist((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        label: trimmed,
        checked: true,
        required: false,
      },
    ])
    setCustomItemText("")
    toast.success("Item personalizado adicionado ao checklist!")
  }

  const removeChecklistItem = (id: string) => {
    setChecklist((prev) => prev.filter((i) => i.id !== id))
  }

  // Salvar fotos do Antes
  const handleSaveBefore = async () => {
    if (beforePhotos.length === 0) {
      toast.error("Adicione ao menos uma foto do estado inicial (Antes).")
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "before",
          photos: beforePhotos,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao salvar vistoria inicial.")

      toast.success("Vistoria inicial registrada com sucesso!")
      setActiveStep(2)
      onSuccess?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar"
      toast.error(msg)
    } finally {
      setIsSaving(false)
    }
  }

  // Salvar laudo final e fotos do Depois
  const handleSaveComplete = async () => {
    if (afterPhotos.length === 0) {
      toast.error("Adicione ao menos uma foto do serviço concluído (Depois).")
      return
    }

    if (missingRequired) {
      toast.error("Conclua todos os itens obrigatórios do checklist técnico.")
      return
    }

    // Salvar offline se o dispositivo estiver desconectado
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOfflineReport({
        bookingId,
        serviceTitle,
        clientName,
        beforePhotos,
        afterPhotos,
        completionNote: notes,
        checklist,
      })
      try {
        localStorage.removeItem(draftKey)
      } catch {
        // no-op
      }
      toast.info(
        "📱 Laudo salvo no dispositivo! Sincronização automática assim que houver sinal de rede.",
      )
      onSuccess?.()
      onOpenChange(false)
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "after",
          photos: afterPhotos,
          completionNote: notes,
          checklist,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao emitir laudo de entrega.")

      // Limpar rascunho local
      try {
        localStorage.removeItem(draftKey)
      } catch {
        // no-op
      }

      toast.success("Laudo de Entrega e Checklist emitidos com sucesso! Zero disputas.")
      triggerHaptic("success")
      playCoinSound({ vibrate: true })
      onSuccess?.()
      onOpenChange(false)
    } catch (err: unknown) {
      // Fallback offline se a conexão caiu durante o envio
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueOfflineReport({
          bookingId,
          serviceTitle,
          clientName,
          beforePhotos,
          afterPhotos,
          completionNote: notes,
          checklist,
        })
        try {
          localStorage.removeItem(draftKey)
        } catch {
          // no-op
        }
        toast.info(
          "📱 Laudo salvo no dispositivo! Sincronização automática assim que houver sinal de rede.",
        )
        onSuccess?.()
        onOpenChange(false)
        return
      }

      const msg = err instanceof Error ? err.message : "Erro ao salvar"
      toast.error(msg)
    } finally {
      setIsSaving(false)
    }
  }

  // Compartilhar laudo no WhatsApp
  const handleShareWhatsApp = () => {
    const summary = [
      `🛡️ *LAUDO TÉCNICO DE ENTREGA — SEVERINNO*`,
      `📄 *Código:* ${reportCode}`,
      `🛠️ *Serviço:* ${serviceTitle}`,
      `👤 *Cliente:* ${clientName}`,
      `👷 *Profissional:* ${providerName}`,
      `📅 *Data:* ${new Date().toLocaleDateString("pt-BR")}`,
      ``,
      `✅ *Checklist de Conformidade (${checkedItems}/${totalItems} aprovados):*`,
      ...checklist.map((i) => `${i.checked ? "✔️" : "❌"} ${i.label}`),
      ``,
      beforePhotos.length > 0
        ? `📸 *Fotos Iniciais (Antes):* ${beforePhotos.length} registradas`
        : "",
      afterPhotos.length > 0 ? `📸 *Fotos Finais (Depois):* ${afterPhotos.length} registradas` : "",
      notes ? `📝 *Observações / Garantia:* ${notes}` : "",
      ``,
      `🔒 *Garantia Legal de 90 dias com liberação protegida por Escrow Severinno.*`,
    ]
      .filter(Boolean)
      .join("\n")

    const url = `https://wa.me/?text=${encodeURIComponent(summary)}`
    window.open(url, "_blank")
  }

  const handleCopyReport = () => {
    const summary = [
      `LAUDO TÉCNICO DE ENTREGA — SEVERINNO (${reportCode})`,
      `Serviço: ${serviceTitle}`,
      `Cliente: ${clientName} | Prestador: ${providerName}`,
      `Data: ${new Date().toLocaleDateString("pt-BR")}`,
      `\nCHECKLIST DE CONFORMIDADE:`,
      ...checklist.map((i) => `[${i.checked ? "X" : " "}] ${i.label}`),
      notes ? `\nNOTAS: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    navigator.clipboard.writeText(summary)
    setIsCopied(true)
    toast.success("Texto do laudo copiado para a área de transferência!")
    setTimeout(() => setIsCopied(false), 2500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20">
              <ClipboardCheck className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                Checklist Guiado & Laudo Fotográfico
              </DialogTitle>
              <DialogDescription className="text-xs">
                {serviceTitle} • Código de Autenticidade:{" "}
                <span className="text-foreground font-mono font-medium">{reportCode}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Stepper Visual (Jakob Nielsen Heurística #1: Visibilidade do Status) */}
        <div className="bg-muted/60 my-2 grid grid-cols-3 gap-2 rounded-xl p-1.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveStep(1)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all",
              activeStep === 1
                ? "bg-background text-foreground ring-border shadow-sm ring-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Camera className="size-3.5" />
            <span>1. Antes ({beforePhotos.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveStep(2)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all",
              activeStep === 2
                ? "bg-background text-foreground ring-border shadow-sm ring-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CheckCircle2 className="size-3.5" />
            <span>
              2. Checklist ({checkedItems}/{totalItems})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveStep(3)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 font-medium transition-all",
              activeStep === 3
                ? "bg-background text-foreground ring-border shadow-sm ring-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldCheck className="size-3.5" />
            <span>3. Laudo & Depois</span>
          </button>
        </div>

        {/* ============================================================== */}
        {/* ETAPA 1: VISTORIA INICIAL (ANTES) */}
        {/* ============================================================== */}
        {activeStep === 1 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-semibold">Prevenção de Disputas (Heurística #5)</p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    Fotografe detalhes com boa iluminação antes de começar. Avarias pré-existentes
                    ou condições do local registradas aqui protegem ambas as partes.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="text-foreground text-xs font-semibold">
                Fotos do Local / Estado Inicial (Antes)
              </label>
              <p className="text-muted-foreground mb-2 text-[11px]">
                Adicione até 4 fotos com boa visibilidade.
              </p>
              <FilePhotos
                value={beforePhotos}
                onChange={setBeforePhotos}
                max={4}
                label="Fotos do Antes"
                hint="Envie fotos de ângulos claros antes de iniciar o trabalho"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                onClick={handleSaveBefore}
                disabled={isSaving || beforePhotos.length === 0}
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                Salvar Antes e Ir para Checklist
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ETAPA 2: CHECKLIST TÉCNICO DE CONFORMIDADE */}
        {/* ============================================================== */}
        {activeStep === 2 && (
          <div className="space-y-4 py-2">
            {/* Barra de progresso */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5">
                  <ClipboardCheck className="size-3.5 text-emerald-600" />
                  Progresso do Checklist
                </span>
                <span className="font-semibold text-emerald-600">{progressPercent}% Concluído</span>
              </div>
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Lista de itens */}
            <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleChecklist(item.id)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs transition-colors",
                    item.checked
                      ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/20"
                      : "border-border bg-card hover:bg-muted/40",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                      item.checked
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-muted-foreground/40 bg-background",
                    )}
                  >
                    {item.checked && <Check className="size-3 stroke-[3]" />}
                  </div>
                  <div className="flex-1">
                    <p
                      className={cn(
                        "font-medium",
                        item.checked && "text-emerald-950 dark:text-emerald-200",
                      )}
                    >
                      {item.label}
                    </p>
                    {item.required && (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        Item essencial
                      </span>
                    )}
                  </div>
                  {!item.required && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeChecklistItem(item.id)
                      }}
                      className="text-muted-foreground hover:text-destructive p-1"
                      aria-label="Remover item"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Adicionar item customizado */}
            <div className="flex items-center gap-2 pt-1">
              <Input
                placeholder="Adicionar item técnico específico..."
                value={customItemText}
                onChange={(e) => setCustomItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addCustomItem()
                  }
                }}
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustomItem}
                disabled={!customItemText.trim()}
                className="h-8 shrink-0 gap-1 text-xs"
              >
                <Plus className="size-3.5" /> Adicionar
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setActiveStep(1)}
                className="gap-1.5 text-xs"
              >
                <ArrowLeft className="size-3.5" /> Voltar ao Antes
              </Button>
              <Button type="button" onClick={() => setActiveStep(3)} className="gap-2">
                Avançar para Laudo e Depois
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ETAPA 3: LAUDO DE ENTREGA & FOTOS DO DEPOIS */}
        {/* ============================================================== */}
        {activeStep === 3 && (
          <div className="space-y-4 py-2">
            {/* Comparador Visual Antes vs Depois */}
            {beforePhotos.length > 0 && afterPhotos.length > 0 && (
              <div className="bg-muted/30 space-y-2 rounded-xl border p-3">
                <div className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="size-3.5 text-amber-500" />
                  Comparador Antes vs Depois
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                      Antes
                    </span>
                    <div className="relative aspect-video overflow-hidden rounded-lg border bg-black/5">
                      <SafeImage
                        src={beforePhotos[0]}
                        alt="Foto do Antes"
                        className="size-full object-cover"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold tracking-wider text-emerald-600 uppercase">
                      Depois
                    </span>
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-emerald-500/30 bg-black/5">
                      <SafeImage
                        src={afterPhotos[0]}
                        alt="Foto do Depois"
                        className="size-full object-cover"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Upload de Fotos do Depois */}
            <div>
              <label className="text-foreground text-xs font-semibold">
                Fotos do Resultado Concluído (Depois)
              </label>
              <p className="text-muted-foreground mb-2 text-[11px]">
                Envie fotos demonstrando o trabalho finalizado e a área limpa.
              </p>
              <FilePhotos
                value={afterPhotos}
                onChange={setAfterPhotos}
                max={4}
                label="Fotos do Depois"
                hint="Envie as evidências do trabalho finalizado"
              />
            </div>

            {/* Observações técnicas e termos de garantia */}
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-semibold">
                Observações Técnicas, Peças & Garantia
              </label>
              <Textarea
                placeholder="Ex: Trocado reparo da caixa acoplada marca X com 90 dias de garantia; testado sem vazamento e cliente ciente."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[70px] text-xs"
              />
            </div>

            {/* Resumo do Certificado / Dossiê */}
            <div className="space-y-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold text-emerald-950 dark:text-emerald-200">
                  <FileCheck2 className="size-4 text-emerald-600" />
                  Dossiê Pericial Anti-Disputas
                </span>
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                >
                  {reportCode}
                </Badge>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Este documento registra data, hora, itens conferidos e evidências fotográficas
                inalteráveis. Protegido pela plataforma Severinno.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleShareWhatsApp}
                  className="h-8 gap-1.5 border-emerald-500/30 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                >
                  <Share2 className="size-3.5" /> Compartilhar no WhatsApp
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyReport}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isCopied ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {isCopied ? "Copiado!" : "Copiar Texto do Laudo"}
                </Button>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setActiveStep(2)}
                className="gap-1.5 text-xs"
              >
                <ArrowLeft className="size-3.5" /> Voltar ao Checklist
              </Button>
              <Button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  handleSaveComplete()
                }}
                disabled={isSaving || afterPhotos.length === 0}
                className="gap-2 bg-emerald-600 text-white transition-all hover:bg-emerald-700 active:scale-95"
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Emitir Laudo & Finalizar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
