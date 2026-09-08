"use client"

/**
 * IdentityVerification — KYC flow for providers and clients.
 *
 * Upload document (RG/CNH/CNPJ) + selfie with live preview.
 * Shows status tracker: Pendente → Em análise → Aprovado / Rejeitado
 *
 * Uses existing schema fields: identityDocUrl, identitySelfieUrl, identityStatus
 */

import * as React from "react"
import {
  Upload,
  Camera,
  FileCheck,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageTransition } from "@/components/shared/page-transition"
import { compressImageFile } from "@/lib/client-image-compression"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type IdentityStatus = "none" | "pending" | "reviewing" | "approved" | "rejected"

type VerificationData = {
  status: IdentityStatus
  docUrl?: string | null
  selfieUrl?: string | null
  verifiedAt?: string | null
  rejectionReason?: string | null
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<
  IdentityStatus,
  { icon: React.ElementType; label: string; color: string; description: string }
> = {
  none: {
    icon: Upload,
    label: "Não verificado",
    color: "text-muted-foreground",
    description: "Envie seus documentos para verificar sua identidade.",
  },
  pending: {
    icon: Clock,
    label: "Pendente",
    color: "text-amber-500",
    description: "Seus documentos foram enviados e estão aguardando análise.",
  },
  reviewing: {
    icon: FileCheck,
    label: "Em análise",
    color: "text-blue-500",
    description: "Nosso time está verificando seus documentos.",
  },
  approved: {
    icon: CheckCircle2,
    label: "Aprovado",
    color: "text-emerald-500",
    description: "Sua identidade foi verificada com sucesso!",
  },
  rejected: {
    icon: XCircle,
    label: "Rejeitado",
    color: "text-red-500",
    description: "Sua verificação foi rejeitada. Veja o motivo abaixo.",
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function IdentityVerification({ className }: { className?: string }) {
  const [verification, setVerification] = React.useState<VerificationData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [docFile, setDocFile] = React.useState<File | null>(null)
  const [selfieFile, setSelfieFile] = React.useState<File | null>(null)
  const [docPreview, setDocPreview] = React.useState<string | null>(null)
  const [selfiePreview, setSelfiePreview] = React.useState<string | null>(null)

  // Fetch current status
  React.useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/auth/identity")
        if (res.ok) {
          const data = await res.json()
          setVerification(data)
        }
      } catch {
        // Best effort
      } finally {
        setLoading(false)
      }
    }
    fetchStatus()
  }, [])

  // Handle file selection with preview
  const handleFileChange = React.useCallback(
    (type: "doc" | "selfie") => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      // Validate size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Arquivo muito grande. Máximo 10MB.")
        return
      }

      // Validate type
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        toast.error("Formato inválido. Use JPG, PNG ou PDF.")
        return
      }

      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null

      if (type === "doc") {
        setDocFile(file)
        setDocPreview(previewUrl)
      } else {
        setSelfieFile(file)
        setSelfiePreview(previewUrl)
      }
    },
    [],
  )

  // Submit documents
  const handleSubmit = React.useCallback(async () => {
    if (!docFile || !selfieFile) {
      toast.error("Selecione o documento e a selfie para continuar.")
      return
    }

    setSubmitting(true)
    try {
      // Compress both images client-side before network transfer
      const [compressedDoc, compressedSelfie] = await Promise.all([
        compressImageFile(docFile, { maxDimension: 1600, quality: 0.82 }),
        compressImageFile(selfieFile, { maxDimension: 1200, quality: 0.82 }),
      ])

      const formData = new FormData()
      formData.append("document", compressedDoc)
      formData.append("selfie", compressedSelfie)

      const res = await fetch("/api/auth/identity", { method: "POST", body: formData })

      if (res.ok) {
        toast.success("Documentos enviados! Aguarde a análise.")
        setVerification({ status: "pending" })
        setDocFile(null)
        setSelfieFile(null)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error((err as { error?: string }).error ?? "Erro ao enviar documentos.")
      }
    } catch {
      toast.error("Erro de conexão. Tente novamente.")
    } finally {
      setSubmitting(false)
    }
  }, [docFile, selfieFile])

  // Cleanup preview URLs
  React.useEffect(() => {
    return () => {
      if (docPreview) URL.revokeObjectURL(docPreview)
      if (selfiePreview) URL.revokeObjectURL(selfiePreview)
    }
  }, [docPreview, selfiePreview])

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  const status = verification?.status ?? "none"
  const statusConfig = STATUS_CONFIG[status]
  const StatusIcon = statusConfig.icon

  return (
    <PageTransition>
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex size-10 items-center justify-center rounded-full">
              <ShieldCheck className="text-primary size-5" />
            </div>
            <div>
              <CardTitle className="text-base">Verificação de Identidade</CardTitle>
              <CardDescription>
                Verifique sua identidade para receber o selo de confiança
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Status tracker */}
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <StatusIcon className={cn("size-6", statusConfig.color)} />
            <div>
              <p className={cn("font-semibold", statusConfig.color)}>{statusConfig.label}</p>
              <p className="text-muted-foreground text-sm">{statusConfig.description}</p>
            </div>
          </div>

          {/* Rejection reason */}
          {status === "rejected" && verification?.rejectionReason && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  Motivo da rejeição:
                </p>
                <p className="text-sm text-red-600 dark:text-red-300">
                  {verification.rejectionReason}
                </p>
              </div>
            </div>
          )}

          {/* Verified info */}
          {status === "approved" && verification?.verifiedAt && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <CheckCircle2 className="size-5 text-emerald-500" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Verificado em{" "}
                {new Date(verification.verifiedAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          )}

          {/* Upload form — only show if not pending/approved */}
          {(status === "none" || status === "rejected") && (
            <div className="space-y-4">
              {/* Step progress */}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-bold",
                    docFile ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  1
                </div>
                <div
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    docFile ? "bg-emerald-500" : "bg-muted",
                  )}
                />
                <div
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-bold",
                    selfieFile ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  2
                </div>
                <div
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    docFile && selfieFile ? "bg-emerald-500" : "bg-muted",
                  )}
                />
                <div
                  className={cn(
                    "bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-xs font-bold",
                  )}
                >
                  3
                </div>
              </div>

              {/* Document upload */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Documento (RG, CNH ou CNPJ)</label>
                <div
                  className={cn(
                    "relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors",
                    docFile
                      ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                      : "border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30",
                  )}
                  onClick={() => document.getElementById("doc-input")?.click()}
                >
                  {docPreview ? (
                    <img
                      src={docPreview}
                      alt="Preview do documento"
                      className="max-h-32 rounded-lg object-contain"
                    />
                  ) : (
                    <>
                      <Upload className="text-muted-foreground size-8" />
                      <span className="text-muted-foreground text-sm">
                        Clique para enviar seu documento
                      </span>
                    </>
                  )}
                  <input
                    id="doc-input"
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={handleFileChange("doc")}
                  />
                </div>
              </div>

              {/* Selfie upload */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Selfie segurando o documento</label>
                <div
                  className={cn(
                    "relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors",
                    selfieFile
                      ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                      : "border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30",
                  )}
                  onClick={() => document.getElementById("selfie-input")?.click()}
                >
                  {selfiePreview ? (
                    <img
                      src={selfiePreview}
                      alt="Preview da selfie"
                      className="max-h-32 rounded-lg object-contain"
                    />
                  ) : (
                    <>
                      <Camera className="text-muted-foreground size-8" />
                      <span className="text-muted-foreground text-sm">
                        Clique para tirar uma selfie
                      </span>
                    </>
                  )}
                  <input
                    id="selfie-input"
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={handleFileChange("selfie")}
                  />
                </div>
              </div>

              {/* Submit */}
              <Button
                onClick={handleSubmit}
                disabled={!docFile || !selfieFile || submitting}
                className="w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="mr-2 size-4" />
                    Enviar para verificação
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </PageTransition>
  )
}

export default IdentityVerification
