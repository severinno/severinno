"use client"

import * as React from "react"
import { Check, CheckCircle2, Clock, Copy, FileText, QrCode, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { triggerHaptic } from "@/lib/haptics"
import { formatBRL } from "@/lib/format"

export interface ChatProposalData {
  type: "SEVERINNO_PROPOSAL"
  title: string
  amount: number
  description: string
  estimatedTime?: string
  status?: "PENDING" | "ACCEPTED" | "PAID"
}

export function parseChatProposal(content: string): ChatProposalData | null {
  if (!content) return null
  const match = content.match(/\[SEVERINNO_PROPOSAL:(\{[\s\S]*?\})\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (parsed && typeof parsed.title === "string" && typeof parsed.amount === "number") {
      return {
        type: "SEVERINNO_PROPOSAL",
        title: parsed.title,
        amount: parsed.amount,
        description: parsed.description || "",
        estimatedTime: parsed.estimatedTime,
        status: parsed.status || "PENDING",
      }
    }
  } catch {
    return null
  }
  return null
}

export function serializeChatProposal(proposal: {
  title: string
  amount: number
  description: string
  estimatedTime?: string
}): string {
  const payload: ChatProposalData = {
    type: "SEVERINNO_PROPOSAL",
    title: proposal.title,
    amount: proposal.amount,
    description: proposal.description,
    estimatedTime: proposal.estimatedTime,
    status: "PENDING",
  }
  return `📋 PROPOSTA DE SERVIÇO: ${proposal.title}
💰 Valor Total: ${formatBRL(proposal.amount)}
⏳ Prazo Estimado: ${proposal.estimatedTime || "A combinar"}
📝 Escopo & Detalhes: ${proposal.description}

[SEVERINNO_PROPOSAL:${JSON.stringify(payload)}]`
}

export function CreateProposalDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (proposal: {
    title: string
    amount: number
    description: string
    estimatedTime: string
  }) => void
}) {
  const [title, setTitle] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [estimatedTime, setEstimatedTime] = React.useState("")
  const [description, setDescription] = React.useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const numericAmount = parseFloat(amount.replace(",", "."))
    if (!title.trim() || isNaN(numericAmount) || numericAmount <= 0) {
      toast.error("Preencha o título do serviço e um valor válido.")
      return
    }
    onSubmit({
      title: title.trim(),
      amount: numericAmount,
      description: description.trim(),
      estimatedTime: estimatedTime.trim(),
    })
    setTitle("")
    setAmount("")
    setEstimatedTime("")
    setDescription("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <FileText className="size-5" />
            <DialogTitle className="text-base font-bold">Criar Proposta de Serviço</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Envie uma proposta estruturada com valor fixo e proteção da Custódia PIX Severinno (90
            Dias).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 py-2">
          <div className="space-y-1">
            <label className="text-foreground text-xs font-semibold">Título do Serviço</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Troca de Disjuntores e Quadro de Distribuição"
              required
              className="h-9 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-foreground text-xs font-semibold">Valor Total (R$)</label>
              <Input
                type="number"
                step="0.01"
                min="10"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ex: 180.00"
                required
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-foreground text-xs font-semibold">Prazo Estimado</label>
              <Input
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
                placeholder="Ex: 2 a 3 horas"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-foreground text-xs font-semibold">
              Escopo & O que está incluso
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Mão de obra especializada + conectores inclusos. Garantia de 90 dias após conclusão."
              rows={3}
              className="resize-none text-xs"
            />
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-2.5 text-[11px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <ShieldCheck className="size-4 shrink-0 text-emerald-600" />
            <span>
              O cliente pagará diretamente na mensagem via PIX com retenção garantida em custódia.
            </span>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700 active:scale-95"
            >
              <FileText className="size-3.5" />
              Enviar Proposta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AcceptProposalPixModal({
  proposal,
  open,
  onOpenChange,
  onConfirmPayment,
}: {
  proposal: ChatProposalData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmPayment: (proposal: ChatProposalData) => void
}) {
  const [copied, setCopied] = React.useState(false)

  const pixKey = React.useMemo(() => {
    if (!proposal) return ""
    const code = Math.abs(
      proposal.title.split("").reduce((acc, c) => (acc << 5) - acc + c.charCodeAt(0), 0),
    ).toString(16)
    return `00020126580014BR.GOV.BCB.PIX0136severinno-custodia-${code}520400005303986540${proposal.amount.toFixed(2)}5802BR5913SEVERINNO_ESCROW6014GOV_VALADARES62070503***6304`
  }, [proposal])

  if (!proposal) return null

  const handleCopy = () => {
    navigator.clipboard?.writeText(pixKey)
    setCopied(true)
    toast.success("Chave PIX Copia e Cola copiada!")
    triggerHaptic("light")
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-5" />
            <DialogTitle className="text-base font-bold">Aceitar Proposta & Pagar PIX</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Seu pagamento fica 100% protegido na Custódia Severinno até você validar o serviço
            executado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Card Resumo */}
          <div className="bg-muted/40 space-y-2 rounded-xl border border-emerald-500/20 p-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-xs font-medium">Serviço:</span>
              <span className="text-foreground max-w-[220px] truncate text-xs font-bold">
                {proposal.title}
              </span>
            </div>
            <div className="border-border/50 flex items-baseline justify-between border-t pt-2">
              <span className="text-muted-foreground text-xs font-medium">Valor Total:</span>
              <span className="text-lg font-extrabold text-emerald-600 tabular-nums dark:text-emerald-400">
                {formatBRL(proposal.amount)}
              </span>
            </div>
            {proposal.estimatedTime && (
              <div className="border-border/50 flex items-baseline justify-between border-t pt-2 text-xs">
                <span className="text-muted-foreground">Prazo:</span>
                <span className="text-foreground font-semibold">{proposal.estimatedTime}</span>
              </div>
            )}
          </div>

          {/* Chave PIX */}
          <div className="space-y-2">
            <label className="text-foreground flex items-center justify-between text-xs font-semibold">
              <span>Chave PIX Copia e Cola</span>
              <span className="text-[10px] font-bold text-emerald-600 uppercase dark:text-emerald-400">
                Custódia Protegida
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={pixKey}
                className="text-muted-foreground bg-muted/30 h-9 font-mono text-[11px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-9 shrink-0 gap-1 text-xs active:scale-95"
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                <span>{copied ? "Copiado" : "Copiar"}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-1 rounded-xl border border-blue-500/20 bg-blue-50/50 p-2.5 text-[11px] text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <p className="flex items-center gap-1.5 font-bold">
              <QrCode className="size-3.5 text-blue-600" />
              Garantia de 90 Dias & Custódia Ativa
            </p>
            <p className="text-[10px] leading-relaxed text-blue-800 dark:text-blue-300">
              O prestador só recebe os fundos após você conferir o laudo com fotos de antes e depois
              e aprovar a liberação.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Fechar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onConfirmPayment(proposal)}
            className="gap-1.5 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 active:scale-95"
          >
            <Check className="size-3.5" />
            Confirmar Pagamento em Custódia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ChatProposalCard({
  proposal,
  isMineOrProvider,
  onAcceptPix,
}: {
  proposal: ChatProposalData
  isMineOrProvider: boolean
  onAcceptPix: () => void
}) {
  return (
    <div className="via-background text-foreground w-full max-w-sm min-w-[280px] rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-emerald-500/20 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
          <FileText className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span>Proposta de Serviço</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <ShieldCheck className="size-3 text-emerald-600" />
          <span>Custódia Segura PIX</span>
        </span>
      </div>

      <div className="mb-3 space-y-1.5">
        <h4 className="text-foreground text-sm leading-snug font-bold">{proposal.title}</h4>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-extrabold tracking-tight text-emerald-600 tabular-nums dark:text-emerald-400">
            {formatBRL(proposal.amount)}
          </span>
          {proposal.estimatedTime && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
              <Clock className="size-3" />
              {proposal.estimatedTime}
            </span>
          )}
        </div>
        {proposal.description && (
          <p className="text-muted-foreground bg-background/50 border-border/50 mt-1 rounded-lg border p-2 text-xs leading-relaxed whitespace-pre-line">
            {proposal.description}
          </p>
        )}
      </div>

      <div className="border-t border-emerald-500/20 pt-3">
        {isMineOrProvider ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground text-[11px]">Status:</span>
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" /> Enviada ao Cliente
            </span>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onAcceptPix}
            className="w-full gap-2 bg-emerald-600 font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-98"
          >
            <ShieldCheck className="size-4" />
            Aceitar e Pagar via PIX (Custódia)
          </Button>
        )}
      </div>
    </div>
  )
}
