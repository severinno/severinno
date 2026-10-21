"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Copy, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/lib/haptics"
import { toast } from "sonner"

export interface PresenceTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  serviceTitle?: string
  providerName?: string
}

export function PresenceTokenDialog({
  open,
  onOpenChange,
  bookingId,
  serviceTitle = "Serviço",
  providerName = "Prestador",
}: PresenceTokenDialogProps) {
  const { data, isLoading, isFetching, refetch } = useQuery<{
    success: boolean
    data?: { token: string }
  }>({
    queryKey: ["presence-token", bookingId],
    queryFn: async () => {
      const res = await fetch("/api/bookings/checkin-escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-presence-token",
          bookingId,
        }),
      })

      const json = await res.json()
      if (res.ok && json.success && json.data?.token) {
        triggerHaptic("success")
        return json
      }
      throw new Error(json.error || "Falha ao gerar código de presença.")
    },
    enabled: open,
    staleTime: 0,
  })

  const token = data?.data?.token ?? null
  const loading = isLoading || isFetching

  const handleCopy = () => {
    if (!token) return
    navigator.clipboard.writeText(token)
    triggerHaptic("success")
    toast.success("Código copiado!")
  }

  const formattedToken =
    token && token.length === 6 ? `${token.slice(0, 3)} · ${token.slice(3)}` : token

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20">
            <KeyRound className="h-6 w-6" />
          </div>
          <DialogTitle className="mt-2 text-lg font-bold">Código de Presença</DialogTitle>
          <DialogDescription className="text-xs">
            {serviceTitle} · Prestador: {providerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Card com o Token Gigante */}
          <div className="relative rounded-2xl border-2 border-dashed border-emerald-500/40 bg-emerald-500/5 p-6 dark:bg-emerald-950/20">
            {loading ? (
              <div className="flex h-14 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
              </div>
            ) : token ? (
              <div className="space-y-1">
                <span className="font-mono text-3xl font-black tracking-widest text-emerald-600 dark:text-emerald-400">
                  {formattedToken}
                </span>
                <p className="text-muted-foreground text-[11px]">Válido por 15 minutos</p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">Nenhum código gerado</p>
            )}

            {token && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className="text-muted-foreground hover:text-foreground absolute top-2 right-2 h-8 w-8"
                title="Copiar código"
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Dica Operacional */}
          <div className="border-border bg-muted/40 space-y-1.5 rounded-lg border p-3 text-left text-xs">
            <div className="text-foreground flex items-center gap-1.5 font-semibold">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Como funciona o Fallback de GPS?
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Caso o prestador chegue ao seu prédio ou subsolo e o GPS do celular dele não tenha
              sinal, basta falar ou mostrar este código de 6 dígitos para validar a chegada no app.
            </p>
          </div>

          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={loading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Novo Código
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs">
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
