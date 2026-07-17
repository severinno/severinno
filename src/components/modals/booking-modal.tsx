"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import {
  CalendarDays,
  CalendarOff,
  Check,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  QrCode,
  ShieldCheck,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { ptBR } from "date-fns/locale"

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
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Calendar } from "@/components/ui/calendar"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import {
  apiGet,
  apiPost,
  type ProviderDetail,
  type ProviderService,
} from "@/lib/api"
import {
  SERVICE_UNIT_LABELS,
  SERVICE_UNIT_SHORT,
  WEEKDAYS_SHORT,
} from "@/lib/constants"
import { formatBRL, formatDate, formatTime } from "@/lib/format"
import { useUIStore } from "@/store/ui"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { useIsMobile } from "@/hooks/use-mobile"
import { AddressForm, type AddressFormValue } from "./address-form"

const STEPS = [
  { id: 1, label: "Data e horário", icon: CalendarDays },
  { id: 2, label: "Detalhes", icon: MapPin },
  { id: 3, label: "Pagamento", icon: Wallet },
] as const

type Step = (typeof STEPS)[number]["id"]

type BookingFormState = {
  date: Date | undefined
  time: string | undefined // "HH:mm"
  quantity: number
  notes: string
  address: AddressFormValue
  paymentMethod: "CARD" | "PIX"
  // mock card
  cardName: string
  cardNumber: string
  cardExpiry: string
  cardCvv: string
}

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

const initialState = (quantity = 1): BookingFormState => ({
  date: undefined,
  time: undefined,
  quantity,
  notes: "",
  address: emptyAddress,
  paymentMethod: "PIX",
  cardName: "",
  cardNumber: "",
  cardExpiry: "",
  cardCvv: "",
})

export function BookingModal() {
  const open = useUIStore((s) => s.bookingModal.open)
  const providerIdPreset = useUIStore((s) => s.bookingModal.providerId)
  const serviceIdPreset = useUIStore((s) => s.bookingModal.serviceId)
  const close = useUIStore((s) => s.closeBooking)
  const openAuth = useUIStore((s) => s.openAuth)
  const isMobile = useIsMobile()
  const navigate = useViewStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)

  const [step, setStep] = React.useState<Step>(1)
  const [state, setState] = React.useState<BookingFormState>(initialState())
  const [submitting, setSubmitting] = React.useState(false)

  // Reset when modal opens.
  React.useEffect(() => {
    if (open) {
      setStep(1)
      setState(initialState())
    }
  }, [open])

  // Fetch provider + services
  const providerQuery = useQuery({
    queryKey: ["provider", providerIdPreset],
    queryFn: () =>
      apiGet<ProviderDetail>(`/api/providers/${providerIdPreset}`),
    enabled: open && !!providerIdPreset,
    staleTime: 60 * 1000,
  })

  const servicesQuery = useQuery({
    queryKey: ["services-by-provider", providerIdPreset],
    queryFn: () =>
      apiGet<ProviderService[]>("/api/services", {
        providerId: providerIdPreset,
      }),
    enabled: open && !!providerIdPreset,
    staleTime: 60 * 1000,
  })

  const provider = providerQuery.data
  const services = servicesQuery.data ?? []
  const selectedService =
    services.find((s) => s.id === serviceIdPreset) ?? services[0]

  // Pre-fill quantity from service default unit
  React.useEffect(() => {
    if (open && selectedService) {
      setState((s) => ({ ...s, quantity: 1 }))
    }
  }, [open, selectedService])

  const set = <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => setState((s) => ({ ...s, [key]: value }))

  // Step validation
  const step1Valid = !!state.date && !!state.time
  const step2Valid =
    !!state.address.cep &&
    state.address.cep.replace(/\D/g, "").length === 8 &&
    !!state.address.street &&
    !!state.address.number &&
    !!state.address.city &&
    !!state.address.state
  const step3Valid =
    state.paymentMethod === "PIX" ||
    (state.paymentMethod === "CARD" &&
      state.cardName.length >= 3 &&
      state.cardNumber.replace(/\s/g, "").length >= 13 &&
      /^\d{2}\/\d{2}$/.test(state.cardExpiry) &&
      /^\d{3,4}$/.test(state.cardCvv))

  const handleNext = () => {
    if (step === 1 && !step1Valid) {
      toast.error("Selecione data e horário para continuar.")
      return
    }
    if (step === 2 && !step2Valid) {
      toast.error("Preencha o endereço completo.")
      return
    }
    setStep((s) => Math.min(3, s + 1) as Step)
  }
  const handleBack = () => setStep((s) => Math.max(1, s - 1) as Step)

  const handleSubmit = async () => {
    if (!user) {
      toast.info("Faça cadastro gratuito para agendar serviços.")
      openAuth("register", "CLIENT")
      return
    }
    if (!provider || !selectedService || !state.date || !state.time) {
      toast.error("Dados incompletos. Revise o agendamento.")
      return
    }
    if (!step3Valid) {
      toast.error("Verifique os dados de pagamento.")
      return
    }

    // Combine date + "HH:mm" into ISO
    const [h, m] = state.time.split(":").map(Number)
    const scheduledAt = new Date(state.date)
    scheduledAt.setHours(h ?? 0, m ?? 0, 0, 0)

    const amount =
      (selectedService.basePrice || 0) * (state.quantity || 1)

    setSubmitting(true)
    try {
      await apiPost("/api/bookings", {
        providerId: provider.id,
        serviceId: selectedService.id,
        scheduledAt: scheduledAt.toISOString(),
        address: [
          state.address.street,
          state.address.number,
          state.address.complement,
          state.address.district,
        ]
          .filter(Boolean)
          .join(", "),
        cep: state.address.cep,
        lat: state.address.lat,
        lng: state.address.lng,
        amount,
        paymentMethod: state.paymentMethod,
        notes: state.notes,
        quantity: state.quantity,
        unit: selectedService.unit,
      })
      toast.success("Agendamento confirmado! Acompanhe em seus agendamentos.")
      close()
      navigate("client.bookings")
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ??
        "Não foi possível concluir o agendamento. Tente novamente."
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const content = (
    <BookingBody
      step={step}
      state={state}
      set={set}
      provider={provider}
      services={services}
      selectedService={selectedService}
      loading={providerQuery.isLoading || servicesQuery.isLoading}
      onNext={handleNext}
      onBack={handleBack}
      onSubmit={handleSubmit}
      submitting={submitting}
      step1Valid={step1Valid}
      step2Valid={step2Valid}
      step3Valid={step3Valid}
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
              <CalendarDays className="size-5 text-emerald-600" />
              Agendar serviço
            </SheetTitle>
            <SheetDescription>
              Escolha data, detalhes e pagamento.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">{content}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="size-5 text-emerald-600" />
            Agendar serviço
          </DialogTitle>
          <DialogDescription>
            Escolha data, detalhes e pagamento.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function BookingBody({
  step,
  state,
  set,
  provider,
  services,
  selectedService,
  loading,
  onNext,
  onBack,
  onSubmit,
  submitting,
  step1Valid,
  step2Valid,
  step3Valid,
}: {
  step: Step
  state: BookingFormState
  set: <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => void
  provider?: ProviderDetail
  services: ProviderService[]
  selectedService?: ProviderService
  loading: boolean
  onNext: () => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
  step1Valid: boolean
  step2Valid: boolean
  step3Valid: boolean
}) {
  const progressPct = (step / 3) * 100

  return (
    <div className="flex h-full flex-col">
      {/* Stepper */}
      <div className="shrink-0 border-b px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const active = step === s.id
            const done = step > s.id
            const Icon = s.icon
            return (
              <React.Fragment key={s.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs sm:text-sm transition-colors",
                    active
                      ? "text-emerald-700 dark:text-emerald-400 font-medium"
                      : done
                        ? "text-emerald-600"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full border-2 transition-colors",
                      active &&
                        "border-emerald-600 bg-emerald-600 text-white",
                      done && "border-emerald-600 bg-emerald-600 text-white",
                      !active && !done && "border-muted-foreground/30",
                    )}
                  >
                    {done ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Icon className="size-3.5" />
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-0.5 bg-muted-foreground/20 mx-2 relative">
                    <div
                      className="absolute inset-0 bg-emerald-600 transition-transform origin-left"
                      style={{
                        transform:
                          step > s.id ? "scaleX(1)" : "scaleX(0)",
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

      {/* Step content */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-emerald-600" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
              >
                {step === 1 && (
                  <Step1Schedule
                    state={state}
                    set={set}
                    availability={provider?.availability ?? []}
                    selectedService={selectedService}
                  />
                )}
                {step === 2 && (
                  <Step2Details
                    state={state}
                    set={set}
                    provider={provider}
                    selectedService={selectedService}
                  />
                )}
                {step === 3 && (
                  <Step3Payment
                    state={state}
                    set={set}
                    selectedService={selectedService}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>

      {/* Footer nav */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={step === 1 || submitting}
            className="text-muted-foreground hover:text-foreground"
          >
            Voltar
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={onNext}
              className="h-11 bg-emerald-600 hover:bg-emerald-700"
              disabled={
                (step === 1 && !step1Valid) ||
                (step === 2 && !step2Valid)
              }
            >
              Continuar
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={submitting || !step3Valid}
              className="h-11 bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <ShieldCheck className="size-4" />
              Confirmar e agendar
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Date & time
// ---------------------------------------------------------------------------

function Step1Schedule({
  state,
  set,
  availability,
  selectedService,
}: {
  state: BookingFormState
  set: <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => void
  availability: ProviderDetail["availability"]
  selectedService?: ProviderService
}) {
  // Generate slot list for selected date
  const slots = React.useMemo(() => {
    if (!state.date) return [] as { label: string; value: string }[]
    const dow = state.date.getDay()
    const dayBlocks = (availability ?? [])
      .filter((a) => a.dayOfWeek === dow)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (dayBlocks.length === 0) return []
    const out: { label: string; value: string }[] = []
    for (const block of dayBlocks) {
      const [sh, sm] = block.startTime.split(":").map(Number)
      const [eh, em] = block.endTime.split(":").map(Number)
      let cur = sh * 60 + sm
      const end = eh * 60 + em
      while (cur + 60 <= end) {
        const h = Math.floor(cur / 60)
        const m = cur % 60
        const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
        out.push({ label: hhmm, value: hhmm })
        cur += 60
      }
    }
    return out
  }, [state.date, availability])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="grid gap-5">
      {selectedService && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Serviço selecionado</p>
          <p className="font-medium">{selectedService.title}</p>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
            {formatBRL(selectedService.basePrice)} /{" "}
            {SERVICE_UNIT_LABELS[selectedService.unit] ?? "un"}
          </p>
        </div>
      )}

      <div className="grid gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <CalendarDays className="size-4 text-emerald-600" />
          Escolha a data
        </h3>
        <div className="flex justify-center">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={state.date}
            onSelect={(d) => {
              set("date", d)
              set("time", undefined)
            }}
            disabled={(d) => d < today}
            className="rounded-md border"
          />
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Clock className="size-4 text-emerald-600" />
          Horário disponível
        </h3>
        {!state.date ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Selecione uma data para ver os horários.
          </p>
        ) : slots.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
            <CalendarOff className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">
              Prestador não atende neste dia
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {WEEKDAYS_SHORT[state.date.getDay()]} — sem expediente.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {slots.map((s) => {
              const active = state.time === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set("time", s.value)}
                  className={cn(
                    "rounded-lg border p-2 text-sm text-center font-medium transition-all",
                    active
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "hover:border-primary/40 hover:bg-accent/40",
                  )}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Details (summary card + address + notes + quantity)
// ---------------------------------------------------------------------------

function Step2Details({
  state,
  set,
  provider,
  selectedService,
}: {
  state: BookingFormState
  set: <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => void
  provider?: ProviderDetail
  selectedService?: ProviderService
}) {
  const scheduledAt =
    state.date && state.time
      ? (() => {
          const d = new Date(state.date)
          const [h, m] = state.time.split(":").map(Number)
          d.setHours(h ?? 0, m ?? 0, 0, 0)
          return d
        })()
      : null

  return (
    <div className="grid gap-5">
      {/* Summary card */}
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-10 rounded-lg">
            {provider?.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {provider?.name?.[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{provider?.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {selectedService?.title}
            </p>
          </div>
        </div>
        <Separator className="my-3" />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Data</p>
            <p className="font-medium">
              {scheduledAt ? formatDate(scheduledAt) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Horário</p>
            <p className="font-medium">
              {scheduledAt ? formatTime(scheduledAt) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valor base</p>
            <p className="font-medium text-emerald-700 dark:text-emerald-400">
              {selectedService
                ? formatBRL(selectedService.basePrice)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Unidade</p>
            <p className="font-medium">
              {selectedService
                ? SERVICE_UNIT_LABELS[selectedService.unit]
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Quantity */}
      {selectedService && (
        <div className="grid gap-1.5">
          <Label htmlFor="qty">Quantidade ({SERVICE_UNIT_SHORT[selectedService.unit]})</Label>
          <Input
            id="qty"
            type="number"
            min={1}
            step={1}
            value={state.quantity}
            onChange={(e) => set("quantity", Number(e.target.value) || 1)}
          />
          <p className="text-xs text-muted-foreground">
            Total estimado:{" "}
            <strong className="text-emerald-700 dark:text-emerald-400">
              {formatBRL(
                (selectedService.basePrice || 0) * (state.quantity || 1),
              )}
            </strong>
          </p>
        </div>
      )}

      <Separator />

      {/* Address */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MapPin className="size-4 text-emerald-600" />
          Endereço do serviço
        </h3>
        <AddressForm
          value={state.address}
          onChange={(v) => set("address", v)}
        />
      </div>

      <Separator />

      {/* Notes */}
      <div className="grid gap-1.5">
        <Label htmlFor="notes">Observações (opcional)</Label>
        <Textarea
          id="notes"
          placeholder="Detalhes que ajudem o prestador: portão, vaga, problemas específicos..."
          rows={3}
          value={state.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Payment
// ---------------------------------------------------------------------------

function Step3Payment({
  state,
  set,
  selectedService,
}: {
  state: BookingFormState
  set: <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => void
  selectedService?: ProviderService
}) {
  const amount =
    (selectedService?.basePrice ?? 0) * (state.quantity || 1)
  const fees = 0
  const total = amount + fees
  const [paid, setPaid] = React.useState(false)

  return (
    <div className="grid gap-5">
      {/* Amount summary */}
      <div className="rounded-lg border bg-muted/30 p-3 sm:p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectedService?.title} × {state.quantity}
          </span>
          <span className="font-medium">{formatBRL(amount)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Taxa de serviço</span>
          <span className="font-medium">{formatBRL(fees)}</span>
        </div>
        <Separator className="my-2" />
        <div className="flex items-center justify-between">
          <span className="font-medium">Total</span>
          <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {formatBRL(total)}
          </span>
        </div>
      </div>

      {/* Payment method */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">Forma de pagamento</h3>
        <RadioGroup
          value={state.paymentMethod}
          onValueChange={(v) => set("paymentMethod", v as "CARD" | "PIX")}
          className="grid grid-cols-2 gap-2"
        >
          <PaymentOption
            value="PIX"
            title="PIX"
            description="Aprovação imediata"
            icon={QrCode}
            selected={state.paymentMethod === "PIX"}
          />
          <PaymentOption
            value="CARD"
            title="Cartão"
            description="Crédito"
            icon={CreditCard}
            selected={state.paymentMethod === "CARD"}
          />
        </RadioGroup>
      </div>

      {/* Payment details */}
      {state.paymentMethod === "CARD" ? (
        <div className="grid gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Dados do cartão</p>
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              Demonstração — não processa pagamento real
            </Badge>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cardName">Nome impresso</Label>
            <Input
              id="cardName"
              placeholder="NOME COMO NO CARTÃO"
              value={state.cardName}
              onChange={(e) => set("cardName", e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cardNumber">Número</Label>
            <Input
              id="cardNumber"
              inputMode="numeric"
              placeholder="0000 0000 0000 0000"
              value={state.cardNumber}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 16)
                const parts = digits.match(/.{1,4}/g)
                set("cardNumber", parts ? parts.join(" ") : "")
              }}
            />
            <p className="text-xs text-muted-foreground">
              Formato: 4 grupos de 4 dígitos.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cardExpiry">Validade</Label>
              <Input
                id="cardExpiry"
                inputMode="numeric"
                placeholder="MM/AA"
                maxLength={5}
                value={state.cardExpiry}
                onChange={(e) => {
                  let v = e.target.value.replace(/\D/g, "").slice(0, 4)
                  if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`
                  set("cardExpiry", v)
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cardCvv">CVV</Label>
              <Input
                id="cardCvv"
                inputMode="numeric"
                placeholder="123"
                maxLength={4}
                value={state.cardCvv}
                onChange={(e) =>
                  set(
                    "cardCvv",
                    e.target.value.replace(/\D/g, "").slice(0, 4),
                  )
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <ShieldCheck className="size-3.5 mt-0.5 text-emerald-600" />
            Ambiente de demonstração — não use dados reais. Nenhum pagamento
            será efetivado.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">Pague com PIX</p>
          <div className="flex flex-col items-center gap-3 py-3">
            <div className="rounded-lg bg-slate-100 p-8 text-center dark:bg-slate-800/50">
              <QrCode className="size-24 text-slate-500 dark:text-slate-300" />
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Escaneie o QR code ou copie a chave abaixo para pagar.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  .writeText("severinno@exemplo.com")
                  .catch(() => {})
                toast.success("Chave PIX copiada!")
              }}
            >
              Copiar chave PIX
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            onClick={() => {
              setPaid(true)
              toast.success("Pagamento confirmado. Conclua o agendamento.")
            }}
            disabled={paid}
          >
            {paid ? (
              <>
                <Check className="size-4" /> Pagamento confirmado
              </>
            ) : (
              "Já paguei"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function PaymentOption({
  value,
  title,
  description,
  icon: Icon,
  selected,
}: {
  value: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  selected: boolean
}) {
  return (
    <Label
      htmlFor={`pay-${value}`}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <RadioGroupItem value={value} id={`pay-${value}`} className="sr-only" />
      <Icon
        className={cn(
          "size-5",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {selected && <Check className="size-4 text-primary" />}
    </Label>
  )
}
