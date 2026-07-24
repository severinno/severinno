"use client"

/**
 * ForgotPasswordPage — standalone page where users enter their email to
 * receive a password reset link.
 */

import { useRouter } from "next/navigation"
import * as React from "react"
import { ArrowLeft, Loader2, Mail, SendHorizonal } from "lucide-react"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = React.useState("")
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = React.useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    setStatus("loading")
    setErrorMsg("")

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })

      const data = await res.json()

      if (res.ok && data.ok) {
        setStatus("success")
      } else {
        setStatus("error")
        setErrorMsg(data.error || "Erro ao solicitar recuperação.")
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
            <Mail className="size-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Recuperar senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Digite seu e-mail cadastrado e enviaremos instruções para redefinir sua senha.
          </p>
        </div>

        {/* Success state */}
        {status === "success" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="size-12 rounded-full bg-emerald-100 p-3 dark:bg-emerald-950/40">
              <SendHorizonal className="size-6 text-emerald-600" />
            </div>
            <h2 className="text-lg font-semibold">E-mail enviado! 📧</h2>
            <p className="text-sm text-muted-foreground">
              Se o e-mail informado estiver cadastrado, você receberá as instruções
              para redefinir sua senha em instantes.
            </p>
            <p className="text-xs text-muted-foreground">
              Não recebeu? Verifique a caixa de spam ou&nbsp;
              <button
                onClick={() => setStatus("idle")}
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                tente novamente
              </button>
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-6 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Voltar ao início
            </button>
          </div>
        )}

        {/* Form */}
        {status !== "success" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="reset-email" className="text-sm font-medium">
                Seu e-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-transparent pl-9 pr-9 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            </div>

            {status === "error" && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={!email.trim() || status === "loading"}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "loading" && <Loader2 className="size-4 animate-spin" />}
              Enviar instruções
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Voltar para o início
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
