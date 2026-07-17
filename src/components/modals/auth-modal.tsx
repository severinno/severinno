"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type Resolver } from "react-hook-form"
import {
  BadgeCheck,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
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
import { Label } from "@/components/ui/label"
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
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from "@/lib/validators"
import { useUIStore, type AuthModalMode, type AuthModalRole } from "@/store/ui"
import { useAuthStore, type AuthUser } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { cn } from "@/lib/utils"

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
  const [localMode, setLocalMode] = React.useState<AuthModalMode>(mode)
  const [localRole, setLocalRole] = React.useState<AuthModalRole>(role)

  React.useEffect(() => {
    if (open) {
      setLocalMode(mode)
      setLocalRole(role)
    }
  }, [open, mode, role])

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : closeAuth())}>
      <DialogContent className="sm:max-w-md gap-0 p-0 overflow-hidden">
        {/* Header — emerald gradient + brand mark */}
        <div className="relative bg-gradient-to-b from-emerald-50 to-background dark:from-emerald-950/40 px-6 pt-6 pb-4">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Wrench className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground leading-tight">
                  Severinno
                </p>
                <DialogTitle className="text-xl leading-tight">
                  {localMode === "login" ? "Entrar" : "Cadastrar"}
                </DialogTitle>
              </div>
            </div>
            <DialogDescription>
              {localMode === "login"
                ? "Acesse para pedir orçamentos, agendar e acompanhar serviços."
                : "Leva menos de 1 minuto. Sem mensalidade."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <Tabs
          value={localMode}
          onValueChange={(v) => openAuth(v as AuthModalMode, localRole)}
          className="w-full"
        >
          {/* Pill-style toggle */}
          <div className="px-6 pt-1">
            <TabsList className="grid w-full grid-cols-2 h-auto bg-muted/60 p-1 rounded-full">
              <TabsTrigger
                value="login"
                className="rounded-full py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-muted-foreground data-[state=active]:font-medium"
              >
                Entrar
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="rounded-full py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm text-muted-foreground data-[state=active]:font-medium"
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
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

/**
 * Demo credentials surfaced on the login form so first-time visitors can try
 * the platform without registering. Each row exposes a "Copiar" button that
 * copies only the e-mail to the clipboard and fires a sonner toast.
 */
const DEMO_ACCOUNTS: ReadonlyArray<{
  email: string
  password: string
  role: string
}> = [
  { email: "admin@severinno.com", password: "admin123", role: "Administrador" },
  { email: "cliente@severinno.com", password: "cliente123", role: "Cliente" },
  { email: "joao@severinno.com", password: "provider123", role: "Prestador" },
]

function LoginForm({
  onSuccess,
  onSwitchRegister,
}: {
  onSuccess: () => void
  onSwitchRegister: () => void
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
        toast.success("Bem-vindo de volta!")
        navigate(dashboardViewFor(user?.role))
        onSuccess()
      } else {
        const msg = res.error ?? "Não foi possível entrar."
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
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <div className="flex items-center justify-between">
                <FormLabel className="text-sm font-medium">Senha</FormLabel>
                <button
                  type="button"
                  onClick={() =>
                    toast.info(
                      "Recuperação de senha disponível em breve.",
                    )
                  }
                  className="text-xs text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  Esqueci a senha
                </button>
              </div>
              <FormControl>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••"
                    className="h-10 pl-9 pr-9 text-sm"
                    {...field}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? (
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

        <AnimatePresence>
          {formError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-sm text-destructive"
            >
              {formError}
            </motion.p>
          )}
        </AnimatePresence>

        <Button
          type="submit"
          disabled={loading}
          className="mt-1 h-11 w-full bg-emerald-600 hover:bg-emerald-700"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Entrar
        </Button>

        <details className="group -mt-1">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1 text-xs text-muted-foreground transition-colors hover:text-emerald-700 dark:hover:text-emerald-400 [&::-webkit-details-marker]:hidden">
            Ver credenciais de demonstração
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs">
            <p className="mb-2 text-muted-foreground">
              Use estas contas para explorar a plataforma antes de se cadastrar.
            </p>
            <ul className="space-y-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <li
                  key={acc.email}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-foreground">
                      {acc.email}
                    </p>
                    <p className="text-muted-foreground">
                      {acc.password} · {acc.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      void navigator.clipboard?.writeText(acc.email)
                      toast.success("E-mail copiado")
                    }}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-emerald-700 dark:hover:text-emerald-400"
                    aria-label={`Copiar e-mail ${acc.email}`}
                  >
                    <Copy className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>

        <div className="text-center text-sm text-muted-foreground">
          Não tem conta?{" "}
          <button
            type="button"
            onClick={onSwitchRegister}
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
        toast.success("Conta criada! Bem-vindo ao Severinno.")
        const user = useAuthStore.getState().user
        navigate(dashboardViewFor(user?.role))
        onSuccess()
      } else {
        const msg = res.error ?? "Não foi possível criar a conta."
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
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4 p-6 pt-4"
      >
        {/* Role toggle — large selectable cards */}
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-sm font-medium">Tipo de conta</FormLabel>
              <FormControl>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
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
                    ]
                  ).map((opt) => {
                    const active = field.value === opt.value
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onRoleChange(opt.value)
                          field.onChange(opt.value)
                        }}
                        aria-pressed={active}
                        className={cn(
                          "relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left cursor-pointer transition-all",
                          active
                            ? "scale-[1.02] border-solid border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                            : "border-dashed border-input hover:border-primary/40 hover:bg-accent/40",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-6",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span
                          className={cn(
                            "absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
                            active ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden={!active}
                        >
                          <Check className="size-3" />
                        </span>
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {opt.desc}
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
                  <Input
                    placeholder="Seu nome"
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
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-medium">E-mail</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Mínimo 6 caracteres"
                      className="h-10 pl-9 pr-9 text-sm"
                      {...field}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? (
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
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-medium">Confirmar senha</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repita a senha"
                      className="h-10 pl-9 pr-9 text-sm"
                      {...field}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={
                        showConfirmPassword
                          ? "Ocultar senha"
                          : "Mostrar senha"
                      }
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
                      <Input
                        placeholder="000.000.000-00"
                        className="h-10 text-sm"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
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
                      <Input
                        placeholder="(11) 90000-0000"
                        className="h-10 text-sm"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
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
                        placeholder="São Paulo"
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
                        placeholder="SP"
                        className="h-10 text-sm uppercase"
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.value.toUpperCase())
                        }
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
            <span>
              Como prestador, você poderá cadastrar serviços após verificação
              do perfil.
            </span>
          </FormDescription>
        )}

        <AnimatePresence>
          {formError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-sm text-destructive"
            >
              {formError}
            </motion.p>
          )}
        </AnimatePresence>

        <Button
          type="submit"
          disabled={loading}
          className="mt-1 h-11 w-full bg-emerald-600 hover:bg-emerald-700"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Criar conta
        </Button>

        <div className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <button
            type="button"
            onClick={onSwitchLogin}
            className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Entrar
          </button>
        </div>
      </form>
    </Form>
  )
}
