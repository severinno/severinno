"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import {
  CalendarDays,
  CalendarOff,
  Check,
  CheckCircle2,
  CircleDot,
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
import { formatBRL, formatDate, formatHHmm } from "@/lib/format"
import { useUIStore } from "@/store/ui"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { useIsMobile } from "@/hooks/use-mobile"
import { AddressForm, type AddressFormValue } from "./address-form"

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, label: "Agenda", icon: CalendarDays },
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

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function cardNameValid(v: string) {
  return v.trim().length >= 3
}
function cardNumberValid(v: string) {
  return v.replace(/\s/g, "").length >= 13
}
function cardExpiryValid(v: string) {
  return /^\d{2}\/\d{2}$/.test(v)
}
function cardCvvValid(v: string) {
  return /^\d{3,4}$/.test(v)
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

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
  const [touched, setTouched] = React.useState<Set<string>>(new Set())

  // Reset when modal opens
  React.useEffect(() => {
    if (open) {
      setStep(1)
      setState(initialState())
      setTouched(new Set())
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

  const markTouched = (field: string) =>
    setTouched((prev) => new Set(prev).add(field))

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
      cardNameValid(state.cardName) &&
      cardNumberValid(state.cardNumber) &&
      cardExpiryValid(state.cardExpiry) &&
      cardCvvValid(state.cardCvv))

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
      markTouched={markTouched}
      touched={touched}
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
          <SheetHeader className="px-4 pt-4 pb-1 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4 text-emerald-600" />
              Agendar serviço
            </SheetTitle>
            <SheetDescription className="text-xs">
              Escolha data, detalhes e pagamento
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
        <DialogHeader className="px-5 pt-5 pb-2 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-emerald-600" />
            Agendar serviço
          </DialogTitle>
          <DialogDescription className="text-xs">
            Escolha data, detalhes e pagamento
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Body — Stepper + Content + Footer
// ---------------------------------------------------------------------------

function BookingBody({
  step,
  state,
  set,
  markTouched,
  touched,
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
  markTouched: (field: string) => void
  touched: Set<string>
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
      {/* ── Compact Stepper ── */}
      <div className="shrink-0 border-b px-4 sm:px-5 py-2.5">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const active = step === s.id
            const done = step > s.id
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => done && setStep(s.id)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs transition-colors",
                    active
                      ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                      : done
                        ? "text-emerald-600 cursor-pointer"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all",
                      active &&
                        "border-emerald-600 bg-emerald-600 text-white scale-105",
                      done && "border-emerald-600 bg-emerald-600 text-white",
                      !active && !done && "border-muted-foreground/25 text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <Check className="size-3" />
                    ) : (
                      s.id
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-px bg-muted-foreground/15 mx-1.5 relative">
                    <div
                      className="absolute inset-0 bg-emerald-500 transition-transform origin-left duration-300"
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
        {/* Thin progress bar */}
        <div className="mt-2 h-0.5 w-full rounded-full bg-muted-foreground/10">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── Step content ── */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-emerald-600" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
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
                    markTouched={markTouched}
                    touched={touched}
                    selectedService={selectedService}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>

      {/* ── Sticky footer ── */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur px-4 sm:px-5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          {step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={submitting}
              className="text-muted-foreground hover:text-foreground h-9"
            >
              Voltar
            </Button>
          ) : (
            <div />
          )}
          {step < 3 ? (
            <Button
              type="button"
              size="sm"
              onClick={onNext}
              className="h-9 bg-emerald-600 hover:bg-emerald-700 gap-1.5"
              disabled={
                (step === 1 && !step1Valid) ||
                (step === 2 && !step2Valid)
              }
            >
              Continuar
              <Check
                className={cn(
                  "size-3.5 transition-opacity",
                  (step === 1 && step1Valid) || (step === 2 && step2Valid)
                    ? "opacity-100"
                    : "opacity-0",
                )}
              />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={submitting || !step3Valid}
              className="h-9 bg-emerald-600 hover:bg-emerald-700 gap-1.5"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              <ShieldCheck className="size-3.5" />
              Confirmar agendamento
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Agenda (Date & Time)
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
        out.push({ label: formatHHmm(hhmm), value: hhmm })
        cur += 60
      }
    }
    return out
  }, [state.date, availability])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="grid gap-3">
      {/* Service info banner */}
      {selectedService && (
        <div className="flex items-center gap-2.5 rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedService.title}</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              {formatBRL(selectedService.basePrice)} /{" "}
              {SERVICE_UNIT_LABELS[selectedService.unit] ?? "un"}
            </p>
          </div>
          {state.date && state.time && (
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
          )}
        </div>
      )}

      {/* Calendar */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
          <CalendarDays className="size-3.5 text-emerald-600" />
          Escolha a data
        </p>
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

      {/* Time slots */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
          <Clock className="size-3.5 text-emerald-600" />
          Horários disponíveis
        </p>
        {!state.date ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Selecione uma data para ver os horários
          </p>
        ) : slots.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center">
            <CalendarOff className="mx-auto size-6 text-muted-foreground/50" />
            <p className="mt-1.5 text-xs font-medium">
              Sem horários neste dia
            </p>
            <p className="text-[11px] text-muted-foreground">
              {WEEKDAYS_SHORT[state.date.getDay()]} — fora do expediente
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {slots.map((s) => {
              const active = state.time === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set("time", s.value)}
                  className={cn(
                    "rounded-md border px-1 py-1.5 text-xs text-center font-medium transition-all",
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                      : "hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
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
// Step 2 — Detalhes (Summary + Quantity + Address + Notes)
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

  const estimatedTotal = (selectedService?.basePrice ?? 0) * (state.quantity || 1)

  return (
    <div className="grid gap-3">
      {/* Compact summary card */}
      <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
        <Avatar className="size-8 rounded-md">
          {provider?.avatarUrl ? (
            <AvatarImage src={provider.avatarUrl} alt={provider.name} />
          ) : null}
          <AvatarFallback className="rounded-md bg-emerald-100 text-emerald-700 text-xs dark:bg-emerald-950 dark:text-emerald-300">
            {provider?.name?.[0]?.toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{provider?.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {selectedService?.title}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[11px] text-muted-foreground">
            {scheduledAt ? formatDate(scheduledAt) : "—"}
          </p>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {scheduledAt ? formatHHmm(state.time!) : "—"}
          </p>
        </div>
      </div>

      {/* Quantity + estimated total */}
      {selectedService && (
        <div className="flex items-end gap-3">
          <div className="flex-1 grid gap-1">
            <Label htmlFor="qty" className="text-xs">
              Quantidade ({SERVICE_UNIT_SHORT[selectedService.unit]})
            </Label>
            <Input
              id="qty"
              type="number"
              min={1}
              step={1}
              value={state.quantity}
              onChange={(e) => set("quantity", Number(e.target.value) || 1)}
              className="h-8 text-sm"
            />
          </div>
          <div className="pb-0.5">
            <p className="text-[11px] text-muted-foreground">Total estimado</p>
            <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">
              {formatBRL(estimatedTotal)}
            </p>
          </div>
        </div>
      )}

      <Separator />

      {/* Address */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
          <MapPin className="size-3.5 text-emerald-600" />
          Endereço do serviço
        </p>
        <AddressForm
          value={state.address}
          onChange={(v) => set("address", v)}
        />
      </div>

      <Separator />

      {/* Notes */}
      <div className="grid gap-1">
        <Label htmlFor="notes" className="text-xs">
          Observações (opcional)
        </Label>
        <Textarea
          id="notes"
          placeholder="Detalhes para o prestador: portão, vaga, problemas específicos..."
          rows={2}
          value={state.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="text-sm resize-none"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Pagamento (Payment + Confirm)
// ---------------------------------------------------------------------------

function Step3Payment({
  state,
  set,
  markTouched,
  touched,
  selectedService,
}: {
  state: BookingFormState
  set: <K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) => void
  markTouched: (field: string) => void
  touched: Set<string>
  selectedService?: ProviderService
}) {
  const amount =
    (selectedService?.basePrice ?? 0) * (state.quantity || 1)
  const fees = 0
  const total = amount + fees
  const [paid, setPaid] = React.useState(false)

  // Inline validation helpers for card fields
  const fieldOk = (field: string, valid: boolean) => {
    if (!touched.has(field)) return null
    return valid
  }

  return (
    <div className="grid gap-3">
      {/* Amount summary — compact */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {selectedService?.title} × {state.quantity}
          </span>
          <span className="font-medium">{formatBRL(amount)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Taxa de serviço</span>
          <span className="font-medium">{formatBRL(fees)}</span>
        </div>
        <Separator className="my-1.5" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Total</span>
          <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
            {formatBRL(total)}
          </span>
        </div>
      </div>

      {/* Payment method */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">
          Forma de pagamento
        </p>
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
        <div className="grid gap-2.5 rounded-lg border bg-card px-3 py-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Dados do cartão</p>
            <Badge
              variant="outline"
              className="border-amber-400 text-amber-700 text-[10px] px-1.5 py-0 h-5 dark:border-amber-600 dark:text-amber-400"
            >
              Demonstração
            </Badge>
          </div>

          {/* Card name */}
          <div className="grid gap-0.5">
            <Label htmlFor="cardName" className="text-xs">
              Nome impresso
            </Label>
            <div className="relative">
              <Input
                id="cardName"
                placeholder="NOME NO CARTÃO"
                value={state.cardName}
                onChange={(e) => set("cardName", e.target.value.toUpperCase())}
                onBlur={() => markTouched("cardName")}
                className="h-8 text-sm pr-7"
              />
              {fieldOk("cardName", cardNameValid(state.cardName)) && (
                <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-emerald-600" />
              )}
            </div>
          </div>

          {/* Card number */}
          <div className="grid gap-0.5">
            <Label htmlFor="cardNumber" className="text-xs">
              Número
            </Label>
            <div className="relative">
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
                onBlur={() => markTouched("cardNumber")}
                className="h-8 text-sm pr-7"
              />
              {fieldOk("cardNumber", cardNumberValid(state.cardNumber)) && (
                <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-emerald-600" />
              )}
            </div>
          </div>

          {/* Expiry + CVV */}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-0.5">
              <Label htmlFor="cardExpiry" className="text-xs">
                Validade
              </Label>
              <div className="relative">
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
                  onBlur={() => markTouched("cardExpiry")}
                  className="h-8 text-sm pr-7"
                />
                {fieldOk("cardExpiry", cardExpiryValid(state.cardExpiry)) && (
                  <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-emerald-600" />
                )}
              </div>
            </div>
            <div className="grid gap-0.5">
              <Label htmlFor="cardCvv" className="text-xs">
                CVV
              </Label>
              <div className="relative">
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
                  onBlur={() => markTouched("cardCvv")}
                  className="h-8 text-sm pr-7"
                />
                {fieldOk("cardCvv", cardCvvValid(state.cardCvv)) && (
                  <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-emerald-600" />
                )}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground flex items-start gap-1">
            <ShieldCheck className="size-3 mt-0.5 text-emerald-600 shrink-0" />
            Ambiente de demonstração — não use dados reais.
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5 rounded-lg border bg-card px-3 py-3">
          <p className="text-xs font-medium">Pague com PIX</p>
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="rounded-lg bg-slate-100 p-5 text-center dark:bg-slate-800/50">
              <QrCode className="size-16 text-slate-500 dark:text-slate-300" />
            </div>
            <p className="text-[11px] text-muted-foreground text-center max-w-xs">
              Escaneie o QR code ou copie a chave para pagar
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
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
            size="sm"
            className="border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 h-8"
            onClick={() => {
              setPaid(true)
              toast.success("Pagamento confirmado. Conclua o agendamento.")
            }}
            disabled={paid}
          >
            {paid ? (
              <>
                <Check className="size-3.5" /> Pagamento confirmado
              </>
            ) : (
              "Já paguei"
            )}
          </Button>
        </div>
      )}

      {/* "O que acontece agora?" mini-timeline */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
        <p className="text-xs font-medium mb-2">O que acontece agora?</p>
        <div className="space-y-1.5">
          {[
            { icon: CalendarDays, label: "Agendado", desc: "Seu pedido é registrado" },
            { icon: CheckCircle2, label: "Prestador confirma", desc: "Aceita ou ajusta o horário" },
            { icon: CircleDot, label: "Em andamento", desc: "Serviço sendo realizado" },
            { icon: Check, label: "Concluído", desc: "Você avalia o serviço" },
          ].map((item, i) => {
            const Icon = item.icon
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="mt-0.5 flex flex-col items-center">
                  <Icon className="size-3.5 text-emerald-600" />
                  {i < 3 && (
                    <div className="w-px h-2 bg-muted-foreground/20 mt-0.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium leading-tight">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {item.desc}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Security badge */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-600" />
        Ambiente de demonstração — nenhum pagamento será efetivado
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Payment Option card
// ---------------------------------------------------------------------------

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
        "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
        selected
          ? "border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600 dark:bg-emerald-950/30"
          : "hover:border-emerald-400/50 hover:bg-accent/40",
      )}
    >
      <RadioGroupItem value={value} id={`pay-${value}`} className="sr-only" />
      <Icon
        className={cn(
          "size-4",
          selected ? "text-emerald-600" : "text-muted-foreground",
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-tight">{title}</p>
        <p className="text-[10px] text-muted-foreground leading-tight">
          {description}
        </p>
      </div>
      {selected && <Check className="size-3.5 text-emerald-600 shrink-0" />}
    </Label>
  )
}
