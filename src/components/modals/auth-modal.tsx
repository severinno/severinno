"use client"

import * as React from "react"
import Image from "next/image"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type Resolver } from "react-hook-form"
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from "@/lib/validators"
import { useUIStore, type AuthModalMode, type AuthModalRole } from "@/store/ui"
import { useAuthStore, type AuthUser } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"

/**
 * Resolve the dashboard view for the authenticated user's role.
 */
function dashboardViewFor(role: AuthUser["role"] | undefined): string {
  switch (role) {
    case "ADMIN":
      return "admin.dashboard"
    case "PROVIDER":
      return "provider.dashboard"
    case "CLIENT":
    default:
      return "client.dashboard"
  }
}

export function AuthModal() {
  const open = useUIStore((s) => s.authModal.open)
  const mode = useUIStore((s) => s.authModal.mode)
  const role = useUIStore((s) => s.authModal.role)
  const closeAuth = useUIStore((s) => s.closeAuth)
  const openAuth = useUIStore((s) => s.openAuth)

  // Local mode synced with the store (lets users toggle inside the modal).
  // Adopt store values when opening/changing (adjust state during render).
  const [localMode, setLocalMode] = React.useState<AuthModalMode>(mode)
  const [localRole, setLocalRole] = React.useState<AuthModalRole>(role)
  const [localView, setLocalView] = React.useState<"auth" | "forgot-password">("auth")

  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevMode, setPrevMode] = React.useState(mode)
  const [prevRole, setPrevRole] = React.useState(role)
  if (open && (prevOpen !== open || prevMode !== mode || prevRole !== role)) {
    setPrevOpen(open)
    setPrevMode(mode)
    setPrevRole(role)
    setLocalMode(mode)
    setLocalRole(role)
    setLocalView("auth")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : closeAuth())}>
      <DialogContent
        overlayClassName="bg-black/80 backdrop-blur-md md:bg-black/85"
        className="w-[95vw] gap-0 overflow-hidden rounded-2xl border-slate-200/80 p-0 shadow-2xl sm:max-w-lg md:max-w-3xl lg:max-w-4xl dark:border-slate-800"
      >
        <div className="flex flex-col md:flex-row">
          {/* Painel de Marca e Confiança — Visível em Desktop (Split Layout) */}
          <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-800 via-emerald-900 to-slate-950 p-7 text-white md:flex md:w-5/12">
            <div className="pointer-events-none absolute -top-16 -left-16 size-48 rounded-full bg-emerald-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -right-16 -bottom-16 size-48 rounded-full bg-teal-500/15 blur-3xl" />

            <div className="relative z-10 space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-md shadow-emerald-500/30">
                  <Wrench className="size-5" />
                </div>
                <span className="text-base font-bold tracking-tight text-white">severinno</span>
                <span className="rounded-full border border-emerald-600/40 bg-emerald-700/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                  Governador Valadares
                </span>
              </div>

              <div className="space-y-2">
                <h3 className="text-xl leading-snug font-bold tracking-tight">
                  Serviços e reparos com a segurança que você merece.
                </h3>
                <p className="text-xs leading-relaxed text-emerald-100/80">
                  Conectamos você aos melhores prestadores de Governador Valadares com garantia e
                  acompanhamento em tempo real.
                </p>
              </div>

              <ul className="space-y-3.5 pt-1 text-xs text-emerald-50/90">
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/50 text-emerald-200">
                    <Check className="size-3" />
                  </span>
                  <span>
                    <strong className="block text-white">+26 Prestadores Ativos em GV</strong>
                    Eletricistas, diaristas, encanadores e montadores prontos hoje.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/50 text-emerald-200">
                    <ShieldCheck className="size-3" />
                  </span>
                  <span>
                    <strong className="block text-white">Custódia PIX com Escrow</strong>
                    Pagamento protegido — só liberado com sua aprovação final.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/50 text-emerald-200">
                    <BadgeCheck className="size-3" />
                  </span>
                  <span>
                    <strong className="block text-white">Garantia Severinno de 90 Dias</strong>
                    Suporte humanizado e assistência técnica em todo serviço.
                  </span>
                </li>
              </ul>

              {/* Destaque Visual Clean & Minimalista — Casal com Ferramentas em GV */}
              <div className="relative mt-4 overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-950/60 shadow-xl">
                <div className="relative h-40 w-full sm:h-44">
                  <Image
                    src="/auth-couple-tools.jpg"
                    alt="Casal de profissionais parceiros com ferramentas em Governador Valadares"
                    fill
                    priority
                    sizes="(max-width: 768px) 0vw, 380px"
                    className="object-cover object-[center_20%]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />
                  <div className="absolute right-3 bottom-2.5 left-3 flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1 font-semibold text-white drop-shadow-sm">
                      <Sparkles className="size-3 text-amber-300" />
                      Profissionais em GV
                    </span>
                    <span className="rounded-full bg-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-100 backdrop-blur-md">
                      Verificados
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-6 border-t border-emerald-800/60 pt-5">
              <div className="flex items-center gap-2 text-xs text-emerald-200/90">
                <span className="flex text-amber-300">★ ★ ★ ★ ★</span>
                <span className="font-semibold text-white">4.9 / 5</span>
                <span className="text-[11px] text-emerald-300/70">(3.400+ atendimentos reais)</span>
              </div>
            </div>
          </div>

          {/* Coluna do Formulário */}
          <div className="flex max-h-[90vh] flex-1 flex-col justify-between overflow-y-auto bg-white dark:bg-slate-900">
            {/* Header — clean minimalist brand bar + contextual value banner */}
            <div className="border-b border-slate-100 bg-white px-6 pt-6 pb-4 dark:border-slate-800/80 dark:bg-slate-900">
              <DialogHeader className="space-y-2.5 text-left">
                <div className="flex items-center gap-3">
                  <div className="bg-primary text-primary-foreground inline-flex size-10 items-center justify-center rounded-xl shadow-xs">
                    <Wrench className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Severinno · Governador Valadares
                    </p>
                    <DialogTitle className="text-xl leading-tight font-bold tracking-tight">
                      {localView === "forgot-password"
                        ? "Recuperar senha"
                        : localMode === "login"
                          ? "Entrar na sua conta"
                          : "Criar conta gratuita"}
                    </DialogTitle>
                  </div>
                </div>
                <DialogDescription className="text-xs leading-relaxed">
                  {localView === "forgot-password"
                    ? "Informe seus dados cadastrados para redefinir o acesso."
                    : localMode === "login"
                      ? "Acesse em segundos para concluir seu agendamento ou orçamento com confirmação no WhatsApp."
                      : "Cadastro rápido em menos de 1 minuto. Sem mensalidade para clientes."}
                </DialogDescription>

                {/* Contextual trust pill row */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50">
                    <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                    Custódia PIX Protegida
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <BadgeCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                    Garantia de 90 dias
                  </span>
                </div>
              </DialogHeader>
            </div>

            {localView === "forgot-password" ? (
              <ForgotPasswordForm onBackToLogin={() => setLocalView("auth")} />
            ) : (
              <Tabs
                value={localMode}
                onValueChange={(v) => {
                  triggerHaptic("selection")
                  openAuth(v as AuthModalMode, localRole)
                }}
                className="w-full"
              >
                {/* Segmented toggle */}
                <div className="px-6 pt-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                    <TabsTrigger
                      value="login"
                      className="text-muted-foreground rounded-lg py-2 text-xs font-medium transition-all active:scale-95 data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-slate-900 data-[state=active]:shadow-xs dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-slate-100"
                    >
                      Entrar
                    </TabsTrigger>
                    <TabsTrigger
                      value="register"
                      className="text-muted-foreground rounded-lg py-2 text-xs font-medium transition-all active:scale-95 data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-slate-900 data-[state=active]:shadow-xs dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-slate-100"
                    >
                      Cadastrar
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="login" className="mt-0">
                  <LoginForm
                    onSuccess={() => {
                      closeAuth()
                    }}
                    onSwitchRegister={() => openAuth("register", localRole)}
                    onForgotPassword={() => setLocalView("forgot-password")}
                  />
                </TabsContent>

                <TabsContent value="register" className="mt-0">
                  <RegisterForm
                    role={localRole}
                    onRoleChange={setLocalRole}
                    onSuccess={() => {
                      closeAuth()
                    }}
                    onSwitchLogin={() => openAuth("login", localRole)}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Forgot password form
// ---------------------------------------------------------------------------

function ForgotPasswordForm({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [emailOrPhone, setEmailOrPhone] = React.useState("")
  const [submitted, setSubmitted] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailOrPhone.trim()) {
      triggerHaptic("error")
      toast.error("Por favor, informe seu e-mail ou WhatsApp.")
      return
    }
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setSubmitted(true)
      triggerHaptic("success")
      toast.success("Instruções de recuperação enviadas!")
    }, 500)
  }

  return (
    <div className="space-y-4 p-6 pt-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection")
            onBackToLogin()
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 transition-colors hover:text-emerald-800 active:scale-95 dark:text-emerald-400"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para o login
        </button>
      </div>

      <div className="space-y-1">
        <h3 className="text-foreground text-base font-semibold">Recuperar sua senha</h3>
        <p className="text-muted-foreground text-xs">
          Digite seu e-mail cadastrado ou WhatsApp com DDD para receber o link de redefinição.
        </p>
      </div>

      {submitted ? (
        <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">
            <Check className="size-5" />
          </div>
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            Instruções enviadas com sucesso!
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Se houver uma conta cadastrada para{" "}
            <strong className="text-foreground">{emailOrPhone}</strong>, enviamos um link temporário
            para redefinir sua senha por e-mail e confirmação no WhatsApp.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onBackToLogin()
            }}
            className="mt-2 w-full text-xs transition-all active:scale-95"
          >
            Voltar para o login
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="recovery-input" className="text-foreground text-sm font-medium">
              E-mail ou WhatsApp
            </label>
            <div className="relative">
              <Mail className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id="recovery-input"
                type="text"
                placeholder="voce@exemplo.com ou (33) 99999-9999"
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                className="h-10 pl-9 text-sm"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-xl bg-emerald-600 font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95"
          >
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Enviar instruções de recuperação
          </Button>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

function LoginForm({
  onSuccess,
  onSwitchRegister,
  onForgotPassword,
}: {
  onSuccess: () => void
  onSwitchRegister: () => void
  onForgotPassword: () => void
}) {
  const login = useAuthStore((s) => s.login)
  const navigate = useViewStore((s) => s.navigate)
  const [loading, setLoading] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  const form = useForm<LoginInput>({
    // Cast around Zod 4's `z.coerce.number().optional()` typing, which
    // widens input to `unknown` and breaks Resolver inference.
    resolver: zodResolver(loginSchema) as unknown as Resolver<LoginInput>,
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  })

  const onSubmit = async (values: LoginInput) => {
    setLoading(true)
    setFormError(null)
    try {
      const res = await login(values)
      if (res.ok) {
        // login() already populated the store with the authenticated user.
        const user = useAuthStore.getState().user
        triggerHaptic("success")
        toast.success("Bem-vindo de volta!")
        navigate(dashboardViewFor(user?.role))
        onSuccess()
      } else {
        const msg = res.error ?? "Não foi possível entrar."
        triggerHaptic("error")
        setFormError(msg)
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        autoComplete="off"
        className="grid gap-4 p-6 pt-4"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-sm font-medium">E-mail</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    type="email"
                    autoComplete="off"
                    data-lpignore="true"
                    placeholder="voce@exemplo.com"
                    className="h-10 pl-9 text-sm"
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <div className="flex items-center justify-between">
                <FormLabel className="text-sm font-medium">Senha</FormLabel>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onForgotPassword()
                  }}
                  className="text-xs text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  Esqueci a senha
                </button>
              </div>
              <FormControl>
                <div className="relative">
                  <Lock className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••"
                    className="h-10 pr-9 pl-9 text-sm"
                    {...field}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      triggerHaptic("selection")
                      setShowPassword((v) => !v)
                    }}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />

        {/* Checkbox Lembrar de Mim */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="login-remember-me"
            className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 text-xs select-none"
          >
            <input
              type="checkbox"
              id="login-remember-me"
              defaultChecked
              className="size-3.5 rounded border-slate-300 accent-emerald-600"
            />
            <span>Lembrar de mim neste dispositivo</span>
          </label>
        </div>

        {/* Chips de Acesso Rápido — Demonstração / Dev */}
        <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 p-2.5 dark:border-emerald-800/40 dark:bg-emerald-950/20">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-emerald-800 uppercase dark:text-emerald-300">
              <Sparkles className="size-3 text-emerald-600" />
              Acesso Rápido (Demo)
            </p>
            <span className="text-muted-foreground text-[10px]">Preenchimento com 1 clique</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                form.setValue("email", "cliente@severinno.com", { shouldValidate: true })
                form.setValue("password", "cliente123", { shouldValidate: true })
                toast.success("Credenciais de Cliente Demo preenchidas!")
              }}
              className="h-7 rounded-lg border-emerald-300/80 bg-white text-[11px] font-medium transition-all hover:bg-emerald-50 active:scale-95 dark:border-emerald-800 dark:bg-slate-900 dark:hover:bg-emerald-950/60"
            >
              👤 Cliente
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                form.setValue("email", "mariana.limpeza.gv@severinno.com.br", {
                  shouldValidate: true,
                })
                form.setValue("password", "provider123", { shouldValidate: true })
                toast.success("Credenciais de Prestador Demo (GV) preenchidas!")
              }}
              className="h-7 rounded-lg border-emerald-300/80 bg-white text-[11px] font-medium transition-all hover:bg-emerald-50 active:scale-95 dark:border-emerald-800 dark:bg-slate-900 dark:hover:bg-emerald-950/60"
            >
              🛠️ Prestador
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                form.setValue("email", "admin@severinno.com", { shouldValidate: true })
                form.setValue("password", "admin123", { shouldValidate: true })
                toast.success("Credenciais de Admin Demo preenchidas!")
              }}
              className="h-7 rounded-lg border-emerald-300/80 bg-white text-[11px] font-medium transition-all hover:bg-emerald-50 active:scale-95 dark:border-emerald-800 dark:bg-slate-900 dark:hover:bg-emerald-950/60"
            >
              🛡️ Admin
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {formError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-destructive text-sm"
            >
              {formError}
            </motion.p>
          )}
        </AnimatePresence>

        <Button
          type="submit"
          disabled={loading}
          className="mt-1 h-11 w-full rounded-xl bg-emerald-600 font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Entrar
        </Button>

        <div className="text-muted-foreground text-center text-sm">
          Não tem conta?{" "}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              onSwitchRegister()
            }}
            className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Cadastre-se grátis
          </button>
        </div>
      </form>
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Register form
// ---------------------------------------------------------------------------

function RegisterForm({
  role,
  onRoleChange,
  onSuccess,
  onSwitchLogin,
}: {
  role: AuthModalRole
  onRoleChange: (r: AuthModalRole) => void
  onSuccess: () => void
  onSwitchLogin: () => void
}) {
  const register = useAuthStore((s) => s.register)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const navigate = useViewStore((s) => s.navigate)
  const [loading, setLoading] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)

  const form = useForm<RegisterInput>({
    // Cast around Zod 4's `z.coerce.number().optional()` typing.
    resolver: zodResolver(registerSchema) as unknown as Resolver<RegisterInput>,
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role,
      cpfCnpj: "",
      whatsapp: "",
      city: "",
      state: "",
    },
    mode: "onTouched",
  })

  React.useEffect(() => {
    form.setValue("role", role)
  }, [role, form])

  const onSubmit = async (values: RegisterInput) => {
    setLoading(true)
    setFormError(null)
    try {
      const res = await register(values)
      if (res.ok) {
        await fetchMe()
        triggerHaptic("success")
        toast.success("Conta criada! Bem-vindo ao Severinno.")
        const user = useAuthStore.getState().user
        navigate(dashboardViewFor(user?.role))
        onSuccess()
      } else {
        const msg = res.error ?? "Não foi possível criar a conta."
        triggerHaptic("error")
        setFormError(msg)
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const isProvider = role === "PROVIDER"

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 p-6 pt-4">
        {/* Role toggle — compact horizontal selector */}
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-sm font-medium">Tipo de conta</FormLabel>
              <FormControl>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      value: "CLIENT" as const,
                      label: "Cliente",
                      desc: "Peço serviços",
                      icon: UserRound,
                    },
                    {
                      value: "PROVIDER" as const,
                      label: "Prestador",
                      desc: "Ofereço serviços",
                      icon: ShieldCheck,
                    },
                  ].map((opt) => {
                    const active = field.value === opt.value
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection")
                          onRoleChange(opt.value)
                          field.onChange(opt.value)
                        }}
                        aria-pressed={active}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all active:scale-[0.98]",
                          active
                            ? "border-emerald-600 bg-emerald-50/70 text-emerald-950 shadow-xs ring-1 ring-emerald-600 dark:border-emerald-500 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-500"
                            : "border-input hover:bg-accent/40 border-dashed hover:border-emerald-600/40",
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                            active
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"
                              : "bg-muted/70 text-muted-foreground",
                          )}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-foreground block text-xs leading-tight font-semibold sm:text-sm">
                            {opt.label}
                          </span>
                          <span className="text-muted-foreground block truncate text-[11px] leading-tight sm:text-xs">
                            {opt.desc}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs transition-opacity",
                            active ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden={!active}
                        >
                          <Check className="size-2.5 stroke-[2.5]" />
                        </span>
                      </button>
                    )
                  })}
                </div>
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />

        <Separator className="my-0.5" />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-medium">Nome completo</FormLabel>
                <FormControl>
                  <Input placeholder="Seu nome" className="h-10 text-sm" {...field} />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-medium">E-mail</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Mail className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="voce@exemplo.com"
                      className="h-10 pl-9 text-sm"
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-medium">Senha</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Mínimo 6 caracteres"
                      className="h-10 pr-9 pl-9 text-sm"
                      {...field}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-medium">Confirmar senha</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repita a senha"
                      className="h-10 pr-9 pl-9 text-sm"
                      {...field}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
                      aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        </div>

        <AnimatePresence initial={false} mode="wait">
          {isProvider && (
            <motion.div
              key="provider-fields"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="grid gap-4 overflow-hidden sm:grid-cols-2"
            >
              <FormField
                control={form.control}
                name="cpfCnpj"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-sm font-medium">CPF / CNPJ</FormLabel>
                    <FormControl>
                      <Input placeholder="000.000.000-00" className="h-10 text-sm" {...field} />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">
                      Apenas dígitos ou com pontuação.
                    </p>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="whatsapp"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-sm font-medium">WhatsApp</FormLabel>
                    <FormControl>
                      <Input placeholder="(33) 99100-0000" className="h-10 text-sm" {...field} />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">
                      Clientes usarão para contato direto.
                    </p>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-sm font-medium">Cidade</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Governador Valadares"
                        className="h-10 text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-sm font-medium">UF</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={2}
                        placeholder="MG"
                        className="h-10 text-sm uppercase"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {isProvider && (
          <FormDescription className="flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <BadgeCheck className="size-4 shrink-0 text-emerald-600" />
            <span>Como prestador, você poderá cadastrar serviços após verificação do perfil.</span>
          </FormDescription>
        )}

        <AnimatePresence>
          {formError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-destructive text-sm"
            >
              {formError}
            </motion.p>
          )}
        </AnimatePresence>

        <Button
          type="submit"
          disabled={loading}
          className="mt-1 h-11 w-full rounded-xl bg-emerald-600 font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Criar conta
        </Button>

        <div className="text-muted-foreground text-center text-sm">
          Já tem conta?{" "}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              onSwitchLogin()
            }}
            className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Entrar
          </button>
        </div>
      </form>
    </Form>
  )
}
