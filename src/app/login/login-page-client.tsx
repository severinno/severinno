"use client"

/**
 * LoginPageClient — Página de login standalone com suporte a SSR.
 *
 * Reusa os estilos e validações do auth-modal para consistência,
 * mas como uma página real do Next.js (rota /login).
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { Eye, EyeOff, Loader2, LogIn, ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { useAuthStore, type AuthUser } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TotpVerifyModal } from "@/components/modals/totp-verify-modal"

export function LoginPageClient() {
  const router = useRouter()
  const setUser = useAuthStore((s) => s.setUser)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<"CLIENT" | "PROVIDER">("CLIENT")
  const [twoFAToken, setTwoFAToken] = useState<string | null>(null)
  const [showTotpModal, setShowTotpModal] = useState(false)

  const loginMutation = useMutation({
    mutationFn: (data: { email: string; password: string; role: string }) =>
      apiPost<{ user?: AuthUser | null; requires2FA?: boolean; tempToken?: string }>("/api/auth/login", data),
    onSuccess: (data) => {
      if (data.requires2FA && data.tempToken) {
        setTwoFAToken(data.tempToken)
        setShowTotpModal(true)
        return
      }
      if (data.user) {
        setUser(data.user)
        toast.success("Login realizado com sucesso!")
        router.push(data.user.role === "ADMIN" ? "/" : "/")
      } else {
        toast.error("E-mail ou senha inválidos.")
      }
    },
    onError: () => {
      toast.error("E-mail ou senha inválidos. Verifique seus dados e tente novamente.")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    loginMutation.mutate({ email: email.trim(), password, role })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 px-4 py-12 dark:from-emerald-950 dark:to-teal-950">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" />
            Voltar ao início
          </Link>
          <CardTitle className="text-2xl font-bold">Entrar</CardTitle>
          <CardDescription>Acesse sua conta Severinno</CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {/* Role toggle */}
            <div className="bg-muted flex rounded-lg border p-1">
              <button
                type="button"
                role="tab"
                aria-selected={role === "CLIENT"}
                onClick={() => setRole("CLIENT")}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                  role === "CLIENT"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Cliente
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={role === "PROVIDER"}
                onClick={() => setRole("PROVIDER")}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                  role === "PROVIDER"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Prestador
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-email">E-mail</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Senha</Label>
                <Link
                  href="/auth/reset-password"
                  className="text-xs text-emerald-600 hover:text-emerald-500 hover:underline"
                >
                  Esqueceu a senha?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                  aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loginMutation.isPending || !email.trim() || !password}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  <LogIn className="size-4" />
                  Entrar
                </>
              )}
            </Button>
          </CardContent>
        </form>

        <CardFooter className="flex flex-col gap-3 text-center">
          <p className="text-muted-foreground text-sm">
            Não tem conta?{" "}
            <Link
              href="/register"
              className="font-medium text-emerald-600 hover:text-emerald-500 hover:underline"
            >
              Cadastre-se
            </Link>
          </p>
        </CardFooter>
      </Card>

      {twoFAToken && (
        <TotpVerifyModal
          open={showTotpModal}
          onOpenChange={setShowTotpModal}
          tempToken={twoFAToken}
          onSuccess={(user) => {
            setUser(user as AuthUser)
            toast.success("Verificação concluída!")
            router.push("/")
          }}
        />
      )}
    </div>
  )
}
