"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarDays, Check, ChevronLeft, ChevronRight, Loader2, Send } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

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
import { cn } from "@/lib/utils"
import { apiGet, apiPost, type ProviderDetail, type ProviderService } from "@/lib/api"
import { useUIStore } from "@/store/ui"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { useIsMobile } from "@/hooks/use-mobile"
import { StepWizard } from "./step-wizard"

import {
  Step1Schedule,
  Step2Details,
  Step3Payment,
  Step4Confirmation,
  STEPS,
  initialState,
  cardNameValid,
  cardNumberValid,
  cardExpiryValid,
  cardCvvValid,
  type Step,
  type BookingFormState,
} from "./booking"

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

  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open && prevOpen !== open) {
    setPrevOpen(open)
    setStep(1)
    setState(initialState())
    setTouched(new Set())
  }

  const providerQuery = useQuery({
    queryKey: ["provider", providerIdPreset],
    queryFn: () => apiGet<ProviderDetail>(`/api/providers/${providerIdPreset}`),
    enabled: open && !!providerIdPreset,
    staleTime: 60 * 1000,
  })

  const servicesQuery = useQuery({
    queryKey: ["services-by-provider", providerIdPreset],
    queryFn: () => apiGet<ProviderService[]>("/api/services", { providerId: providerIdPreset }),
    enabled: open && !!providerIdPreset,
    staleTime: 60 * 1000,
  })

  const provider = providerQuery.data
  const services = servicesQuery.data ?? []
  const selectedService = services.find((s) => s.id === serviceIdPreset) ?? services[0]

  const [prevSelectedService, setPrevSelectedService] = React.useState(selectedService)
  if (open && prevSelectedService !== selectedService) {
    setPrevSelectedService(selectedService)
    if (selectedService) setState((s) => ({ ...s, quantity: 1 }))
  }

  const set = <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  const markTouched = (field: string) => setTouched((prev) => new Set(prev).add(field))

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

  const validSteps: Record<number, boolean> = {
    1: step1Valid,
    2: step2Valid,
    3: step3Valid,
    4: true,
  }

  const handleStepClick = (target: Step) => {
    if (target < step) {
      setStep(target)
      return
    }
    for (let i = 1; i < target; i++) {
      if (!validSteps[i as Step]) {
        toast.error("Complete os passos anteriores primeiro.")
        return
      }
    }
    setStep(target)
  }

  const handleNext = () => {
    if (step === 1 && !step1Valid) {
      toast.error("Selecione data e horário para continuar.")
      return
    }
    if (step === 2 && !step2Valid) {
      toast.error("Preencha o endereço completo.")
      return
    }
    if (step === 3 && !step3Valid) {
      toast.error("Verifique os dados de pagamento.")
      return
    }
    setStep((s) => Math.min(4, s + 1) as Step)
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

    const [h, m] = state.time.split(":").map(Number)
    const scheduledAt = new Date(state.date)
    scheduledAt.setHours(h ?? 0, m ?? 0, 0, 0)
    const amount = (selectedService.basePrice || 0) * (state.quantity || 1)

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

  const stepContent = (() => {
    switch (step) {
      case 1:
        return (
          <Step1Schedule
            state={state}
            set={set}
            availability={provider?.availability ?? []}
            selectedService={selectedService}
            provider={provider}
            loading={providerQuery.isLoading || servicesQuery.isLoading}
            isDesktop={!isMobile}
          />
        )
      case 2:
        return (
          <Step2Details
            state={state}
            set={set}
            provider={provider}
            selectedService={selectedService}
          />
        )
      case 3:
        return (
          <Step3Payment
            state={state}
            set={set}
            markTouched={markTouched}
            touched={touched}
            selectedService={selectedService}
          />
        )
      case 4:
        return (
          <Step4Confirmation
            state={state}
            provider={provider}
            selectedService={selectedService}
            goToStep={setStep}
          />
        )
      default:
        return null
    }
  })()

  const dialogSizeClass = step === 1 ? "sm:max-w-2xl" : "sm:max-w-lg"

  const stepIndicator = (
    <div className="border-b px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const active = step === s.id
          const done = validSteps[s.id] && step > s.id
          const Icon = s.icon
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => handleStepClick(s.id)}
                disabled={!done && s.id > step}
                className={cn(
                  "focus-visible:ring-ring flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "font-semibold text-emerald-700 dark:text-emerald-400"
                    : done
                      ? "cursor-pointer text-emerald-600 hover:text-emerald-700"
                      : "text-muted-foreground cursor-default",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all",
                    active &&
                      "border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/25",
                    done && "cursor-pointer border-emerald-600 bg-emerald-600 text-white",
                    !active && !done && "border-muted-foreground/20 text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" />
                  ) : Icon ? (
                    <Icon className="size-3.5" />
                  ) : (
                    s.id
                  )}
                </span>
                <span className="hidden sm:inline">{s.shortLabel ?? s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className="bg-muted-foreground/15 relative mx-1 h-px flex-1 sm:mx-2">
                  <div
                    className="absolute inset-0 origin-left bg-emerald-500 transition-transform duration-300"
                    style={{
                      transform:
                        validSteps[STEPS[i + 1]?.id] || step > s.id
                          ? "scaleX(1)"
                          : step === s.id && validSteps[s.id]
                            ? "scaleX(0.5)"
                            : "scaleX(0)",
                    }}
                  />
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )

  const footerButtons = (
    <div className="bg-background/95 sticky bottom-0 border-t px-4 py-2.5 backdrop-blur sm:px-5">
      <div className="flex items-center justify-between gap-2">
        {step > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground h-9 gap-1"
          >
            <ChevronLeft className="size-4" />
            Voltar
          </Button>
        ) : (
          <div />
        )}
        {step < 4 ? (
          <Button
            type="button"
            size="sm"
            onClick={handleNext}
            disabled={!validSteps[step]}
            className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
          >
            Continuar
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !validSteps[step]}
            className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            <Send className="size-3.5" />
            Confirmar agendamento
          </Button>
        )}
      </div>
    </div>
  )

  const wizardBody = (
    <StepWizard
      steps={STEPS}
      currentStep={step}
      validSteps={validSteps}
      onStepClick={handleStepClick}
      onBack={handleBack}
      onNext={handleNext}
      onSubmit={handleSubmit}
      submitting={submitting}
      currentStepValid={validSteps[step] ?? true}
      submitLabel={
        <>
          <Send className="size-3.5" />
          Confirmar agendamento
        </>
      }
    >
      {stepContent}
    </StepWizard>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent
          side="bottom"
          className="flex h-[100dvh] max-h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-full"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="shrink-0 px-4 pt-4 pb-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4 text-emerald-600" />
              Agendar serviço
            </SheetTitle>
            <SheetDescription className="text-xs">
              Escolha data, detalhes e pagamento
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">{wizardBody}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col gap-0 p-0 transition-[max-width] duration-300",
          dialogSizeClass,
        )}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b px-5 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-emerald-600" />
            Agendar serviço
          </DialogTitle>
          <DialogDescription className="text-xs">
            Escolha data, detalhes e pagamento
          </DialogDescription>
        </DialogHeader>

        {stepIndicator}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              {stepContent}
            </motion.div>
          </AnimatePresence>
        </div>

        {footerButtons}
      </DialogContent>
    </Dialog>
  )
}
