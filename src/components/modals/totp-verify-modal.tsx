"use client"

/**
 * TotpVerifyModal — Modal for TOTP verification during login (2FA step).
 *
 * Shown when the login response returns `requires2FA: true`.
 * Accepts either a TOTP code or a backup code.
 */

import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TotpVerifyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tempToken: string
  onSuccess: (user: { id: string; role: string }) => void
}

type VerifyResponse = {
  ok: boolean
  user: { id: string; role: string }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TotpVerifyModal({
  open,
  onOpenChange,
  tempToken,
  onSuccess,
}: TotpVerifyModalProps) {
  const [code, setCode] = React.useState("")
  const [isBackupCode, setIsBackupCode] = React.useState(false)

  const verifyMutation = useMutation({
    mutationFn: (code: string) =>
      apiPost<VerifyResponse>("/api/auth/2fa/verify", {
        tempToken,
        code,
        isBackupCode,
      }),
    onSuccess: (data) => {
      toast.success("Verificado com sucesso!")
      onOpenChange(false)
      onSuccess(data.user)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Código inválido")
      setCode("")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length === 6 || (isBackupCode && code.length === 8)) {
      verifyMutation.mutate(code)
    }
  }

  const handleCodeChange = (value: string) => {
    const cleaned = isBackupCode
      ? value.replace(/\D/g, "").slice(0, 8)
      : value.replace(/\D/g, "").slice(0, 6)
    setCode(cleaned)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Verificação em Duas Etapas
          </DialogTitle>
          <DialogDescription>
            Insira o código de 6 dígitos do seu aplicativo autenticador.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="totp-code">
              {isBackupCode ? "Código de Backup (8 dígitos)" : "Código TOTP (6 dígitos)"}
            </Label>
            <Input
              id="totp-code"
              type="text"
              inputMode="numeric"
              placeholder={isBackupCode ? "00000000" : "000000"}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              className="text-center font-mono text-lg tracking-widest"
              autoFocus
              disabled={verifyMutation.isPending}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={
              verifyMutation.isPending || (isBackupCode ? code.length !== 8 : code.length !== 6)
            }
          >
            {verifyMutation.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 size-4" />
            )}
            Verificar
          </Button>

          <div className="text-center">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              onClick={() => {
                setIsBackupCode(!isBackupCode)
                setCode("")
              }}
            >
              {isBackupCode ? "Usar código do autenticador" : "Usar código de backup"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
