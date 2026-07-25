"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarOff,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Moon,
  Pencil,
  QrCode,
  Send,
  ShieldCheck,
  Sun,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { ptBR } from "date-fns/locale";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiGet, apiPost, type ProviderDetail, type ProviderService } from "@/lib/api";
import { SERVICE_UNIT_LABELS, SERVICE_UNIT_SHORT, WEEKDAYS_SHORT } from "@/lib/constants";
import { formatBRL, formatDate, formatHHmm } from "@/lib/format";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useViewStore } from "@/store/view";
import { useIsMobile } from "@/hooks/use-mobile";
import { AddressForm, type AddressFormValue } from "./address-form";
import { StepWizard, StepHeader, InfoCard, type StepDef } from "./step-wizard";

// ---------------------------------------------------------------------------
// Step definitions — 4 steps
// Nielsen #8: Minimalist — each step has ONE focused task
// ---------------------------------------------------------------------------

const STEPS: StepDef[] = [
  { id: 1, label: "Agenda", shortLabel: "Agenda", icon: CalendarDays },
  { id: 2, label: "Detalhes", shortLabel: "Detalhes", icon: MapPin },
  { id: 3, label: "Pagamento", shortLabel: "Pagamento", icon: Wallet },
  { id: 4, label: "Confirmação", shortLabel: "Confirmar", icon: Check },
];

type Step = (typeof STEPS)[number]["id"];

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type BookingFormState = {
  date: Date | undefined;
  time: string | undefined;
  quantity: number;
  notes: string;
  address: AddressFormValue;
  paymentMethod: "CARD" | "PIX";
  cardName: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
};

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
};

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
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function cardNameValid(v: string) {
  return v.trim().length >= 3;
}
function cardNumberValid(v: string) {
  return v.replace(/\s/g, "").length >= 13;
}
function cardExpiryValid(v: string) {
  return /^\d{2}\/\d{2}$/.test(v);
}
function cardCvvValid(v: string) {
  return /^\d{3,4}$/.test(v);
}

// ---------------------------------------------------------------------------
// Time slot period grouping
// Nielsen #6: Recognition over recall — group slots by time of day
// ---------------------------------------------------------------------------

type TimePeriod = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  range: [number, number]; // start hour, end hour (exclusive)
};

const TIME_PERIODS: TimePeriod[] = [
  { key: "morning", label: "Manhã", icon: Sun, range: [6, 12] },
  { key: "afternoon", label: "Tarde", icon: Clock, range: [12, 18] },
  { key: "evening", label: "Noite", icon: Moon, range: [18, 24] },
];

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function BookingModal() {
  const open = useUIStore((s) => s.bookingModal.open);
  const providerIdPreset = useUIStore((s) => s.bookingModal.providerId);
  const serviceIdPreset = useUIStore((s) => s.bookingModal.serviceId);
  const close = useUIStore((s) => s.closeBooking);
  const openAuth = useUIStore((s) => s.openAuth);
  const isMobile = useIsMobile();
  const navigate = useViewStore((s) => s.navigate);
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = React.useState<Step>(1);
  const [state, setState] = React.useState<BookingFormState>(initialState());
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState<Set<string>>(new Set());

  // Reset: key={String(open)} in <Sheet> forces remount

  // Fetch provider + services
  const providerQuery = useQuery({
    queryKey: ["provider", providerIdPreset],
    queryFn: () => apiGet<ProviderDetail>(`/api/providers/${providerIdPreset}`),
    enabled: open && !!providerIdPreset,
    staleTime: 60 * 1000,
  });

  const servicesQuery = useQuery({
    queryKey: ["services-by-provider", providerIdPreset],
    queryFn: () => apiGet<ProviderService[]>("/api/services", { providerId: providerIdPreset }),
    enabled: open && !!providerIdPreset,
    staleTime: 60 * 1000,
  });

  const provider = providerQuery.data;
  const services = servicesQuery.data ?? [];
  const selectedService = services.find((s) => s.id === serviceIdPreset) ?? services[0];

  const set = <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const markTouched = (field: string) => setTouched((prev) => new Set(prev).add(field));

  // ── Step validation ──
  const step1Valid = !!state.date && !!state.time;
  const step2Valid =
    !!state.address.cep &&
    state.address.cep.replace(/\D/g, "").length === 8 &&
    !!state.address.street &&
    !!state.address.number &&
    !!state.address.city &&
    !!state.address.state;
  const step3Valid =
    state.paymentMethod === "PIX" ||
    (state.paymentMethod === "CARD" &&
      cardNameValid(state.cardName) &&
      cardNumberValid(state.cardNumber) &&
      cardExpiryValid(state.cardExpiry) &&
      cardCvvValid(state.cardCvv));
  // Step 4 is always valid (it's a review)

  const validSteps: Record<number, boolean> = {
    1: step1Valid,
    2: step2Valid,
    3: step3Valid,
    4: true,
  };

  // ── Navigation ──
  const handleStepClick = (target: Step) => {
    if (target < step) {
      setStep(target);
      return;
    }
    for (let i = 1; i < target; i++) {
      if (!validSteps[i as Step]) {
        toast.error("Complete os passos anteriores primeiro.");
        return;
      }
    }
    setStep(target);
  };

  const handleNext = () => {
    if (step === 1 && !step1Valid) {
      toast.error("Selecione data e horário para continuar.");
      return;
    }
    if (step === 2 && !step2Valid) {
      toast.error("Preencha o endereço completo.");
      return;
    }
    if (step === 3 && !step3Valid) {
      toast.error("Verifique os dados de pagamento.");
      return;
    }
    setStep((s) => Math.min(4, s + 1) as Step);
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1) as Step);

  const handleSubmit = async () => {
    if (!user) {
      toast.info("Faça cadastro gratuito para agendar serviços.");
      openAuth("register", "CLIENT");
      return;
    }
    if (!provider || !selectedService || !state.date || !state.time) {
      toast.error("Dados incompletos. Revise o agendamento.");
      return;
    }

    const [h, m] = state.time.split(":").map(Number);
    const scheduledAt = new Date(state.date);
    scheduledAt.setHours(h ?? 0, m ?? 0, 0, 0);
    const amount = (selectedService.basePrice || 0) * (state.quantity || 1);

    setSubmitting(true);
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
      });
      toast.success("Agendamento confirmado! Acompanhe em seus agendamentos.");
      close();
      navigate("client.bookings");
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ??
        "Não foi possível concluir o agendamento. Tente novamente.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step content ──
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
        );
      case 2:
        return (
          <Step2Details
            state={state}
            set={set}
            provider={provider}
            selectedService={selectedService}
          />
        );
      case 3:
        return (
          <Step3Payment
            state={state}
            set={set}
            markTouched={markTouched}
            touched={touched}
            selectedService={selectedService}
          />
        );
      case 4:
        return (
          <Step4Confirmation
            state={state}
            provider={provider}
            selectedService={selectedService}
            goToStep={setStep}
          />
        );
      default:
        return null;
    }
  })();

  // Dynamic dialog sizing: wider on Step 1 for side-by-side calendar layout
  const dialogSizeClass = step === 1 ? "sm:max-w-2xl" : "sm:max-w-lg";

  // ── Step indicator (reused for desktop custom layout) ──
  const stepIndicator = (
    <div className="border-b px-4 sm:px-5 py-3">
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const active = step === s.id;
          const done = validSteps[s.id] && step > s.id;
          const Icon = s.icon;
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => handleStepClick(s.id)}
                disabled={!done && s.id > step}
                className={cn(
                  "flex items-center gap-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1 py-0.5",
                  active
                    ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                    : done
                      ? "text-emerald-600 cursor-pointer hover:text-emerald-700"
                      : "text-muted-foreground cursor-default",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all",
                    active &&
                      "border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/25",
                    done && "border-emerald-600 bg-emerald-600 text-white cursor-pointer",
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
                <div className="flex-1 h-px bg-muted-foreground/15 mx-1 sm:mx-2 relative">
                  <div
                    className="absolute inset-0 bg-emerald-500 transition-transform origin-left duration-300"
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
          );
        })}
      </div>
    </div>
  );

  // ── Footer buttons ──
  const footerButtons = (
    <div className="border-t bg-background/95 backdrop-blur px-4 sm:px-5 py-2.5 sticky bottom-0">
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
            className="h-9 bg-emerald-600 hover:bg-emerald-700 gap-1.5"
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
            className="h-9 bg-emerald-600 hover:bg-emerald-700 gap-1.5"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            <Send className="size-3.5" />
            Confirmar agendamento
          </Button>
        )}
      </div>
    </div>
  );

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
  );

  if (isMobile) {
    return (
      <Sheet key={String(open)} open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent
          side="bottom"
          className="h-[100dvh] max-h-[100dvh] w-full p-0 sm:max-w-full gap-0 flex flex-col"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
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
    );
  }

  // ── Desktop: Custom layout with proper scrolling ──
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className={cn(
          "p-0 gap-0 flex flex-col max-h-[90vh] transition-[max-width] duration-300",
          dialogSizeClass,
        )}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header — Nielsen #3: User control */}
        <DialogHeader className="px-5 pt-4 pb-2 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-emerald-600" />
            Agendar serviço
          </DialogTitle>
          <DialogDescription className="text-xs">
            Escolha data, detalhes e pagamento
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator — always visible */}
        {stepIndicator}

        {/* Step content — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-5 py-4">
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

        {/* Footer — always visible at bottom */}
        {footerButtons}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Agenda (Date & Time) — REDESIGNED
// Desktop: Calendar LEFT + Time slots RIGHT (side-by-side)
// Mobile: Calendar TOP + Time slots BOTTOM (stacked)
// Nielsen #1: Visibility of system status — selected date/time highlighted
// Nielsen #6: Recognition over recall — visible calendar, time slot buttons
// Nielsen #8: Minimalist — clean two-column layout
// Reference: shadcnspace.com Calendar 03 - Time Calendar
// ---------------------------------------------------------------------------

function Step1Schedule({
  state,
  set,
  availability,
  selectedService,
  provider,
  loading,
  isDesktop,
}: {
  state: BookingFormState;
  set: <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) => void;
  availability: ProviderDetail["availability"];
  selectedService?: ProviderService;
  provider?: ProviderDetail;
  loading: boolean;
  isDesktop: boolean;
}) {
  // Generate slot list for selected date
  const slots = React.useMemo(() => {
    if (!state.date) return [] as { label: string; value: string }[];
    const dow = state.date.getDay();
    const dayBlocks = (availability ?? [])
      .filter((a) => a.dayOfWeek === dow)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (dayBlocks.length === 0) return [];
    const out: { label: string; value: string }[] = [];
    for (const block of dayBlocks) {
      const [sh, sm] = block.startTime.split(":").map(Number);
      const [eh, em] = block.endTime.split(":").map(Number);
      let cur = sh * 60 + sm;
      const end = eh * 60 + em;
      while (cur + 60 <= end) {
        const h = Math.floor(cur / 60);
        const m = cur % 60;
        const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        out.push({ label: formatHHmm(hhmm), value: hhmm });
        cur += 60;
      }
    }
    return out;
  }, [state.date, availability]);

  // Group slots by time period — Nielsen #6: recognition over recall
  const groupedSlots = React.useMemo(() => {
    return TIME_PERIODS.map((period) => ({
      ...period,
      slots: slots.filter((s) => {
        const h = parseInt(s.value.split(":")[0], 10);
        return h >= period.range[0] && h < period.range[1];
      }),
    })).filter((g) => g.slots.length > 0);
  }, [slots]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-emerald-600" />
      </div>
    );
  }

  // ── Service info banner (compact, always visible) ──
  const serviceBanner = selectedService ? (
    <InfoCard variant="emerald" className="mb-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-9 rounded-md">
          {provider?.avatarUrl ? (
            <AvatarImage src={provider.avatarUrl} alt={provider.name} />
          ) : null}
          <AvatarFallback className="rounded-md bg-emerald-100 text-emerald-700 text-xs dark:bg-emerald-950 dark:text-emerald-300">
            {provider?.name?.[0]?.toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{selectedService.title}</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            {formatBRL(selectedService.basePrice)} /{" "}
            {SERVICE_UNIT_LABELS[selectedService.unit] ?? "un"}
          </p>
        </div>
        {state.date && state.time && <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />}
      </div>
    </InfoCard>
  ) : null;

  // ── Calendar section (clean, no label — Calendar 03 style) ──
  const calendarSection = (
    <Calendar
      mode="single"
      locale={ptBR}
      selected={state.date}
      onSelect={(d) => {
        set("date", d);
        set("time", undefined);
      }}
      disabled={(d) => d < today}
      className="rounded-lg border shadow-sm [--cell-size:--spacing(7)]"
    />
  );

  // ── Time slots section (Calendar 03 style — borderless chips) ──
  const timeSlotsSection = (
    <div className="flex flex-col h-full">
      {!state.date ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <CalendarDays className="mx-auto size-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">Selecione uma data</p>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              para ver os horários disponíveis
            </p>
          </div>
        </div>
      ) : slots.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-5 text-center">
            <CalendarOff className="mx-auto size-6 text-muted-foreground/30 mb-1.5" />
            <p className="text-xs font-medium text-muted-foreground">Sem horários neste dia</p>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              {WEEKDAYS_SHORT[state.date.getDay()]} — fora do expediente
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="grid gap-3">
            {groupedSlots.map((group) => {
              const PeriodIcon = group.icon;
              return (
                <div key={group.key}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <PeriodIcon className="size-3 text-muted-foreground/50" />
                    <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      {group.slots.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.slots.map((s) => {
                      const active = state.time === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => set("time", s.value)}
                          className={cn(
                            "rounded-lg px-2 py-2 text-xs text-center font-medium transition-all duration-150",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1",
                            active
                              ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                              : "bg-muted/60 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
                          )}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );

  // ── Selected date summary (below calendar, both layouts) ──
  const selectedDateSummary = state.date && (
    <div
      className={cn(
        "mt-2 rounded-lg px-3 py-2 text-center transition-colors duration-200",
        state.time
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "bg-muted/40 text-muted-foreground",
      )}
    >
      <p className="text-xs font-semibold">
        {format(state.date, "EEEE, dd 'de' MMMM", { locale: ptBR })}
      </p>
      {state.time ? (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-0.5 flex items-center justify-center gap-1">
          <Clock className="size-3" />
          {formatHHmm(state.time)}
        </p>
      ) : (
        <p className="text-[11px] mt-0.5 opacity-60">Escolha o horário →</p>
      )}
    </div>
  );

  return (
    <div>
      {/* StepHeader only on mobile — desktop layout is self-explanatory */}
      {!isDesktop && (
        <StepHeader
          icon={CalendarDays}
          title="Escolha a data e horário"
          description="Selecione o melhor dia e horário para o serviço."
        />
      )}

      {serviceBanner}

      {/* ── Desktop: Side-by-side (shadcnspace Calendar 03 style) ── */}
      {isDesktop ? (
        <div className="grid grid-cols-[auto_1fr] divide-x">
          {/* LEFT: Calendar + date summary */}
          <div className="flex flex-col pr-4">
            {calendarSection}
            {selectedDateSummary}
          </div>

          {/* RIGHT: Time slots */}
          <div className="flex flex-col min-h-0 pl-4">{timeSlotsSection}</div>
        </div>
      ) : (
        /* ── Mobile: Stacked ── */
        <div className="grid gap-4">
          {calendarSection}
          {selectedDateSummary}
          {timeSlotsSection}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Detalhes (Address + Quantity + Notes)
// Nielsen #5: Error prevention — CEP auto-fill, GPS
// Nielsen #8: Minimalist — clean form layout
// ---------------------------------------------------------------------------

function Step2Details({
  state,
  set,
  provider,
  selectedService,
}: {
  state: BookingFormState;
  set: <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) => void;
  provider?: ProviderDetail;
  selectedService?: ProviderService;
}) {
  const scheduledAt =
    state.date && state.time
      ? (() => {
          const d = new Date(state.date);
          const [h, m] = state.time.split(":").map(Number);
          d.setHours(h ?? 0, m ?? 0, 0, 0);
          return d;
        })()
      : null;

  const estimatedTotal = (selectedService?.basePrice ?? 0) * (state.quantity || 1);

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={MapPin}
        title="Detalhes do agendamento"
        description="Informe a quantidade, endereço e observações."
      />

      {/* Compact summary card — Nielsen #1: visibility */}
      <InfoCard variant="emerald">
        <div className="flex items-center gap-3">
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
            <p className="text-[11px] text-muted-foreground truncate">{selectedService?.title}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-muted-foreground">
              {scheduledAt ? formatDate(scheduledAt) : "—"}
            </p>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {scheduledAt && state.time ? formatHHmm(state.time) : "—"}
            </p>
          </div>
        </div>
      </InfoCard>

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
              className="h-9 text-sm"
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
        <AddressForm value={state.address} onChange={(v) => set("address", v)} />
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
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Pagamento (Payment Method)
// Nielsen #5: Error prevention — inline card validation
// Nielsen #8: Minimalist — clean payment selection
// ---------------------------------------------------------------------------

function Step3Payment({
  state,
  set,
  markTouched,
  touched,
  selectedService,
}: {
  state: BookingFormState;
  set: <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) => void;
  markTouched: (field: string) => void;
  touched: Set<string>;
  selectedService?: ProviderService;
}) {
  const amount = (selectedService?.basePrice ?? 0) * (state.quantity || 1);
  const fees = 0;
  const total = amount + fees;
  const [paid, setPaid] = React.useState(false);

  const fieldOk = (field: string, valid: boolean) => {
    if (!touched.has(field)) return null;
    return valid;
  };

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Wallet}
        title="Forma de pagamento"
        description="Escolha como pagar pelo serviço."
      />

      {/* Amount summary — Nielsen #1: visibility of system status */}
      <InfoCard>
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
      </InfoCard>

      {/* Payment method selection */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Forma de pagamento</p>
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

      {/* Card details — Nielsen #5: error prevention with inline validation */}
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
                className={cn(
                  "h-8 text-sm pr-7",
                  fieldOk("cardName", cardNameValid(state.cardName)) === false &&
                    "border-destructive",
                )}
              />
              {fieldOk("cardName", cardNameValid(state.cardName)) && (
                <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-emerald-600" />
              )}
            </div>
          </div>

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
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 16);
                  const parts = digits.match(/.{1,4}/g);
                  set("cardNumber", parts ? parts.join(" ") : "");
                }}
                onBlur={() => markTouched("cardNumber")}
                className={cn(
                  "h-8 text-sm pr-7",
                  fieldOk("cardNumber", cardNumberValid(state.cardNumber)) === false &&
                    "border-destructive",
                )}
              />
              {fieldOk("cardNumber", cardNumberValid(state.cardNumber)) && (
                <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-emerald-600" />
              )}
            </div>
          </div>

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
                    let v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
                    set("cardExpiry", v);
                  }}
                  onBlur={() => markTouched("cardExpiry")}
                  className={cn(
                    "h-8 text-sm pr-7",
                    fieldOk("cardExpiry", cardExpiryValid(state.cardExpiry)) === false &&
                      "border-destructive",
                  )}
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
                  onChange={(e) => set("cardCvv", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onBlur={() => markTouched("cardCvv")}
                  className={cn(
                    "h-8 text-sm pr-7",
                    fieldOk("cardCvv", cardCvvValid(state.cardCvv)) === false &&
                      "border-destructive",
                  )}
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
        /* PIX payment */
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
                navigator.clipboard.writeText("severinno@exemplo.com").catch(() => {});
                toast.success("Chave PIX copiada!");
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
              setPaid(true);
              toast.success("Pagamento confirmado. Conclua o agendamento.");
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Confirmação (Review + Confirm)
// Nielsen #5: error prevention (review before commit)
// Nielsen #3: user control — edit links
// Nielsen #10: help — "what happens next" timeline
// ---------------------------------------------------------------------------

function Step4Confirmation({
  state,
  provider,
  selectedService,
  goToStep,
}: {
  state: BookingFormState;
  provider?: ProviderDetail;
  selectedService?: ProviderService;
  goToStep: (s: Step) => void;
}) {
  const amount = (selectedService?.basePrice ?? 0) * (state.quantity || 1);
  const scheduledAt =
    state.date && state.time
      ? (() => {
          const d = new Date(state.date);
          const [h, m] = state.time.split(":").map(Number);
          d.setHours(h ?? 0, m ?? 0, 0, 0);
          return d;
        })()
      : null;

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Check}
        title="Confirme o agendamento"
        description="Revise os detalhes antes de confirmar."
      />

      {/* Provider + Service */}
      <ReviewSection label="Prestador" onEdit={() => goToStep(1)}>
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 rounded-md">
            {provider?.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="rounded-md bg-emerald-100 text-emerald-700 text-xs dark:bg-emerald-950 dark:text-emerald-300">
              {provider?.name?.[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{provider?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{selectedService?.title}</p>
          </div>
        </div>
      </ReviewSection>

      {/* Date/Time */}
      <ReviewSection label="Data e horário" onEdit={() => goToStep(1)}>
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-emerald-600" />
          <span className="text-sm">
            {scheduledAt ? formatDate(scheduledAt) : "—"} às{" "}
            {state.time ? formatHHmm(state.time) : "—"}
          </span>
        </div>
      </ReviewSection>

      {/* Address */}
      <ReviewSection label="Endereço" onEdit={() => goToStep(2)}>
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <span className="text-muted-foreground">
            {state.address.street
              ? `${state.address.street}, ${state.address.number}${
                  state.address.complement ? ` - ${state.address.complement}` : ""
                }${state.address.district ? ` · ${state.address.district}` : ""}`
              : "—"}
            {state.address.city ? ` · ${state.address.city}/${state.address.state}` : ""}
          </span>
        </div>
      </ReviewSection>

      {/* Payment */}
      <ReviewSection label="Pagamento" onEdit={() => goToStep(3)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {state.paymentMethod === "PIX" ? (
              <QrCode className="size-4 text-emerald-600" />
            ) : (
              <CreditCard className="size-4 text-emerald-600" />
            )}
            <span>{state.paymentMethod === "PIX" ? "PIX" : "Cartão de crédito"}</span>
          </div>
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
            {formatBRL(amount)}
          </span>
        </div>
        {state.notes && (
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">📝 {state.notes}</p>
        )}
      </ReviewSection>

      {/* What happens next — Nielsen #10: help & documentation */}
      <InfoCard variant="emerald" className="mt-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-1.5">
          <Clock className="size-3.5" />O que acontece agora?
        </h4>
        <div className="grid gap-2.5">
          {[
            { icon: CalendarDays, label: "Agendado", desc: "Seu pedido é registrado" },
            { icon: CheckCircle2, label: "Prestador confirma", desc: "Aceita ou ajusta o horário" },
            { icon: Clock, label: "Em andamento", desc: "Serviço sendo realizado" },
            { icon: Check, label: "Concluído", desc: "Você avalia o serviço" },
          ].map((item, i) => {
            return (
              <div key={i} className="flex items-start gap-2.5">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                    {item.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </InfoCard>

      {/* Security note */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-600" />
        Ambiente de demonstração — nenhum pagamento será efetivado
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewSection — Editable review card
// Nielsen #3: user control — "Editar" links
// ---------------------------------------------------------------------------

function ReviewSection({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h4>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium transition-colors"
        >
          <Pencil className="size-3" />
          Editar
        </button>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaymentOption card
// ---------------------------------------------------------------------------

function PaymentOption({
  value,
  title,
  description,
  icon: Icon,
  selected,
}: {
  value: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  selected: boolean;
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
      <Icon className={cn("size-4", selected ? "text-emerald-600" : "text-muted-foreground")} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-tight">{title}</p>
        <p className="text-[10px] text-muted-foreground leading-tight">{description}</p>
      </div>
      {selected && <Check className="size-3.5 text-emerald-600 shrink-0" />}
    </Label>
  );
}
