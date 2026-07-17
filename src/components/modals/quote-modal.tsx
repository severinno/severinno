"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion, AnimatePresence } from "framer-motion"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  LogIn,
  MapPin,
  Pencil,
  Send,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import {
  apiGet,
  apiPost,
  type ProviderCard,
  type ProviderService,
  type PagedResult,
  type ServiceUnit,
} from "@/lib/api"
import {
  SERVICE_UNITS,
  SERVICE_UNIT_LABELS,
  SERVICE_UNIT_SHORT,
} from "@/lib/constants"
import { useUIStore } from "@/store/ui"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { useIsMobile } from "@/hooks/use-mobile"
import { AddressForm, type AddressFormValue } from "./address-form"
import { FilePhotos } from "./file-photos"

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, label: "Serviço" },
  { id: 2, label: "Detalhes" },
  { id: 3, label: "Endereço" },
  { id: 4, label: "Revisão" },
] as const

type Step = (typeof STEPS)[number]["id"]

// ---------------------------------------------------------------------------
// Form model — extends the API payload with per-item providerId
// ---------------------------------------------------------------------------

type QuoteItemForm = {
  providerId: string
  serviceId: string
  description: string
  quantity: number
  unit: ServiceUnit
  photos: string[]
}

const quoteFormSchema = z.object({
  items: z
    .array(
      z.object({
        providerId: z.string().min(1, "Selecione um prestador"),
        serviceId: z.string().min(1, "Selecione um serviço"),
        description: z
          .string()
          .min(10, "Descreva com ao menos 10 caracteres")
          .max(400),
        quantity: z.coerce.number().min(0.01, "Quantidade inválida"),
        unit: z.enum([
          "UNIDADE",
          "METRO_LINEAR",
          "METRO_QUADRADO",
          "METRO_CUBICO",
        ]),
        photos: z.array(z.string()).max(4).default([]),
      }),
    )
    .min(1, "Adicione ao menos um item"),
  address: z.object({
    cep: z.string().min(8, "CEP inválido"),
    street: z.string().min(3, "Informe a rua"),
    number: z.string().min(1, "Informe o número"),
    complement: z.string().default(""),
    district: z.string().default(""),
    city: z.string().min(2, "Informe a cidade"),
    state: z.string().min(2, "UF"),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
  }),
})

type QuoteFormValues = z.infer<typeof quoteFormSchema>

const emptyItem = (
  providerId?: string,
  serviceId?: string,
  unit: ServiceUnit = "UNIDADE",
): QuoteItemForm => ({
  providerId: providerId ?? "",
  serviceId: serviceId ?? "",
  description: "",
  quantity: 1,
  unit,
  photos: [],
})

const emptyAddress: AddressFormValue = {
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  lat: null,
  lng: null,
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function QuoteModal() {
  const open = useUIStore((s) => s.quoteModal.open)
  const providerIdPreset = useUIStore((s) => s.quoteModal.providerId)
  const serviceIdPreset = useUIStore((s) => s.quoteModal.serviceId)
  const close = useUIStore((s) => s.closeQuote)
  const openAuth = useUIStore((s) => s.openAuth)
  const isMobile = useIsMobile()

  const navigate = useViewStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)

  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema) as unknown as Resolver<QuoteFormValues>,
    defaultValues: {
      items: [emptyItem(providerIdPreset, serviceIdPreset)],
      address: emptyAddress,
    },
    mode: "onTouched",
  })

  // Reset preset when modal opens.
  React.useEffect(() => {
    if (open) {
      form.reset({
        items: [emptyItem(providerIdPreset, serviceIdPreset)],
        address: emptyAddress,
      })
      setStep(1)
    }
  }, [open, providerIdPreset, serviceIdPreset, form])

  const [step, setStep] = React.useState<Step>(1)
  const [submitting, setSubmitting] = React.useState(false)

  const onSubmit = async (values: QuoteFormValues) => {
    if (!user) {
      toast.info("Faça cadastro gratuito para pedir orçamentos.")
      openAuth("register", "CLIENT")
      return
    }

    const primary = values.items[0]
    if (!primary?.providerId) {
      toast.error("Selecione um prestador no primeiro item.")
      return
    }

    setSubmitting(true)
    try {
      await apiPost("/api/quotes", {
        providerId: primary.providerId,
        items: values.items.map((it) => ({
          providerId: it.providerId,
          serviceId: it.serviceId,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          photos: it.photos,
        })),
        address: [
          values.address.street,
          values.address.number,
          values.address.complement,
          values.address.district,
        ]
          .filter(Boolean)
          .join(", "),
        cep: values.address.cep,
        lat: values.address.lat,
        lng: values.address.lng,
      })
      toast.success("Orçamento enviado! O prestador responderá em breve.")
      close()
      navigate("client.quotes")
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ??
        "Não foi possível enviar o orçamento. Tente novamente."
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const content = (
    <WizardBody
      step={step}
      setStep={setStep}
      form={form}
      submitting={submitting}
      onSubmit={form.handleSubmit(onSubmit)}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent
          side="bottom"
          className="h-[100dvh] max-h-[100dvh] w-full p-0 sm:max-w-full gap-0 flex flex-col"
        >
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <Wrench className="size-5 text-emerald-600" />
              Pedir orçamento
            </SheetTitle>
            <SheetDescription>
              Descreva o serviço e receba propostas de prestadores verificados.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">{content}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Wrench className="size-5 text-emerald-600" />
            Pedir orçamento
          </DialogTitle>
          <DialogDescription>
            Descreva o serviço e receba propostas de prestadores verificados.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Wizard body — stepper + step content + footer nav
// ---------------------------------------------------------------------------

function WizardBody({
  step,
  setStep,
  form,
  submitting,
  onSubmit,
}: {
  step: Step
  setStep: React.Dispatch<React.SetStateAction<Step>>
  form: UseFormReturn<QuoteFormValues>
  submitting: boolean
  onSubmit: () => void
}) {
  const items = form.watch("items")
  const address = form.watch("address")
  const errors = form.formState.errors
  const user = useAuthStore((s) => s.user)
  const openAuth = useUIStore((s) => s.openAuth)

  // ── Step validation ───────────────────────────────────────────────────
  const item0 = items[0]
  const item0Errors = errors.items?.[0]

  const step1Valid = !!item0?.providerId && !!item0?.serviceId
  const step2Valid =
    !!item0?.description && item0.description.length >= 10 && item0?.quantity > 0
  const step3Valid =
    !!address.cep && address.cep.replace(/\D/g, "").length >= 8 &&
    !!address.street && !!address.number && !!address.city && !!address.state

  const stepValidMap: Record<Step, boolean> = {
    1: step1Valid,
    2: step2Valid,
    3: step3Valid,
    4: true, // review step always valid (shows summary)
  }

  const progressPct = (step / 4) * 100

  // ── Navigation ────────────────────────────────────────────────────────
  const handleNext = () => {
    // Validate current step before advancing
    if (step === 1 && !step1Valid) {
      form.trigger("items.0.providerId")
      form.trigger("items.0.serviceId")
      return
    }
    if (step === 2 && !step2Valid) {
      form.trigger("items.0.description")
      form.trigger("items.0.quantity")
      return
    }
    if (step === 3 && !step3Valid) {
      form.trigger("address")
      return
    }
    setStep((s) => Math.min(4, s + 1) as Step)
  }

  const handleBack = () => setStep((s) => Math.max(1, s - 1) as Step)

  const goToStep = (target: Step) => {
    // Allow going back to any previous step freely
    if (target < step) {
      setStep(target)
      return
    }
    // Going forward requires all intermediate steps to be valid
    for (let i = 1; i < target; i++) {
      if (!stepValidMap[i as Step]) {
        toast.error("Complete os passos anteriores primeiro.")
        return
      }
    }
    setStep(target)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Stepper */}
      <div className="shrink-0 border-b px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const active = step === s.id
            const done = step > s.id
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => goToStep(s.id)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs sm:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
                    active
                      ? "text-emerald-700 dark:text-emerald-400 font-medium"
                      : done
                        ? "text-emerald-600 cursor-pointer"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                      active && "border-emerald-600 bg-emerald-600 text-white",
                      done && "border-emerald-600 bg-emerald-600 text-white cursor-pointer",
                      !active && !done && "border-muted-foreground/30 text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : s.id}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-0.5 bg-muted-foreground/20 mx-1.5 sm:mx-2 relative">
                    <div
                      className="absolute inset-0 bg-emerald-600 transition-transform origin-left"
                      style={{
                        transform: step > s.id ? "scaleX(1)" : "scaleX(0)",
                      }}
                    />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
        <Progress
          value={progressPct}
          className="mt-2 h-1 bg-emerald-100 dark:bg-emerald-950/40"
        />
      </div>

      {/* Auth gate — shown on Step 1 */}
      {step === 1 && !user && (
        <div className="shrink-0 px-4 sm:px-6 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <LogIn className="size-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Faça cadastro gratuito para pedir orçamentos
              </p>
              <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
                Seus dados ficam salvos para acompanhar as respostas dos
                prestadores.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => openAuth("register", "CLIENT")}
              className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
            >
              Entrar / Cadastrar
            </Button>
          </div>
        </div>
      )}

      {/* Step content */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
            >
              {step === 1 && (
                <Step1Service form={form} />
              )}
              {step === 2 && (
                <Step2Details form={form} />
              )}
              {step === 3 && (
                <Step3Address form={form} />
              )}
              {step === 4 && (
                <Step4Review
                  form={form}
                  goToStep={goToStep}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Sticky footer nav */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleBack}
            disabled={step === 1 || submitting}
            className="text-muted-foreground hover:text-foreground"
          >
            Voltar
          </Button>
          {step < 4 ? (
            <Button
              type="button"
              onClick={handleNext}
              className="h-11 bg-emerald-600 hover:bg-emerald-700"
              disabled={!stepValidMap[step]}
            >
              Continuar
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="h-11 bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <Send className="size-4" />
              Enviar orçamento
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Serviço (Service Selection)
// ---------------------------------------------------------------------------

function Step1Service({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const item = form.watch("items.0")
  const error = form.formState.errors.items?.[0]

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-semibold">Qual serviço você precisa?</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Escolha o prestador e o tipo de serviço desejado.
        </p>
      </div>

      <ProviderCombobox
        value={item?.providerId ?? ""}
        onChange={(providerId) =>
          form.setValue(
            "items.0",
            { ...item, providerId, serviceId: "" },
            { shouldDirty: true, shouldValidate: true },
          )
        }
        error={error?.providerId?.message}
      />

      <ServiceSelect
        providerId={item?.providerId ?? ""}
        value={item?.serviceId ?? ""}
        onChange={(service) =>
          form.setValue(
            "items.0",
            {
              ...item,
              serviceId: service.id,
              unit: service.unit,
            },
            { shouldDirty: true, shouldValidate: true },
          )
        }
        error={error?.serviceId?.message}
      />

      {/* Selected service info card */}
      <ServiceInfoCard providerId={item?.providerId ?? ""} serviceId={item?.serviceId ?? ""} />
    </div>
  )
}

/** Compact info card showing selected service details */
function ServiceInfoCard({ providerId, serviceId }: { providerId: string; serviceId: string }) {
  const { data: services } = useQuery({
    queryKey: ["services-by-provider", providerId],
    queryFn: () =>
      apiGet<ProviderService[]>("/api/services", { providerId }),
    enabled: !!providerId,
    staleTime: 30 * 1000,
  })

  const selected = services?.find((s) => s.id === serviceId)

  if (!selected) return null

  return (
    <div className="rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 truncate">
            {selected.title}
          </p>
          {selected.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {selected.description}
            </p>
          )}
        </div>
        <Badge variant="outline" className="shrink-0 border-emerald-500 text-emerald-700 text-xs">
          {selected.basePrice.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })}
          /{SERVICE_UNIT_SHORT[selected.unit]}
        </Badge>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Detalhes (Service Details)
// ---------------------------------------------------------------------------

function Step2Details({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const item = form.watch("items.0")
  const error = form.formState.errors.items?.[0]
  const descLen = item?.description?.length ?? 0

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-semibold">Descreva o serviço</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Quanto mais detalhes, mais preciso será o orçamento.
        </p>
      </div>

      {/* Description */}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="item-0-desc">Descrição do serviço</Label>
          <span className={cn(
            "text-xs tabular-nums",
            descLen < 10 ? "text-destructive" : "text-muted-foreground",
          )}>
            {descLen}/400
          </span>
        </div>
        <Textarea
          id="item-0-desc"
          placeholder="Ex.: Instalar tomada na parede da sala, fio visível. Preciso de 3 pontos novos."
          value={item?.description ?? ""}
          onChange={(e) =>
            form.setValue("items.0.description", e.target.value, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          rows={3}
          maxLength={400}
          aria-invalid={!!error?.description}
        />
        {error?.description && (
          <p className="text-xs text-destructive">{error.description.message}</p>
        )}
      </div>

      {/* Quantity + unit */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="item-0-qty">Quantidade</Label>
          <Input
            id="item-0-qty"
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            value={item?.quantity ?? 1}
            onChange={(e) =>
              form.setValue("items.0.quantity", Number(e.target.value), {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            aria-invalid={!!error?.quantity}
          />
          {error?.quantity && (
            <p className="text-xs text-destructive">{error.quantity.message}</p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label>Unidade</Label>
          <Select
            value={item?.unit ?? "UNIDADE"}
            onValueChange={(v) =>
              form.setValue("items.0.unit", v as ServiceUnit, {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {SERVICE_UNIT_LABELS[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Photos */}
      <FilePhotos
        value={item?.photos ?? []}
        onChange={(photos) =>
          form.setValue("items.0.photos", photos, { shouldDirty: true })
        }
        max={4}
        label="Fotos do serviço"
        hint="Envie até 4 imagens para ajudar o prestador a entender o serviço (5 MB cada)."
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Endereço (Service Location)
// ---------------------------------------------------------------------------

function Step3Address({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const address = form.watch("address")
  const errors = form.formState.errors.address

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-semibold">Onde será o serviço?</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Informe o endereço ou use sua localização para preencher automaticamente.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <AddressForm
          value={address}
          onChange={(v) => form.setValue("address", v, { shouldDirty: true })}
          errors={{
            cep: errors?.cep?.message,
            street: errors?.street?.message,
            number: errors?.number?.message,
            city: errors?.city?.message,
            state: errors?.state?.message,
          }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Revisão (Review & Send)
// ---------------------------------------------------------------------------

function Step4Review({
  form,
  goToStep,
}: {
  form: UseFormReturn<QuoteFormValues>
  goToStep: (s: Step) => void
}) {
  const item = form.watch("items.0")
  const address = form.watch("address")

  // Resolve provider and service names
  const { data: providerData } = useQuery({
    queryKey: ["providers-options", ""],
    queryFn: () =>
      apiGet<PagedResult<ProviderCard>>("/api/providers", { limit: 20 }),
    staleTime: 30 * 1000,
  })

  const { data: services } = useQuery({
    queryKey: ["services-by-provider", item?.providerId],
    queryFn: () =>
      apiGet<ProviderService[]>("/api/services", { providerId: item?.providerId }),
    enabled: !!item?.providerId,
    staleTime: 30 * 1000,
  })

  const providerName = providerData?.items?.find((p) => p.id === item?.providerId)?.name ?? "—"
  const serviceTitle = services?.find((s) => s.id === item?.serviceId)?.title ?? "—"

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-sm font-semibold">Revise seu pedido</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Verifique as informações antes de enviar.
        </p>
      </div>

      {/* Service section */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Serviço
          </h4>
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium"
          >
            <Pencil className="size-3" />
            Editar
          </button>
        </div>
        <p className="text-sm font-medium">{providerName}</p>
        <p className="text-sm text-muted-foreground">{serviceTitle}</p>
      </div>

      {/* Details section */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Detalhes
          </h4>
          <button
            type="button"
            onClick={() => goToStep(2)}
            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium"
          >
            <Pencil className="size-3" />
            Editar
          </button>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {item?.description || "—"}
        </p>
        <div className="flex items-center gap-3 mt-2">
          <Badge variant="secondary">
            {item?.quantity ?? 0} {item?.unit ? SERVICE_UNIT_SHORT[item.unit] : "un"}
          </Badge>
          {item?.photos && item.photos.length > 0 && (
            <Badge variant="secondary">
              {item.photos.length} foto(s)
            </Badge>
          )}
        </div>
        {/* Photo thumbnails */}
        {item?.photos && item.photos.length > 0 && (
          <div className="flex gap-2 mt-3">
            {item.photos.map((url, i) => (
              <div
                key={url + i}
                className="size-12 overflow-hidden rounded-md border bg-muted"
              >
                <img
                  src={url}
                  alt={`Foto ${i + 1}`}
                  className="size-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Address section */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Endereço
          </h4>
          <button
            type="button"
            onClick={() => goToStep(3)}
            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium"
          >
            <Pencil className="size-3" />
            Editar
          </button>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <span className="text-muted-foreground">
            {address.street
              ? `${address.street}, ${address.number}${
                  address.complement ? ` - ${address.complement}` : ""
                }${address.district ? ` · ${address.district}` : ""}`
              : "—"}
            {address.city ? ` · ${address.city}/${address.state}` : ""}
          </span>
        </div>
      </div>

      {/* "What happens next?" mini-timeline */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-3">
          O que acontece agora?
        </h4>
        <div className="grid gap-2.5">
          {[
            { label: "Enviado", desc: "Seu pedido chega ao prestador" },
            { label: "Prestador responde", desc: "Ele envia valor e prazo" },
            { label: "Você aprova", desc: "Aceite a proposta ou negocie" },
            { label: "Agende", desc: "Combine data e horário" },
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div>
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider combobox (async search)
// ---------------------------------------------------------------------------

function ProviderCombobox({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (providerId: string) => void
  error?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["providers-options", query],
    queryFn: () =>
      apiGet<PagedResult<ProviderCard>>("/api/providers", {
        q: query || undefined,
        limit: 20,
      }),
    staleTime: 30 * 1000,
  })

  const providers = data?.items ?? []
  const selected = providers.find((p) => p.id === value)

  return (
    <div className="grid gap-1.5">
      <Label>Prestador</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {selected ? (
                <>
                  <span className="truncate">{selected.name}</span>
                  {selected.verified && (
                    <Badge variant="outline" className="border-emerald-500 text-emerald-700 text-[10px]">
                      Verificado
                    </Badge>
                  )}
                </>
              ) : (
                "Selecionar prestador"
              )}
            </span>
            <ChevronDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nome ou serviço..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Buscando..." : "Nenhum prestador encontrado."}
              </CommandEmpty>
              <CommandGroup>
                {providers.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange(p.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        value === p.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.city ?? "—"}
                        {p.services?.[0]?.title
                          ? ` · ${p.services[0].title}`
                          : ""}
                      </p>
                    </div>
                    {p.verified && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500 text-emerald-700 text-[10px] ml-2"
                      >
                        Verificado
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Service select (depends on chosen provider)
// ---------------------------------------------------------------------------

function ServiceSelect({
  providerId,
  value,
  onChange,
  error,
}: {
  providerId: string
  value: string
  onChange: (service: ProviderService) => void
  error?: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["services-by-provider", providerId],
    queryFn: () =>
      apiGet<ProviderService[]>("/api/services", { providerId }),
    enabled: !!providerId,
    staleTime: 30 * 1000,
  })

  const services = data ?? []
  const selected = services.find((s) => s.id === value)

  return (
    <div className="grid gap-1.5">
      <Label>Serviço</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          const s = services.find((x) => x.id === v)
          if (s) onChange(s)
        }}
        disabled={!providerId}
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={
              !providerId
                ? "Selecione um prestador primeiro"
                : isLoading
                  ? "Carregando..."
                  : "Selecionar serviço"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {services.length === 0 && !isLoading && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Nenhum serviço disponível.
            </div>
          )}
          {services.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className="flex items-center justify-between gap-2 w-full">
                <span className="truncate">{s.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.basePrice.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                  /{SERVICE_UNIT_SHORT[s.unit]}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {selected.description ?? "—"}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
