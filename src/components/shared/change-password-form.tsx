"use client"

/**
 * ChangePasswordForm — shared component used by both the ProviderProfile
 * and ClientProfile views. Lets authenticated users update their password.
 *
 * Shows current password + new password + confirm password fields,
 * validates client-side, calls PATCH /api/auth/change-password on submit.
 */

import * as React from "react"
import { Eye, EyeOff, Key, Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { envTimeoutSignal } from "@/lib/fetch-timeout"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showPasswords, setShowPasswords] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword &&
    !saving

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setSuccess(false)

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: envTimeoutSignal("API_TIMEOUT_MS", 15_000),
      })

      const data = await res.json()

      if (res.ok && data.ok) {
        toast.success("Senha alterada com sucesso!")
        setSuccess(true)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      } else {
        toast.error(data.error || "Erro ao alterar senha.")
      }
    } catch {
      toast.error("Erro de rede. Verifique sua conexão.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <div className="flex items-center gap-2">
          <Key className="text-muted-foreground size-4" />
          <CardTitle className="text-sm">Alterar senha</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Mantenha sua conta segura alterando sua senha periodicamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        {success ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
              <ShieldCheck className="size-6 text-emerald-600" />
            </div>
            <p className="text-sm font-medium">Senha alterada com sucesso!</p>
            <p className="text-muted-foreground text-xs">
              Sua nova senha já está valendo. Use-a no próximo login.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Senha atual</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showPasswords ? "text" : "password"}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Digite sua senha atual"
                  required
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Nova senha</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPasswords ? "text" : "password"}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    required
                    minLength={6}
                  />
                </div>
                {newPassword && newPassword.length < 6 && (
                  <p className="text-destructive text-xs">Mínimo de 6 caracteres</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                <Input
                  id="confirm-password"
                  type={showPasswords ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  required
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-destructive text-xs">As senhas não conferem</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
              >
                {showPasswords ? (
                  <>
                    <EyeOff className="size-3.5" /> Ocultar senhas
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" /> Mostrar senhas
                  </>
                )}
              </button>
              <Button type="submit" disabled={!canSubmit} size="sm" className="gap-1.5">
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Key className="size-3.5" />
                )}
                Alterar senha
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
