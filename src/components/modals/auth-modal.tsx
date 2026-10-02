"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type Resolver } from "react-hook-form"
import {
  BadgeCheck,
  Check,
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

  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevMode, setPrevMode] = React.useState(mode)
  const [prevRole, setPrevRole] = React.useState(role)
  if (open && (prevOpen !== open || prevMode !== mode || prevRole !== role)) {
    setPrevOpen(open)
    setPrevMode(mode)
    setPrevRole(role)
    setLocalMode(mode)
    setLocalRole(role)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : closeAuth())}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* Header — emerald gradient + brand mark */}
        <div className="to-background relative bg-gradient-to-b from-emerald-50 px-6 pt-6 pb-4 dark:from-emerald-950/40">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="bg-primary text-primary-foreground inline-flex size-9 items-center justify-center rounded-xl shadow-sm">
                <Wrench className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-xs leading-tight font-medium">Severinno</p>
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
            <TabsList className="bg-muted/60 grid h-auto w-full grid-cols-2 rounded-full p-1">
              <TabsTrigger
                value="login"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground rounded-full py-1.5 data-[state=active]:font-medium data-[state=active]:shadow-sm"
              >
                Entrar
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground rounded-full py-1.5 data-[state=active]:font-medium data-[state=active]:shadow-sm"
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 p-6 pt-4">
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <div className="flex items-center justify-between">
                <FormLabel className="text-sm font-medium">Senha</FormLabel>
                <button
                  type="button"
                  onClick={() => toast.info("Recuperação de senha disponível em breve.")}
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
          className="mt-1 h-11 w-full bg-emerald-600 hover:bg-emerald-700"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Entrar
        </Button>

        <div className="text-muted-foreground text-center text-sm">
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 p-6 pt-4">
        {/* Role toggle — large selectable cards */}
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
                          onRoleChange(opt.value)
                          field.onChange(opt.value)
                        }}
                        aria-pressed={active}
                        className={cn(
                          "relative flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
                          active
                            ? "border-primary bg-primary/5 ring-primary scale-[1.02] border-solid shadow-sm ring-1"
                            : "border-input hover:border-primary/40 hover:bg-accent/40 border-dashed",
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
                            "bg-primary text-primary-foreground absolute top-2 right-2 inline-flex size-5 items-center justify-center rounded-full transition-opacity",
                            active ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden={!active}
                        >
                          <Check className="size-3" />
                        </span>
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-muted-foreground text-xs">{opt.desc}</span>
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
                      <Input placeholder="(11) 90000-0000" className="h-10 text-sm" {...field} />
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
                      <Input placeholder="São Paulo" className="h-10 text-sm" {...field} />
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
          className="mt-1 h-11 w-full bg-emerald-600 hover:bg-emerald-700"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Criar conta
        </Button>

        <div className="text-muted-foreground text-center text-sm">
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
