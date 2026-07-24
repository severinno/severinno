"use client"

/**
 * ResetPasswordPage — standalone page for users who click the link in their
 * password-reset email.  Renders a simple form where they type a new password.
 *
 * This is a rare page that lives OUTSIDE the SPA shell because the user does
 * not yet have an active session (the email recipient could be on any device).
 */

import { useParams, useRouter } from "next/navigation"
import * as React from "react"
import { CheckCircle2, Eye, EyeOff, Loader2, Lock, XCircle } from "lucide-react"

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = React.useState("")

  const canSubmit = password.length >= 6 && password === confirmPassword && status === "idle"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setStatus("loading")
    setErrorMsg("")

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (res.ok && data.ok) {
        setStatus("success")
      } else {
        setStatus("error")
        setErrorMsg(data.error || "Erro ao redefinir senha. Tente novamente.")
      }
    } catch {
      setStatus("error")
      setErrorMsg("Erro de rede. Verifique sua conexão.")
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-background p-4 dark:from-emerald-950/20">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        {/* Brand */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Lock className="size-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Redefinir senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha uma nova senha para sua conta
          </p>
        </div>

        {/* Success state */}
        {status === "success" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-12 text-emerald-600" />
            <h2 className="text-lg font-semibold">Senha alterada! 🎉</h2>
            <p className="text-sm text-muted-foreground">
              Sua senha foi redefinida com sucesso. Agora você pode fazer login
              com sua nova senha.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-6 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Ir para o login
            </button>
          </div>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <XCircle className="size-12 text-red-500" />
            <p className="text-sm text-destructive">{errorMsg}</p>
            <button
              onClick={() => setStatus("idle")}
              className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Form */}
        {status !== "success" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Nova senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-transparent pl-9 pr-9 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirmar senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-transparent pl-9 pr-9 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">As senhas não conferem</p>
              )}
              {password && password.length < 6 && (
                <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "loading" && <Loader2 className="size-4 animate-spin" />}
              Redefinir senha
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
