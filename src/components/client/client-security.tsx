"use client"

/**
 * ClientSecurity — Security settings view for the client panel.
 *
 * Contains:
 * - Change password form
 * - Two-factor authentication (TOTP) setup
 */

import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  Key,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { TwoFactorSetup } from "@/components/shared/two-factor-setup"

export function ClientSecurity() {
  const logout = useAuthStore((s) => s.logout)
  const reset = useViewStore((s) => s.reset)

  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showCurrent, setShowCurrent] = React.useState(false)
  const [showNew, setShowNew] = React.useState(false)

  // Estados de Privacidade & LGPD
  const [consentWhatsapp, setConsentWhatsapp] = React.useState(true)
  const [consentRum, setConsentRum] = React.useState(true)
  const [isExporting, setIsExporting] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("")
  const [isDeleting, setIsDeleting] = React.useState(false)

  const handleExportData = async () => {
    try {
      setIsExporting(true)
      const res = await fetch("/api/users/me/data-export")
      if (!res.ok) throw new Error("Falha ao exportar dados")
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `dados-severinno-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("Download dos seus dados iniciado.")
    } catch {
      toast.error("Não foi possível exportar seus dados. Tente novamente.")
    } finally {
      setIsExporting(false)
    }
  }

  const handleDeleteAccount = async () => {
    try {
      setIsDeleting(true)
      const res = await fetch("/api/users/me/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "EXCLUIR MINHA CONTA" }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Erro ao excluir conta")
      }
      toast.success("Conta excluída e dados anonimizados com sucesso.")
      await logout()
      reset("vitrine")
    } catch (err) {
      toast.error((err as Error).message || "Erro ao excluir conta")
    } finally {
      setIsDeleting(false)
    }
  }

  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiPost<{ ok: boolean; message: string }>("/api/auth/change-password", data),
    onSuccess: (data) => {
      toast.success(data.message)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao alterar senha")
    },
  })

  const handleSubmitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não conferem.")
      return
    }
    changePasswordMutation.mutate({ currentPassword, newPassword })
  }

  const canSubmitPassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !changePasswordMutation.isPending

  return (
    <div className="space-y-6">
      {/* ── Change Password ──────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <Key className="text-muted-foreground mt-0.5 size-5" />
            <div>
              <p className="text-sm font-medium">Alterar senha</p>
              <p className="text-muted-foreground text-xs">
                Use uma senha forte com ao menos 8 caracteres, 1 maiúscula e 1 número.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmitPassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="current-password" className="text-xs">
                Senha atual
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="max-w-sm"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs">
                Nova senha
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="max-w-sm"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                >
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-xs">
                Confirmar nova senha
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
                className="max-w-sm"
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" size="sm" disabled={!canSubmitPassword}>
              {changePasswordMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Key className="mr-2 size-4" />
              )}
              Alterar senha
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Two-Factor Authentication ────────────────────────────── */}
      <TwoFactorSetup />

      {/* ── Privacidade & Dados Pessoais (LGPD) ───────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-muted-foreground mt-0.5 size-5" />
            <div>
              <p className="text-sm font-medium">Privacidade & Dados Pessoais (LGPD)</p>
              <p className="text-muted-foreground text-xs">
                Seus direitos sob a Lei Geral de Proteção de Dados (Art. 18): portabilidade,
                anonimização, eliminação e gestão de consentimentos.
              </p>
            </div>
          </div>

          {/* Gestão de Consentimentos (LGPD Art. 9º) */}
          <div className="space-y-3 border-t pt-3">
            <p className="text-foreground text-xs font-semibold">
              Gestão de Consentimentos (Art. 9º)
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Avisos e Lembretes por WhatsApp</p>
                <p className="text-muted-foreground text-[11px]">
                  Receber atualizações de pedidos, chegada do profissional e orçamentos via
                  WhatsApp.
                </p>
              </div>
              <Switch
                checked={consentWhatsapp}
                onCheckedChange={(c) => {
                  setConsentWhatsapp(c)
                  toast.success("Preferência de WhatsApp atualizada.")
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Métricas de Experiência e Performance (RUM)</p>
                <p className="text-muted-foreground text-[11px]">
                  Permitir envio anônimo de telemetria de carregamento de páginas para melhoria
                  contínua da vitrine.
                </p>
              </div>
              <Switch
                checked={consentRum}
                onCheckedChange={(c) => {
                  setConsentRum(c)
                  toast.success("Preferência de telemetria atualizada.")
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium">Exportar Meus Dados</p>
              <p className="text-muted-foreground text-xs">
                Baixe uma cópia completa dos seus dados cadastrais, histórico e atividades em
                formato JSON.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportData}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              Baixar meus dados
            </Button>
          </div>

          <div className="border-destructive/20 flex flex-col gap-4 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-destructive text-xs font-medium">Excluir Minha Conta</p>
              <p className="text-muted-foreground text-xs">
                Anonimiza seus dados pessoais, encerra todas as sessões e remove fotos/biometria.
                Registros contábeis e de terceiros são preservados de forma anônima.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
            >
              <Trash2 className="mr-2 size-4" />
              Excluir conta
            </Button>
          </div>

          {showDeleteConfirm && (
            <div className="border-destructive/30 bg-destructive/10 space-y-3 rounded-lg border p-4">
              <div className="text-destructive flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="size-4" />
                <span>Atenção: Esta ação é irreversível</span>
              </div>
              <p className="text-muted-foreground text-xs">
                Para confirmar a exclusão e anonimização imediata dos seus dados, digite exatamente{" "}
                <strong className="text-foreground">EXCLUIR MINHA CONTA</strong> abaixo:
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="EXCLUIR MINHA CONTA"
                className="border-destructive/40 max-w-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleteConfirmText !== "EXCLUIR MINHA CONTA" || isDeleting}
                  onClick={handleDeleteAccount}
                >
                  {isDeleting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 size-4" />
                  )}
                  Confirmar Exclusão
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteConfirmText("")
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
