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
import { Eye, EyeOff, Key, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { TwoFactorSetup } from "@/components/shared/two-factor-setup"

export function ClientSecurity() {
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showCurrent, setShowCurrent] = React.useState(false)
  const [showNew, setShowNew] = React.useState(false)

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
        <CardContent className="p-4 space-y-4">
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
    </div>
  )
}
