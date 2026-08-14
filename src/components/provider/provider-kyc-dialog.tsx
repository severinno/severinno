"use client"

/**
 * ProviderKycDialog — Identity verification (KYC) modal for providers.
 *
 * Allows providers to submit proof of identity (RG or CNH) + Selfie,
 * and track verification status (Pending, Approved, Rejected).
 */

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Lock,
  ShieldAlert,
  UploadCloud,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ProviderKycDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentStatus?: string | null
  isVerified?: boolean
}

export function ProviderKycDialog({
  open,
  onOpenChange,
  currentStatus,
  isVerified,
}: ProviderKycDialogProps) {
  const qc = useQueryClient()
  const [docUrl, setDocUrl] = React.useState("")
  const [selfieUrl, setSelfieUrl] = React.useState("")

  const mutation = useMutation({
    mutationFn: () =>
      apiPost("/api/provider/verify-identity", {
        docUrl,
        selfieUrl,
      }),
    onSuccess: () => {
      toast.success("Documentos enviados para análise com sucesso!")
      qc.invalidateQueries({ queryKey: ["auth", "me"] })
      qc.invalidateQueries({ queryKey: ["provider", "stats"] })
      onOpenChange(false)
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Erro ao enviar documentos. Verifique as URLs.")
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <BadgeCheck className="size-5 text-emerald-600" />
            Verificação de Identidade (Selo Oficial)
          </DialogTitle>
          <DialogDescription>
            Profissionais verificados recebem até 3x mais solicitações e transmitem total confiança aos clientes.
          </DialogDescription>
        </DialogHeader>

        {isVerified ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                Seu perfil está 100% Verificado!
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Você possui o selo de prestador verificado ativo em todas as suas ofertas e buscas.
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="mt-2">
              Fechar
            </Button>
          </div>
        ) : currentStatus === "pending" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
              <Clock className="size-8 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                Documentos em Análise
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Nossa equipe de compliance está validando seus documentos. O prazo médio de aprovação é de até 24 horas.
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="mt-2">
              Entendido
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              mutation.mutate()
            }}
            className="space-y-4 pt-2"
          >
            {currentStatus === "rejected" && (
              <div className="rounded-lg bg-red-50 p-3 border border-red-200 dark:bg-red-950/20 text-xs text-red-700 flex items-start gap-2">
                <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                <span>
                  Sua verificação anterior não foi aprovada. Certifique-se de que o documento esteja legível e reenvie abaixo.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="size-3.5 text-emerald-600" />
                Foto do Documento (RG ou CNH) — Frente e Verso
              </label>
              <Input
                type="url"
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="URL da imagem (ex: https://...)"
                required
                className="h-10"
              />
              <span className="text-[11px] text-muted-foreground">
                Você pode subir a foto no Imgur ou no seu armazenamento S3 e colar o link seguro.
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <UploadCloud className="size-3.5 text-emerald-600" />
                Selfie segurando o documento ao lado do rosto
              </label>
              <Input
                type="url"
                value={selfieUrl}
                onChange={(e) => setSelfieUrl(e.target.value)}
                placeholder="URL da selfie (ex: https://...)"
                required
                className="h-10"
              />
            </div>

            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground border flex items-center gap-2">
              <Lock className="size-4 text-emerald-600 shrink-0" />
              <span>
                Seus documentos são criptografados e utilizados exclusivamente para validação de segurança e compliance.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!docUrl || !selfieUrl || mutation.isPending}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <BadgeCheck className="size-4" />
                    Enviar para Verificação
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
