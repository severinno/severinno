"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { FileText, Printer, Check, Copy, ShieldCheck, Loader2, Share2 } from "lucide-react"
import { apiGet } from "@/lib/api"
import { triggerHaptic } from "@/lib/haptics"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export type ReceiptData = {
  ok: boolean
  receipt: {
    serialNumber: string
    authCode: string
    issueDate: string
    serviceDate: string
    status: string
    service: {
      title: string
      description?: string
      location?: string
    }
    financials: {
      totalAmount: number
      formattedTotal: string
      paymentMethod?: string
      paymentStatus: string
    }
    provider: {
      name: string
      document: string
      email?: string
    }
    client: {
      name: string
      email?: string
    }
    platform: {
      name: string
      authenticityUrl: string
    }
  }
}

type ReceiptModalProps = {
  bookingId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReceiptModal({ bookingId, open, onOpenChange }: ReceiptModalProps) {
  const [copied, setCopied] = React.useState(false)

  const { data, isLoading } = useQuery<ReceiptData>({
    queryKey: ["booking", bookingId, "receipt"],
    queryFn: () => apiGet<ReceiptData>(`/api/bookings/${bookingId}/receipt`),
    enabled: open && Boolean(bookingId),
  })

  const receipt = data?.receipt

  const handlePrint = () => {
    triggerHaptic("selection")
    window.open(`/api/bookings/${bookingId}/receipt?format=html`, "_blank")
  }

  const handleCopyAuth = () => {
    if (!receipt?.authCode) return
    triggerHaptic("selection")
    navigator.clipboard.writeText(receipt.authCode)
    setCopied(true)
    toast.success("Código de autenticidade copiado! 📋")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = async () => {
    triggerHaptic("selection")
    const receiptUrl = `${window.location.origin}/api/bookings/${bookingId}/receipt?format=html`
    const shareData = {
      title: `Recibo Severinno — ${receipt?.service.title || "Serviço"}`,
      text: `Recibo de prestação de serviços Severinno Marketplace\nServiço: ${receipt?.service.title}\nValor: ${receipt?.financials.formattedTotal}\nCódigo de Autenticidade: ${receipt?.authCode}\nConfira o recibo:`,
      url: receiptUrl,
    }

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData)
        triggerHaptic("success")
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          toast.error("Não foi possível abrir o menu de compartilhamento.")
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`)
        triggerHaptic("success")
        toast.success("Link e resumo do recibo copiados para compartilhar! 📋")
      } catch {
        toast.error("Erro ao copiar link do recibo.")
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <FileText className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Recibo de Prestação de Serviços
              </DialogTitle>
              <DialogDescription className="text-xs">
                Comprovante oficial com custódia e validação digital
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : receipt ? (
          <div className="space-y-4 pt-2 text-xs">
            {/* Header info */}
            <div className="bg-muted/40 flex items-center justify-between rounded-lg border p-3">
              <div>
                <span className="text-foreground font-mono text-[11px] font-bold">
                  {receipt.serialNumber}
                </span>
                <div className="text-muted-foreground text-[10px]">Data: {receipt.serviceDate}</div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300">
                <ShieldCheck className="size-3" />
                Liquidado
              </span>
            </div>

            {/* Parties */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-2.5">
                <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                  Tomador (Cliente)
                </span>
                <span className="text-foreground font-semibold">{receipt.client.name}</span>
              </div>
              <div className="rounded-lg border p-2.5">
                <span className="text-muted-foreground block text-[10px] font-medium uppercase">
                  Prestador
                </span>
                <span className="text-foreground font-semibold">{receipt.provider.name}</span>
                <div className="text-muted-foreground text-[10px]">{receipt.provider.document}</div>
              </div>
            </div>

            {/* Service & Total */}
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground text-[10px] font-medium uppercase">
                Serviço Executado
              </div>
              <div className="text-foreground text-sm font-bold">{receipt.service.title}</div>
              {receipt.service.location && (
                <div className="text-muted-foreground mt-0.5 text-[11px]">
                  {receipt.service.location}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Valor Total:</span>
                <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                  {receipt.financials.formattedTotal}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col items-stretch gap-2 pt-1 sm:flex-row sm:items-center">
              <Button
                onClick={handleShare}
                className="h-9.5 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-9"
              >
                <Share2 className="size-3.5" />
                Compartilhar no WhatsApp
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handlePrint}
                  className="h-9.5 flex-1 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-9 sm:flex-initial"
                >
                  <Printer className="size-3.5" />
                  PDF / Imprimir
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCopyAuth}
                  className="h-9.5 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-9"
                >
                  {copied ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? "Copiado!" : "Código"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground py-6 text-center text-xs">
            Não foi possível carregar o recibo para este agendamento.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
