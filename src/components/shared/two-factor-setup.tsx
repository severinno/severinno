"use client"

/**
 * TwoFactorSetup — 2FA configuration component for user settings.
 *
 * Handles:
 * - Setup: Generate secret + QR code
 * - Enable: Verify TOTP code to activate 2FA
 * - Disable: Verify TOTP code to deactivate 2FA
 * - Backup codes: Display and regenerate
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TwoFactorStatus = {
  twoFactorEnabled: boolean
}

type SetupResponse = {
  secret: string
  uri: string
}

type EnableResponse = {
  ok: boolean
  backupCodes: string[]
  message: string
}

type DisableResponse = {
  ok: boolean
  message: string
}

type VerifyResponse = {
  ok: boolean
  backupCodes: string[]
  message: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TwoFactorSetup() {
  const qc = useQueryClient()

  // Fetch current 2FA status
  const statusQuery = useQuery<TwoFactorStatus>({
    queryKey: ["users", "me", "2fa-status"],
    queryFn: () => apiGet<TwoFactorStatus>("/api/auth/2fa/status"),
    // If the endpoint doesn't exist yet, default to false
    enabled: false,
  })

  const isEnabled = statusQuery.data?.twoFactorEnabled ?? false

  // Setup state
  const [step, setStep] = React.useState<"idle" | "setup" | "verify" | "enabled" | "backup">(
    "idle",
  )
  const [setupData, setSetupData] = React.useState<SetupResponse | null>(null)
  const [code, setCode] = React.useState("")
  const [backupCodes, setBackupCodes] = React.useState<string[]>([])
  const [secretCopied, setSecretCopied] = React.useState(false)

  // Setup mutation
  const setupMutation = useMutation({
    mutationFn: () => apiPost<SetupResponse>("/api/auth/2fa/setup"),
    onSuccess: (data) => {
      setSetupData(data)
      setStep("setup")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao configurar 2FA")
    },
  })

  // Enable mutation
  const enableMutation = useMutation({
    mutationFn: (code: string) =>
      apiPost<EnableResponse>("/api/auth/2fa/enable", { code }),
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes)
      setStep("backup")
      qc.invalidateQueries({ queryKey: ["users", "me"] })
      toast.success("2FA ativado com sucesso!")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Código inválido")
    },
  })

  // Disable mutation
  const disableMutation = useMutation({
    mutationFn: (code: string) =>
      apiPost<DisableResponse>("/api/auth/2fa/disable", { code }),
    onSuccess: () => {
      setStep("idle")
      setCode("")
      qc.invalidateQueries({ queryKey: ["users", "me"] })
      toast.success("2FA desativado.")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Código inválido")
    },
  })

  // Regenerate backup codes
  const regenerateMutation = useMutation({
    mutationFn: (code: string) =>
      apiPost<VerifyResponse>("/api/auth/2fa/backup-codes", { code }),
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes)
      toast.success("Códigos de backup regenerados!")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Código inválido")
    },
  })

  const copySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret)
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 2000)
    }
  }

  const handleEnable = () => {
    if (code.length === 6) {
      enableMutation.mutate(code)
    }
  }

  const handleDisable = () => {
    if (code.length === 6) {
      disableMutation.mutate(code)
    }
  }

  // Render based on state
  if (isEnabled && step === "idle") {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="text-green-500 mt-0.5 size-5" />
              <div>
                <p className="text-sm font-medium">Autenticação de Dois Fatores</p>
                <p className="text-muted-foreground text-xs">
                  Sua conta está protegida com 2FA via aplicativo autenticador.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-green-500 text-green-600">
              Ativado
            </Badge>
          </div>

          <div className="mt-4 space-y-3 border-t pt-4">
            <p className="text-muted-foreground text-xs">
              Para desativar, insira o código do seu autenticador:
            </p>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-32 font-mono"
              />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={code.length !== 6 || disableMutation.isPending}
                onClick={handleDisable}
              >
                {disableMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldOff className="size-4" />
                )}
                Desativar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (step === "setup" && setupData) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <Shield className="text-primary mt-0.5 size-5" />
            <div>
              <p className="text-sm font-medium">Configurar 2FA</p>
              <p className="text-muted-foreground text-xs">
                Escaneie o QR code abaixo com seu aplicativo autenticador
                (Google Authenticator, Authy, etc.).
              </p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            <div className="bg-background flex items-center justify-center rounded-lg border p-4">
              <QRCodeSVG
                value={setupData.uri}
                size={192}
                level="M"
                includeMargin={false}
              />
            </div>
          </div>

          {/* Manual entry */}
          <div className="space-y-2">
            <Label className="text-xs">Ou insira manualmente:</Label>
            <div className="flex items-center gap-2">
              <code className="bg-muted flex-1 truncate rounded px-3 py-2 font-mono text-xs">
                {setupData.secret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copySecret}
              >
                {secretCopied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Verify code */}
          <div className="space-y-2 border-t pt-4">
            <Label className="text-xs">Insira o código de 6 dígitos:</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-32 font-mono"
              />
              <Button
                type="button"
                size="sm"
                disabled={code.length !== 6 || enableMutation.isPending}
                onClick={handleEnable}
              >
                {enableMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Ativar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (step === "backup" && backupCodes.length > 0) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-500 mt-0.5 size-5" />
            <div>
              <p className="text-sm font-medium">Códigos de Backup</p>
              <p className="text-muted-foreground text-xs">
                Salve estes códigos em local seguro. Cada código pode ser usado
                uma vez se você perder acesso ao autenticador.
              </p>
            </div>
          </div>

          <div className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-3">
            {backupCodes.map((code, i) => (
              <code key={i} className="font-mono text-center text-sm">
                {code}
              </code>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(backupCodes.join("\n"))
                toast.success("Códigos copiados!")
              }}
            >
              <Copy className="mr-2 size-4" />
              Copiar todos
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setStep("idle")
                setCode("")
                setBackupCodes([])
              }}
            >
              Concluído
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Default: show setup button
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Shield className="text-muted-foreground mt-0.5 size-5" />
            <div>
              <p className="text-sm font-medium">Autenticação de Dois Fatores</p>
              <p className="text-muted-foreground text-xs">
                Adicione uma segunda camada de segurança à sua conta.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={setupMutation.isPending}
            onClick={() => setupMutation.mutate()}
          >
            {setupMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Shield className="size-4" />
            )}
            Configurar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
