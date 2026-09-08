"use client"

/**
 * AdminIdentityReview — admin panel for reviewing KYC verifications.
 *
 * Shows pending verifications with document/selfie previews, OCR data,
 * and approve/reject buttons with reason input.
 */

import * as React from "react"
import {
  ShieldCheck,
  ShieldX,
  Eye,
  Loader2,
  FileCheck,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Bot,
} from "lucide-react"
import { toast } from "sonner"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { PageTransition } from "@/components/shared/page-transition"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type OcrData = {
  documentType: string
  fullName: string | null
  documentNumber: string | null
  birthDate: string | null
  confidence: number
  rawText: string
  faceMatchConfidence?: number
  faceMatchReason?: string
}

type Verification = {
  id: string
  name: string
  email: string
  role: string
  avatarUrl: string | null
  identityDocUrl: string | null
  identitySelfieUrl: string | null
  identityStatus: string
  identityOcrData: OcrData | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AdminIdentityReview() {
  const [verifications, setVerifications] = React.useState<Verification[]>([])
  const [loading, setLoading] = React.useState(true)
  const [processingId, setProcessingId] = React.useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [rejectDialogUserId, setRejectDialogUserId] = React.useState<string | null>(null)
  const [rejectReason, setRejectReason] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"pending" | "approved" | "rejected">(
    "pending",
  )

  const fetchVerifications = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/identity?status=${statusFilter}`)
      if (res.ok) {
        const data = await res.json()
        setVerifications(data.verifications ?? [])
      }
    } catch {
      toast.error("Erro ao carregar verificações.")
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  React.useEffect(() => {
    queueMicrotask(() => {
      fetchVerifications()
    })
  }, [fetchVerifications])

  const handleAction = React.useCallback(
    async (userId: string, action: "approve" | "reject", reason?: string) => {
      setProcessingId(userId)
      try {
        const res = await fetch("/api/admin/identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action, reason }),
        })
        if (res.ok) {
          toast.success(
            action === "approve" ? "Identidade aprovada com sucesso!" : "Verificação rejeitada.",
          )
          setVerifications((prev) => prev.filter((v) => v.id !== userId))
          setRejectDialogUserId(null)
          setRejectReason("")
        } else {
          toast.error("Erro ao processar ação.")
        }
      } catch {
        toast.error("Erro de conexão.")
      } finally {
        setProcessingId(null)
      }
    },
    [],
  )

  return (
    <PageTransition className="space-y-6 p-6">
      {/* Header + filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Verificações de Identidade</h2>
          <p className="text-muted-foreground text-sm">
            {statusFilter === "pending"
              ? `${verifications.length} pendente${verifications.length !== 1 ? "s" : ""}`
              : `${verifications.length} ${statusFilter === "approved" ? "aprovada" : "rejeitada"}${verifications.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className="h-7 text-xs"
            >
              {s === "pending" ? "Pendentes" : s === "approved" ? "Aprovadas" : "Rejeitadas"}
            </Button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-12 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && verifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-primary/10 flex size-16 items-center justify-center rounded-full">
            <ShieldCheck className="text-primary size-7" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Nenhuma verificação pendente</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            Todas as verificações de identidade foram processadas.
          </p>
        </div>
      )}

      {/* Verification cards */}
      {!loading && verifications.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {verifications.map((v) => {
            const initials = v.name
              ? v.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
              : "??"
            const ocr = v.identityOcrData

            return (
              <Card key={v.id} className="overflow-hidden">
                <CardContent className="space-y-4 p-5">
                  {/* User info */}
                  <div className="flex items-center gap-3">
                    <Avatar className="size-12">
                      <AvatarImage src={v.avatarUrl ?? undefined} alt={v.name} />
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">{v.name}</p>
                      <p className="text-muted-foreground text-xs">{v.email}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            v.role === "PROVIDER"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {v.role}
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          · {new Date(v.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* OCR data badge */}
                  {ocr && (
                    <div className="bg-muted/30 space-y-1 rounded-lg border p-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                          <Bot className="size-3" />
                          OCR: {ocr.documentType} ({Math.round(ocr.confidence * 100)}%)
                        </span>
                        {ocr.faceMatchConfidence !== undefined && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                              ocr.faceMatchConfidence > 0.8
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-destructive/10 text-destructive",
                            )}
                            title={ocr.faceMatchReason}
                          >
                            Face Match: {Math.round(ocr.faceMatchConfidence * 100)}%
                          </span>
                        )}
                      </div>
                      {ocr.fullName && (
                        <p className="text-xs">
                          <span className="text-muted-foreground">Nome:</span> {ocr.fullName}
                        </p>
                      )}
                      {ocr.documentNumber && (
                        <p className="text-xs">
                          <span className="text-muted-foreground">Nº:</span> {ocr.documentNumber}
                        </p>
                      )}
                      {ocr.faceMatchReason && (
                        <p
                          className="text-muted-foreground truncate text-[11px] italic"
                          title={ocr.faceMatchReason}
                        >
                          {ocr.faceMatchReason}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Document previews */}
                  <div className="flex gap-2">
                    {v.identityDocUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewUrl(v.identityDocUrl)}
                        className="group bg-muted/20 relative flex-1 overflow-hidden rounded-lg border"
                      >
                        <img
                          src={v.identityDocUrl}
                          alt="Documento"
                          className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Eye className="size-5 text-white" />
                        </div>
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                          Documento
                        </span>
                      </button>
                    )}
                    {v.identitySelfieUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewUrl(v.identitySelfieUrl)}
                        className="group bg-muted/20 relative flex-1 overflow-hidden rounded-lg border"
                      >
                        <img
                          src={v.identitySelfieUrl}
                          alt="Selfie"
                          className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Eye className="size-5 text-white" />
                        </div>
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                          Selfie
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  {statusFilter === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleAction(v.id, "approve")}
                        disabled={processingId === v.id}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                      >
                        {processingId === v.id ? (
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1 size-3.5" />
                        )}
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRejectDialogUserId(v.id)}
                        disabled={processingId === v.id}
                        className="flex-1"
                      >
                        <XCircle className="mr-1 size-3.5" />
                        Rejeitar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Image preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-2xl overflow-hidden p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Preview do Documento</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="p-4">
              <img
                src={previewUrl}
                alt="Documento ampliado"
                className="max-h-[70vh] w-full rounded-lg object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={!!rejectDialogUserId} onOpenChange={() => setRejectDialogUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Verificação</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição. O usuário será notificado.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Motivo da rejeição (ex: documento ilegível, foto borrada...)"
            className="bg-muted/20 focus:ring-primary mt-2 w-full rounded-lg border p-3 text-sm focus:ring-2 focus:outline-none"
            rows={3}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectDialogUserId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (rejectDialogUserId) {
                  handleAction(rejectDialogUserId, "reject", rejectReason)
                }
              }}
              disabled={!rejectReason.trim()}
            >
              Confirmar Rejeição
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  )
}

export default AdminIdentityReview
