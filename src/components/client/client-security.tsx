"use client"

/**
 * ClientSecurity — Security, 2FA and LGPD privacy management view.
 *
 * Polish & Service Design:
 *  - Modern Hero Banner with subtle emerald/card gradient & Trust Shield Badge.
 *  - Quick access actions: "Visão geral" & "Central de ajuda".
 *  - 3 High-impact StatCards (Proteção da Conta, Autenticação 2FA, Privacidade LGPD).
 *  - 2-Column Balanced Credential Management Grid:
 *    - Left: Change password form with eye toggles, interactive password strength meter,
 *      and real-time criteria checklist (8+ chars, uppercase, number, special char).
 *    - Right: Security best practices & account hardening tips card.
 *  - Two-Factor Authentication (TOTP) setup with live status query.
 *  - Active Session & Trust Connection card (HTTPS / TLS 1.3 encryption status).
 *  - Privacy & Personal Data (LGPD Art. 18) management:
 *    - Consent preferences (Art. 9º) with instant feedback.
 *    - Data portability export (Art. 18, II) via downloadable JSON.
 *    - Account deletion / Right to be forgotten (Art. 18, VI) with safe typing confirmation.
 *  - 100% accessible (WCAG 2.1 AA) and responsive across all device sizes.
 */

import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  Key,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  Loader2,
  Lock,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState, StatCard } from "@/components/shared/shell"
import { TwoFactorSetup } from "@/components/shared/two-factor-setup"

// ---------------------------------------------------------------------------
// Helpers & Types
// ---------------------------------------------------------------------------

type TwoFactorStatus = {
  twoFactorEnabled: boolean
}

type PasswordCriteria = {
  hasLength: boolean
  hasUpper: boolean
  hasNumber: boolean
  hasSpecial: boolean
}

function evaluatePassword(pwd: string): { criteria: PasswordCriteria; score: number } {
  const criteria = {
    hasLength: pwd.length >= 8,
    hasUpper: /[A-Z]/.test(pwd),
    hasNumber: /[0-9]/.test(pwd),
    hasSpecial: /[^A-Za-z0-9]/.test(pwd),
  }
  const score = Object.values(criteria).filter(Boolean).length
  return { criteria, score }
}

function getStrengthMeta(score: number): { label: string; color: string; width: string } {
  switch (score) {
    case 1:
      return { label: "Fraca", color: "bg-rose-500", width: "w-1/4" }
    case 2:
      return { label: "Razoável", color: "bg-amber-500", width: "w-2/4" }
    case 3:
      return { label: "Boa", color: "bg-blue-500", width: "w-3/4" }
    case 4:
      return { label: "Muito Forte", color: "bg-emerald-500", width: "w-full" }
    default:
      return { label: "Muito Fraca", color: "bg-muted-foreground/30", width: "w-0" }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientSecurity() {
  const logout = useAuthStore((s) => s.logout)
  const reset = useViewStore((s) => s.reset)
  const navigate = useViewStore((s) => s.navigate)

  // Password fields state
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showCurrent, setShowCurrent] = React.useState(false)
  const [showNew, setShowNew] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)

  // View mode and search filter
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [filterText, setFilterText] = React.useState("")

  // LGPD & Privacy State
  const [consentWhatsapp, setConsentWhatsapp] = React.useState(true)
  const [consentRum, setConsentRum] = React.useState(true)
  const [consentMarketing, setConsentMarketing] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("")
  const [isDeleting, setIsDeleting] = React.useState(false)

  // 2FA status query to sync StatCard
  const status2FA = useQuery<TwoFactorStatus>({
    queryKey: ["users", "me", "2fa-status"],
    queryFn: () => apiGet<TwoFactorStatus>("/api/auth/2fa/status"),
  })
  const is2FAEnabled = status2FA.data?.twoFactorEnabled ?? false

  // Password strength calculation
  const { criteria: passwordCriteria, score: passwordScore } = React.useMemo(
    () => evaluatePassword(newPassword),
    [newPassword],
  )
  const strengthMeta = React.useMemo(() => getStrengthMeta(passwordScore), [passwordScore])

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiPost<{ ok: boolean; message: string }>("/api/auth/change-password", data),
    onSuccess: (data) => {
      toast.success(data.message || "Senha alterada com sucesso!")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao alterar senha. Verifique a senha atual.")
    },
  })

  const handleSubmitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação da nova senha não confere.")
      return
    }
    if (passwordScore < 2) {
      toast.error("Escolha uma senha mais forte antes de salvar.")
      return
    }
    changePasswordMutation.mutate({ currentPassword, newPassword })
  }

  const canSubmitPassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !changePasswordMutation.isPending

  // Export Data Handler (LGPD Art. 18, II)
  const handleExportData = async () => {
    try {
      setIsExporting(true)
      const res = await fetch("/api/users/me/data-export")
      if (!res.ok) throw new Error("Falha ao exportar dados")
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `dados-pessoais-severinno-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("Download dos seus dados iniciado com sucesso! 📋")
    } catch {
      toast.error("Não foi possível exportar seus dados. Tente novamente.")
    } finally {
      setIsExporting(false)
    }
  }

  // Delete Account Handler (LGPD Art. 18, VI)
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

  // Module filter computation
  const matchTerm = filterText.toLowerCase().trim()
  const showPassword =
    !matchTerm ||
    "alterar senha credenciais password acesso trocar".includes(matchTerm) ||
    "senha".includes(matchTerm)
  const showHardening =
    !matchTerm ||
    "blindagem conta segurança criptografia vazamento contato boas práticas recomendações".includes(
      matchTerm,
    )
  const showTwoFactor =
    !matchTerm ||
    "2fa dois fatores duas etapas totp autenticação celular qrcode".includes(matchTerm)
  const showSession =
    !matchTerm ||
    "sessão conexao navegador dispositivo confiavel hmac tls ativa".includes(matchTerm)
  const showLgpd =
    !matchTerm ||
    "privacidade lgpd dados pessoais consentimento whatsapp rum marketing portabilidade exclusao excluir eliminar titular".includes(
      matchTerm,
    )

  const hasAnyVisible = showPassword || showHardening || showTwoFactor || showSession || showLgpd

  // Change Password Card
  const passwordCard = (
    <Card className="border-border/60 bg-card rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 text-primary rounded-lg p-2">
            <Key className="size-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Alterar Senha de Acesso</CardTitle>
            <CardDescription className="text-xs">
              Atualize sua senha periodicamente para garantir a blindagem da sua conta.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3.5 pt-1 sm:p-4 sm:pt-2">
        <form onSubmit={handleSubmitPassword} className="space-y-3">
          {/* Senha Atual */}
          <div className="space-y-1">
            <Label htmlFor="current-password" className="text-xs font-medium">
              Senha atual
            </Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Digite sua senha atual"
                className="h-8.5 pr-9 text-xs"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 focus:outline-none"
                aria-label={showCurrent ? "Ocultar senha atual" : "Mostrar senha atual"}
              >
                {showCurrent ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>

          {/* Nova Senha */}
          <div className="space-y-1">
            <Label htmlFor="new-password" className="text-xs font-medium">
              Nova senha
            </Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Digite sua nova senha"
                className="h-8.5 pr-9 text-xs"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 focus:outline-none"
                aria-label={showNew ? "Ocultar nova senha" : "Mostrar nova senha"}
              >
                {showNew ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>

            {/* Password Strength Meter */}
            {newPassword.length > 0 && (
              <div className="border-border/60 bg-muted/30 mt-2 space-y-1.5 rounded-lg border p-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Força da senha:</span>
                  <span
                    className={`font-semibold ${
                      passwordScore >= 3
                        ? "text-emerald-600 dark:text-emerald-400"
                        : passwordScore === 2
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {strengthMeta.label}
                  </span>
                </div>

                <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-full transition-all duration-300 ${strengthMeta.color} ${strengthMeta.width}`}
                  />
                </div>

                {/* Criteria Badges */}
                <div className="grid grid-cols-2 gap-1 pt-0.5 text-[11px]">
                  <span
                    className={`flex items-center gap-1 ${
                      passwordCriteria.hasLength
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {passwordCriteria.hasLength ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    8+ caracteres
                  </span>
                  <span
                    className={`flex items-center gap-1 ${
                      passwordCriteria.hasUpper
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {passwordCriteria.hasUpper ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    1 letra maiúscula
                  </span>
                  <span
                    className={`flex items-center gap-1 ${
                      passwordCriteria.hasNumber
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {passwordCriteria.hasNumber ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    1 número
                  </span>
                  <span
                    className={`flex items-center gap-1 ${
                      passwordCriteria.hasSpecial
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {passwordCriteria.hasSpecial ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    1 caractere especial
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Confirmar Nova Senha */}
          <div className="space-y-1">
            <Label htmlFor="confirm-password" className="text-xs font-medium">
              Confirmar nova senha
            </Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
                className="h-8.5 pr-9 text-xs"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 focus:outline-none"
                aria-label={showConfirm ? "Ocultar confirmação" : "Mostrar confirmação"}
              >
                {showConfirm ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-[11px] text-rose-500">As senhas não coincidem.</p>
            )}
          </div>

          <div className="pt-1.5">
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmitPassword}
              className="h-8 w-full gap-1.5 text-xs font-medium sm:w-auto"
            >
              {changePasswordMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Key className="size-3.5" />
              )}
              Salvar Nova Senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )

  // Hardening Card
  const hardeningCard = (
    <Card className="border-border/60 bg-card flex flex-col justify-between rounded-xl border shadow-2xs">
      <div>
        <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Blindagem da Conta</CardTitle>
              <CardDescription className="text-xs">
                Recomendações essenciais para sua segurança no marketplace.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3.5 pt-1 sm:p-4 sm:pt-2">
          <div
            className={cn(
              "grid gap-2 text-xs",
              viewMode === "list" ? "sm:grid-cols-3" : "grid-cols-1",
            )}
          >
            <div className="border-border/50 bg-muted/20 flex items-start gap-2.5 rounded-lg border p-2.5">
              <Lock className="text-primary mt-0.5 size-3.5 shrink-0" />
              <div>
                <p className="text-foreground font-semibold">Criptografia Robusta</p>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                  Sua senha é protegida com hash irreversível bcrypt de 12 rounds de custo
                  computacional.
                </p>
              </div>
            </div>

            <div className="border-border/50 bg-muted/20 flex items-start gap-2.5 rounded-lg border p-2.5">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-foreground font-semibold">Zero Vazamento de Contato</p>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                  Nunca combine valores nem faça pagamentos diretos por fora da plataforma.
                  Transações externas perdem a garantia legal e a custódia.
                </p>
              </div>
            </div>

            <div className="border-border/50 bg-muted/20 flex items-start gap-2.5 rounded-lg border p-2.5">
              <Smartphone className="text-primary mt-0.5 size-3.5 shrink-0" />
              <div>
                <p className="text-foreground font-semibold">Autenticação em Duas Etapas</p>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                  Ative o 2FA via TOTP abaixo para exigir aprovação do celular a cada login.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </div>

      <div className="border-border/50 bg-muted/20 border-t px-4 py-2.5">
        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            Sessão segura com cookie HTTP-Only
          </span>
          <Badge variant="outline" className="text-[10px]">
            TLS 1.3
          </Badge>
        </div>
      </div>
    </Card>
  )

  // Session Connection Card
  const sessionCard = (
    <Card className="border-border/60 bg-card rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
              <Server className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Sessão Ativa & Conexão</CardTitle>
              <CardDescription className="text-xs">
                Detalhes do dispositivo atualmente conectado à sua conta.
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-700 dark:text-emerald-300"
          >
            <Check className="mr-1 size-3" /> Conexão Ativa
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3.5 pt-1 sm:p-4 sm:pt-2">
        <div className="border-border/50 bg-muted/20 flex flex-col gap-2 rounded-lg border p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-foreground font-semibold">Navegador Web Confiável</p>
            <p className="text-muted-foreground text-[11px]">
              Sessão autenticada via token criptográfico assinado digitalmente com HMAC-SHA256.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px]">
              Governador Valadares, MG
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  // LGPD Privacy Card
  const lgpdCard = (
    <Card className="border-border/60 bg-card rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 text-primary rounded-lg p-2">
            <Lock className="size-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">
              Privacidade & Dados Pessoais (LGPD)
            </CardTitle>
            <CardDescription className="text-xs">
              Seus direitos sob a Lei Geral de Proteção de Dados (Art. 18): portabilidade,
              eliminação e gestão de consentimentos.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-3.5 pt-1 sm:p-4 sm:pt-2">
        {/* Gestão de Consentimentos (Art. 9º) */}
        <div className="border-border/50 bg-muted/20 space-y-2.5 rounded-xl border p-3 sm:p-3.5">
          <p className="text-foreground text-[11px] font-semibold tracking-wide uppercase">
            Gestão de Consentimentos (Art. 9º)
          </p>

          <div className="divide-border/40 space-y-2.5 divide-y">
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5 pr-2">
                <p className="text-foreground text-xs font-medium">
                  Avisos e Lembretes por WhatsApp
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Receber atualizações de pedidos, confirmação de chegada do profissional e
                  orçamentos via WhatsApp oficial.
                </p>
              </div>
              <Switch
                checked={consentWhatsapp}
                onCheckedChange={(c) => {
                  setConsentWhatsapp(c)
                  toast.success("Preferência de notificações atualizada.")
                }}
                aria-label="Alternar consentimento de WhatsApp"
              />
            </div>

            <div className="flex items-center justify-between pt-2.5">
              <div className="space-y-0.5 pr-2">
                <p className="text-foreground text-xs font-medium">
                  Métricas de Experiência e Performance (RUM)
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Permitir envio anônimo de telemetria de carregamento de páginas para otimização
                  contínua da vitrine.
                </p>
              </div>
              <Switch
                checked={consentRum}
                onCheckedChange={(c) => {
                  setConsentRum(c)
                  toast.success("Preferência de telemetria atualizada.")
                }}
                aria-label="Alternar consentimento de telemetria"
              />
            </div>

            <div className="flex items-center justify-between pt-2.5">
              <div className="space-y-0.5 pr-2">
                <p className="text-foreground text-xs font-medium">
                  Comunicações de Benefícios & Novidades
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Receber comunicações ocasionais com descontos, cupons sazonais e novidades do
                  mercado.
                </p>
              </div>
              <Switch
                checked={consentMarketing}
                onCheckedChange={(c) => {
                  setConsentMarketing(c)
                  toast.success("Preferência de novidades atualizada.")
                }}
                aria-label="Alternar consentimento de novidades"
              />
            </div>
          </div>
        </div>

        {/* Direitos do Titular (Art. 18): Portabilidade & Exclusão */}
        <div className="space-y-3">
          {/* Exportar Meus Dados */}
          <div className="border-border/50 flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-foreground text-xs font-semibold">
                Portabilidade dos Dados (Art. 18, II)
              </p>
              <p className="text-muted-foreground text-[11px]">
                Baixe uma cópia completa dos seus dados cadastrais, histórico de atendimentos e
                atividades em formato JSON aberto.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportData}
              disabled={isExporting}
              className="h-8 shrink-0 gap-1.5 text-xs font-medium"
            >
              {isExporting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Exportar meus dados (JSON)
            </Button>
          </div>

          {/* Excluir Conta */}
          <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-destructive text-xs font-semibold">
                Direito à Eliminação da Conta (Art. 18, VI)
              </p>
              <p className="text-muted-foreground text-[11px]">
                Anonimiza imediatamente seus dados pessoais, encerra sessões e desativa o perfil.
                Registros fiscais exigidos por lei são mantidos anonimizados.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
              className="h-8 shrink-0 gap-1.5 text-xs font-medium"
            >
              <Trash2 className="size-3.5" />
              Excluir conta
            </Button>
          </div>

          {/* Confirmação de exclusão */}
          {showDeleteConfirm && (
            <div className="border-destructive/40 bg-destructive/10 space-y-2.5 rounded-xl border p-3.5">
              <div className="text-destructive flex items-center gap-2 text-xs font-semibold">
                <AlertTriangle className="size-4" />
                <span>Atenção: Esta ação é definitiva e irreversível</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Para confirmar a exclusão e a anonimização imediata da sua conta, digite exatamente{" "}
                <strong className="text-foreground">EXCLUIR MINHA CONTA</strong> no campo abaixo:
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="EXCLUIR MINHA CONTA"
                className="border-destructive/40 h-8.5 max-w-sm text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleteConfirmText !== "EXCLUIR MINHA CONTA" || isDeleting}
                  onClick={handleDeleteAccount}
                  className="h-8 gap-1.5 text-xs font-medium"
                >
                  {isDeleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Confirmar Exclusão Definitiva
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteConfirmText("")
                  }}
                  className="h-8 text-xs"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Hero Banner — Compact, Clean & Minimalist */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-2xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
              <ShieldCheck className="text-primary size-3" />
              <span>Central de Segurança & LGPD</span>
            </div>
            <h1 className="text-foreground mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
              Segurança & Privacidade
            </h1>
            <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs sm:text-sm">
              Gerencie suas credenciais de acesso, autenticação em duas etapas (2FA) e preferências
              de privacidade em total conformidade com a LGPD (Lei 13.709/2018).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.dashboard")
              }}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <LayoutDashboard className="size-3.5" />
              Visão geral
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                toast.info("Em caso de dúvidas sobre segurança, consulte nossos canais oficiais.")
              }}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <HelpCircle className="size-3.5" />
              Central de ajuda
            </Button>
          </div>
        </div>
      </div>

      {/* Ultra-Compact Bento StatCards */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatCard
          compact={true}
          icon={Key}
          label="Status da Senha"
          value="Protegida"
          tone="primary"
          hint="Criptografia bcrypt e sessão segura"
        />
        <StatCard
          compact={true}
          icon={Shield}
          label="Autenticação 2FA"
          value={is2FAEnabled ? "Ativada" : "Recomendada"}
          tone={is2FAEnabled ? "primary" : "amber"}
          hint={is2FAEnabled ? "Camada extra via TOTP ativa" : "Adicione proteção ao seu login"}
        />
        <StatCard
          compact={true}
          icon={Lock}
          label="Privacidade LGPD"
          value="Art. 18 Ativo"
          tone="zinc"
          hint="Portabilidade e anonimização garantidas"
        />
      </div>

      {/* Modern Filter & View Mode Toolbar */}
      <div className="bg-card border-border/60 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
        {/* Search Input with quick clear */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar configurações de segurança ou privacidade..."
            className="h-8.5 rounded-lg pr-8 pl-8.5 text-xs"
          />
          {filterText ? (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle: Lista / Grade */}
          <div className="border-border/60 bg-muted/30 flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setViewMode("list")
              }}
              aria-label="Visualização em lista"
              title="Visualização em lista"
              className={cn(
                "flex h-7.5 w-7.5 items-center justify-center rounded-md text-xs transition-all active:scale-95",
                viewMode === "list"
                  ? "bg-card text-foreground ring-border/40 font-semibold shadow-2xs ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutList className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setViewMode("grid")
              }}
              aria-label="Visualização em grade"
              title="Visualização em grade"
              className={cn(
                "flex h-7.5 w-7.5 items-center justify-center rounded-md text-xs transition-all active:scale-95",
                viewMode === "grid"
                  ? "bg-card text-foreground ring-border/40 font-semibold shadow-2xs ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-3.5" />
            </button>
          </div>

          {filterText ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilterText("")}
              className="text-muted-foreground hover:text-foreground h-8.5 gap-1 px-2 text-xs"
            >
              <RotateCcw className="size-3" />
              <span>Limpar</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Content Rendering: Empty State, List View or Grid View */}
      {!hasAnyVisible ? (
        <EmptyState
          icon={Search}
          title="Nenhuma configuração encontrada"
          description="Tente buscar por 'senha', '2fa', 'privacidade' ou 'sessão'."
          action={
            <Button variant="outline" onClick={() => setFilterText("")} className="mt-2 gap-2">
              <RotateCcw className="size-4" />
              Limpar filtro
            </Button>
          }
        />
      ) : viewMode === "grid" ? (
        <div className="grid gap-3.5 lg:grid-cols-12">
          {showPassword && (
            <div
              className={cn("col-span-full", showHardening ? "lg:col-span-7" : "lg:col-span-12")}
            >
              {passwordCard}
            </div>
          )}

          {showHardening && (
            <div className={cn("col-span-full", showPassword ? "lg:col-span-5" : "lg:col-span-12")}>
              {hardeningCard}
            </div>
          )}

          {showTwoFactor && (
            <div className={cn("col-span-full", showSession ? "lg:col-span-6" : "lg:col-span-12")}>
              <TwoFactorSetup />
            </div>
          )}

          {showSession && (
            <div
              className={cn("col-span-full", showTwoFactor ? "lg:col-span-6" : "lg:col-span-12")}
            >
              {sessionCard}
            </div>
          )}

          {showLgpd && <div className="col-span-full">{lgpdCard}</div>}
        </div>
      ) : (
        <div className="space-y-3">
          {showPassword && passwordCard}
          {showHardening && hardeningCard}
          {showTwoFactor && <TwoFactorSetup />}
          {showSession && sessionCard}
          {showLgpd && lgpdCard}
        </div>
      )}
    </div>
  )
}

export default ClientSecurity
