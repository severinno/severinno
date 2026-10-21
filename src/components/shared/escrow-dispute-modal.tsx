"use client"

import * as React from "react"
import {
  AlertTriangle,
  Camera,
  FileWarning,
  HelpCircle,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { triggerHaptic } from "@/lib/haptics"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { compressImageFile } from "@/lib/client-image-compression"

export interface EscrowDisputeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  serviceTitle?: string
  providerName?: string
  amount?: number
  onSuccess?: () => void
}

const CATEGORIES = [
  {
    id: "NOT_DELIVERED",
    label: "Serviço Não Entregue",
    description: "O prestador não compareceu ou não executou o trabalho.",
    icon: AlertTriangle,
  },
  {
    id: "POOR_QUALITY",
    label: "Qualidade Insatisfatória",
    description: "O serviço foi feito fora dos padrões ou com defeito.",
    icon: FileWarning,
  },
  {
    id: "INCOMPLETE",
    label: "Trabalho Incompleto",
    description: "O prestador saiu antes de terminar o combinado.",
    icon: HelpCircle,
  },
  {
    id: "DAMAGED",
    label: "Dano ou Avaria Material",
    description: "Ocorreu quebra ou dano no local durante o atendimento.",
    icon: ShieldAlert,
  },
  {
    id: "UNAUTHORIZED_CHARGE",
    label: "Desacordo de Valor",
    description: "Cobrança divergente do valor acordado no agendamento.",
    icon: Lock,
  },
  {
    id: "OTHER",
    label: "Outro Motivo",
    description: "Outro desacordo não listado acima.",
    icon: HelpCircle,
  },
] as const

type DisputeCategory = (typeof CATEGORIES)[number]["id"]

export function EscrowDisputeModal({
  open,
  onOpenChange,
  bookingId,
  serviceTitle = "Serviço",
  providerName = "Prestador",
  amount = 0,
  onSuccess,
}: EscrowDisputeModalProps) {
  const [category, setCategory] = React.useState<DisputeCategory>("POOR_QUALITY")
  const [reason, setReason] = React.useState("")
  const [photos, setPhotos] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleSelectCategory = (cat: DisputeCategory) => {
    setCategory(cat)
    triggerHaptic("selection")
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    const newPhotos: string[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        if (photos.length + newPhotos.length >= 6) {
          toast.warning("Limite máximo de 6 fotos de evidência atingido.")
          break
        }
        const file = files[i]
        const compressed = await compressImageFile(file, {
          maxWidth: 1200,
          maxHeight: 1200,
          quality: 0.8,
        })

        // Converter para Base64 Data URL (funciona offline e em testes)
        const reader = new FileReader()
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(compressed)
        })
        const dataUrl = await base64Promise
        newPhotos.push(dataUrl)
      }

      if (newPhotos.length > 0) {
        setPhotos((prev) => [...prev, ...newPhotos])
        triggerHaptic("success")
        toast.success(`${newPhotos.length} foto(s) anexada(s) à contestação.`)
      }
    } catch {
      toast.error("Erro ao processar as fotos selecionadas.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== index))
    triggerHaptic("selection")
  }

  const handleSubmit = async () => {
    if (reason.trim().length < 10) {
      triggerHaptic("error")
      toast.error("Descreva o motivo com pelo menos 10 caracteres.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          reason: reason.trim(),
          evidencePhotos: photos,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Falha ao abrir contestação")
      }

      triggerHaptic("success")
      toast.success("Contestação registrada com sucesso!", {
        description:
          "Os fundos permanecem congelados em custódia. Nossa equipe mediará o caso em até 48h.",
      })
      onSuccess?.()
      onOpenChange(false)
    } catch (err: unknown) {
      triggerHaptic("error")
      const message = err instanceof Error ? err.message : "Erro ao registrar disputa."
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">Contestar Serviço & Escrow</DialogTitle>
              <DialogDescription className="text-xs">
                {serviceTitle} · Prestador: {providerName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Banner de Garantia Escrow */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">
                🛡️ Proteção de Custódia Severinno (R$ {amount.toFixed(2)})
              </p>
              <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                Ao abrir a disputa, o pagamento é imediatamente congelado em custódia. O prestador
                não receberá o repasse até que as evidências sejam analisadas por nossa mediação em
                até 48h úteis.
              </p>
            </div>
          </div>
        </div>

        {/* Escolha do Motivo / Categoria */}
        <div className="space-y-2">
          <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            1. Categoria da Contestação
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CATEGORIES.map((item) => {
              const Icon = item.icon
              const isSelected = category === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectCategory(item.id)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all",
                    isSelected
                      ? "border-amber-500 bg-amber-50/50 shadow-sm dark:bg-amber-950/20"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      isSelected ? "text-amber-600" : "text-muted-foreground",
                    )}
                  />
                  <div>
                    <p
                      className={cn(
                        "text-xs font-medium",
                        isSelected ? "text-amber-900 dark:text-amber-200" : "text-foreground",
                      )}
                    >
                      {item.label}
                    </p>
                    <p className="text-muted-foreground text-[10px] leading-tight">
                      {item.description}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Descrição Detalhada */}
        <div className="space-y-2">
          <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            2. Descrição Detalhada dos Fatos
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explique o que aconteceu, horários, o que foi conversado e quais acordos não foram cumpridos..."
            rows={4}
            className="resize-none text-xs"
          />
          <div className="text-muted-foreground flex justify-between text-[11px]">
            <span>Mínimo 10 caracteres</span>
            <span>{reason.length} caracteres</span>
          </div>
        </div>

        {/* Upload de Evidências Fotográficas */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              3. Fotos Comprobatórias (Antes / Depois / Defeito)
            </label>
            <span className="text-muted-foreground text-[11px]">{photos.length}/6 fotos</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((src, index) => (
              <div
                key={index}
                className="group bg-muted relative aspect-square overflow-hidden rounded-lg border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Evidência ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemovePhoto(index)}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-90 transition hover:bg-black/90"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            {photos.length < 6 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-muted-foreground/30 text-muted-foreground flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition hover:border-amber-500 hover:text-amber-600"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
                ) : (
                  <>
                    <Camera className="h-5 w-5" />
                    <span className="text-[10px] font-medium">+ Adicionar</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || reason.trim().length < 10}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            Congelar Custódia & Abrir Disputa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
