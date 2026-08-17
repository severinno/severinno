"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Lock, CheckCircle2, AlertCircle } from "lucide-react"
import { envTimeoutSignal } from "@/lib/fetch-timeout"

export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = React.useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      toast.error("Senhas não conferem")
      return
    }
    if (password.length < 6) {
      toast.error("Mínimo 6 caracteres")
      return
    }
    setStatus("loading")
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
        signal: envTimeoutSignal("API_TIMEOUT_MS", 15_000),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro ao redefinir senha")
      setStatus("success")
    } catch (e: unknown) {
      setStatus("error")
      setErrorMsg(e instanceof Error ? e.message : "Erro inesperado")
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="size-8 text-amber-500" />
            <p className="text-muted-foreground text-sm">
              Link inválido. Solicite uma nova redefinição de senha.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="size-8 text-emerald-500" />
            <p className="font-semibold">Senha redefinida com sucesso!</p>
            <p className="text-muted-foreground text-sm">
              Você já pode fazer login com sua nova senha.
            </p>
            <Button asChild className="mt-2">
              <a href="/">Ir para o login</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Redefinir senha</CardTitle>
          <CardDescription>Digite sua nova senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">Confirmar senha</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a senha"
                required
              />
            </div>
            {status === "error" && <p className="text-xs text-red-500">{errorMsg}</p>}
            <Button type="submit" disabled={status === "loading"}>
              {status === "loading" ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Lock className="mr-1 size-4" />
              )}
              Redefinir senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
