/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

/**
 * RegisterPageClient — Página de cadastro standalone com suporte a SSR.
 *
 * Suporta cadastro como CLIENT ou PROVIDER.
 * Reusa os estilos do auth-modal para consistência visual.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { Eye, EyeOff, Loader2, UserPlus, ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
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

export function RegisterPageClient() {
  const router = useRouter()
  const setUser = useAuthStore((s) => s.setUser)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<"CLIENT" | "PROVIDER">("CLIENT")

  const registerMutation = useMutation({
    mutationFn: (data: { name: string; email: string; password: string; role: string }) =>
      apiPost("/api/auth/register", data),
    onSuccess: (data: any) => {
      if (data?.user) {
        setUser(data.user)
        toast.success("Conta criada com sucesso! Bem-vindo ao Severinno.")
        router.push("/")
      } else {
        toast.error("Erro ao criar conta. Tente novamente.")
      }
    },
    onError: (err: any) => {
      const message =
        err?.message ??
        (typeof err === "object" && err !== null ? JSON.stringify(err) : String(err))
      if (message.includes("já")) {
        toast.error("Este e-mail já está cadastrado. Faça login.")
      } else {
        toast.error("Não foi possível criar sua conta. Verifique os dados e tente novamente.")
      }
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password) return
    if (password !== confirmPassword) {
      toast.error("As senhas não conferem.")
      return
    }
    if (password.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.")
      return
    }
    registerMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
    })
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
          <CardTitle className="text-2xl font-bold">Criar conta</CardTitle>
          <CardDescription>Cadastre-se como cliente ou prestador de serviços</CardDescription>
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
              <Label htmlFor="reg-name">Nome completo</Label>
              <Input
                id="reg-name"
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-email">E-mail</Label>
              <Input
                id="reg-email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-password">Senha</Label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
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

            <div className="space-y-2">
              <Label htmlFor="reg-confirm-password">Confirmar senha</Label>
              <Input
                id="reg-confirm-password"
                type={showPassword ? "text" : "password"}
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={
                registerMutation.isPending ||
                !name.trim() ||
                !email.trim() ||
                !password ||
                !confirmPassword
              }
            >
              {registerMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Criando conta…
                </>
              ) : (
                <>
                  <UserPlus className="size-4" />
                  Criar conta
                </>
              )}
            </Button>
          </CardContent>
        </form>

        <CardFooter className="flex flex-col gap-3 text-center">
          <p className="text-muted-foreground text-sm">
            Já tem conta?{" "}
            <Link
              href="/login"
              className="font-medium text-emerald-600 hover:text-emerald-500 hover:underline"
            >
              Faça login
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
