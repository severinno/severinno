"use client";

import * as React from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Check,
  ChevronDown,
  Clock,
  LogIn,
  MapPin,
  Pencil,
  Send,
  ShieldCheck,
  User,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  apiGet,
  apiPost,
  type ProviderCard,
  type ProviderService,
  type PagedResult,
  type ServiceUnit,
} from "@/lib/api";
import { SERVICE_UNITS, SERVICE_UNIT_LABELS, SERVICE_UNIT_SHORT } from "@/lib/constants";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useViewStore } from "@/store/view";
import { useIsMobile } from "@/hooks/use-mobile";
import { AddressForm, type AddressFormValue } from "./address-form";
import { FilePhotos } from "./file-photos";
import { StepWizard, StepHeader, InfoCard, type StepDef } from "./step-wizard";

// ---------------------------------------------------------------------------
// Step definitions — 5 steps for better UX (Nielsen #8: minimalist design)
// Each step has ONE clear task
// ---------------------------------------------------------------------------

const STEPS: StepDef[] = [
  { id: 1, label: "Prestador", shortLabel: "Prestador", icon: User },
  { id: 2, label: "Serviço", shortLabel: "Serviço", icon: Wrench },
  { id: 3, label: "Detalhes", shortLabel: "Detalhes", icon: Pencil },
  { id: 4, label: "Endereço", shortLabel: "Endereço", icon: MapPin },
  { id: 5, label: "Revisão", shortLabel: "Revisão", icon: Check },
];

type Step = (typeof STEPS)[number]["id"];

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

type QuoteItemForm = {
  providerId: string;
  serviceId: string;
  description: string;
  quantity: number;
  unit: ServiceUnit;
  photos: string[];
};

const quoteFormSchema = z.object({
  items: z
    .array(
      z.object({
        providerId: z.string().min(1, "Selecione um prestador"),
        serviceId: z.string().min(1, "Selecione um serviço"),
        description: z.string().min(10, "Descreva com ao menos 10 caracteres").max(400),
        quantity: z.coerce.number().min(0.01, "Quantidade inválida"),
        unit: z.enum(["UNIDADE", "METRO_LINEAR", "METRO_QUADRADO", "METRO_CUBICO"]),
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
});

type QuoteFormValues = z.infer<typeof quoteFormSchema>;

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
});

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

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function QuoteModal() {
  const open = useUIStore((s) => s.quoteModal.open);
  const providerIdPreset = useUIStore((s) => s.quoteModal.providerId);
  const serviceIdPreset = useUIStore((s) => s.quoteModal.serviceId);
  const close = useUIStore((s) => s.closeQuote);
  const openAuth = useUIStore((s) => s.openAuth);
  const isMobile = useIsMobile();
  const navigate = useViewStore((s) => s.navigate);
  const user = useAuthStore((s) => s.user);

  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema) as unknown as Resolver<QuoteFormValues>,
    defaultValues: {
      items: [emptyItem(providerIdPreset, serviceIdPreset)],
      address: emptyAddress,
    },
    mode: "onTouched",
  });

  const [step, setStep] = React.useState<Step>(1);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset: key={String(open)} in <Sheet> forces remount + clean form

  // ── Step validation map ──
  const items = form.watch("items");
  const address = form.watch("address");
  const item0 = items[0];

  const step1Valid = !!item0?.providerId;
  const step2Valid = !!item0?.serviceId;
  const step3Valid = !!item0?.description && item0.description.length >= 10 && item0?.quantity > 0;
  const step4Valid =
    !!address.cep &&
    address.cep.replace(/\D/g, "").length >= 8 &&
    !!address.street &&
    !!address.number &&
    !!address.city &&
    !!address.state;

  const validSteps: Record<number, boolean> = {
    1: step1Valid,
    2: step2Valid,
    3: step3Valid,
    4: step4Valid,
    5: true,
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
      form.trigger("items.0.providerId");
      return;
    }
    if (step === 2 && !step2Valid) {
      form.trigger("items.0.serviceId");
      return;
    }
    if (step === 3 && !step3Valid) {
      form.trigger("items.0.description");
      form.trigger("items.0.quantity");
      return;
    }
    if (step === 4 && !step4Valid) {
      form.trigger("address");
      return;
    }
    setStep((s) => Math.min(5, s + 1) as Step);
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1) as Step);

  const onSubmit = async (values: QuoteFormValues) => {
    if (!user) {
      toast.info("Faça cadastro gratuito para pedir orçamentos.");
      openAuth("register", "CLIENT");
      return;
    }
    const primary = values.items[0];
    if (!primary?.providerId) {
      toast.error("Selecione um prestador.");
      return;
    }
    setSubmitting(true);
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
      });
      toast.success("Orçamento enviado! O prestador responderá em breve.");
      close();
      navigate("client.quotes");
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ??
        "Não foi possível enviar o orçamento. Tente novamente.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step content ──
  const stepContent = (() => {
    switch (step) {
      case 1:
        return <Step1Provider form={form} />;
      case 2:
        return <Step2Service form={form} />;
      case 3:
        return <Step3Details form={form} />;
      case 4:
        return <Step4Address form={form} />;
      case 5:
        return <Step5Review form={form} goToStep={setStep} />;
      default:
        return null;
    }
  })();

  const wizardBody = (
    <StepWizard
      steps={STEPS}
      currentStep={step}
      validSteps={validSteps}
      onStepClick={handleStepClick}
      onBack={handleBack}
      onNext={handleNext}
      onSubmit={form.handleSubmit(onSubmit)}
      submitting={submitting}
      currentStepValid={validSteps[step] ?? true}
      submitLabel={
        <>
          <Send className="size-3.5" />
          Enviar orçamento
        </>
      }
    >
      {/* Auth gate — Nielsen #5: error prevention (remind user to login) */}
      {step === 1 && !user && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <LogIn className="size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Faça cadastro gratuito para pedir orçamentos
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              Seus dados ficam salvos para acompanhar as respostas.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => openAuth("register", "CLIENT")}
            className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white h-8"
          >
            Entrar
          </Button>
        </div>
      )}
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
              <Wrench className="size-4 text-emerald-600" />
              Pedir orçamento
            </SheetTitle>
            <SheetDescription className="text-xs">
              Descreva o serviço e receba propostas de prestadores verificados.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">{wizardBody}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="sm:max-w-2xl p-0 gap-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Nielsen #3: User control — prevent accidental close during wizard */}
        <DialogHeader className="px-5 pt-5 pb-2 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-4 text-emerald-600" />
            Pedir orçamento
          </DialogTitle>
          <DialogDescription className="text-xs">
            Descreva o serviço e receba propostas de prestadores verificados.
          </DialogDescription>
        </DialogHeader>
        {wizardBody}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Prestador (Select Provider)
// Nielsen #6: Recognition over recall — search with avatars and badges
// ---------------------------------------------------------------------------

function Step1Provider({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const item = form.watch("items.0");
  const error = form.formState.errors.items?.[0];

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={User}
        title="Escolha o prestador"
        description="Selecione o profissional que deseja orçar. Busque por nome ou serviço."
      />

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

      {/* Selected provider card — Nielsen #1: visibility of system status */}
      {item?.providerId && <SelectedProviderCard providerId={item.providerId} />}
    </div>
  );
}

function SelectedProviderCard({ providerId }: { providerId: string }) {
  const { data } = useQuery({
    queryKey: ["providers-options", ""],
    queryFn: () => apiGet<PagedResult<ProviderCard>>("/api/providers", { limit: 50 }),
    staleTime: 30 * 1000,
  });

  const provider = data?.items?.find((p) => p.id === providerId);
  if (!provider) return null;

  return (
    <InfoCard variant="emerald">
      <div className="flex items-center gap-3">
        <Avatar className="size-10 rounded-md">
          {provider.avatarUrl ? <AvatarImage src={provider.avatarUrl} alt={provider.name} /> : null}
          <AvatarFallback className="rounded-md bg-emerald-100 text-emerald-700 text-sm dark:bg-emerald-950 dark:text-emerald-300">
            {provider.name?.[0]?.toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{provider.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {provider.city ?? "—"}
            {provider.verified && " · Verificado ✓"}
          </p>
        </div>
        {provider.verified && (
          <Badge
            variant="outline"
            className="border-emerald-500 text-emerald-700 text-[10px] shrink-0"
          >
            Verificado
          </Badge>
        )}
      </div>
    </InfoCard>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Serviço (Select Service)
// Nielsen #6: Recognition over recall — list with prices visible
// ---------------------------------------------------------------------------

function Step2Service({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const item = form.watch("items.0");
  const error = form.formState.errors.items?.[0];

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Wrench}
        title="Qual serviço você precisa?"
        description="Escolha o tipo de serviço desejado deste prestador."
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

      {/* Selected service info — Nielsen #1: visibility of system status */}
      {item?.serviceId && (
        <ServiceInfoCard providerId={item.providerId ?? ""} serviceId={item.serviceId} />
      )}
    </div>
  );
}

function ServiceInfoCard({ providerId, serviceId }: { providerId: string; serviceId: string }) {
  const { data: services } = useQuery({
    queryKey: ["services-by-provider", providerId],
    queryFn: () => apiGet<ProviderService[]>("/api/services", { providerId }),
    enabled: !!providerId,
    staleTime: 30 * 1000,
  });

  const selected = services?.find((s) => s.id === serviceId);
  if (!selected) return null;

  return (
    <InfoCard variant="emerald">
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
    </InfoCard>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Detalhes (Service Details)
// Nielsen #5: Error prevention — character counter, inline validation
// Nielsen #8: Minimalist — clean form, focused on description
// ---------------------------------------------------------------------------

function Step3Details({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const item = form.watch("items.0");
  const error = form.formState.errors.items?.[0];
  const descLen = item?.description?.length ?? 0;

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Pencil}
        title="Descreva o serviço"
        description="Quanto mais detalhes, mais preciso será o orçamento."
      />

      {/* Description — Nielsen #5: error prevention with counter */}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="item-0-desc">Descrição do serviço</Label>
          <span
            className={cn(
              "text-xs tabular-nums",
              descLen < 10 ? "text-destructive" : "text-muted-foreground",
            )}
          >
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
          {error?.quantity && <p className="text-xs text-destructive">{error.quantity.message}</p>}
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

      {/* Photos — Nielsen #7: flexibility — optional but helpful */}
      <FilePhotos
        value={item?.photos ?? []}
        onChange={(photos) => form.setValue("items.0.photos", photos, { shouldDirty: true })}
        max={4}
        label="Fotos do serviço"
        hint="Envie até 4 imagens para ajudar o prestador a entender o serviço."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Endereço (Service Location)
// Nielsen #5: Error prevention — CEP auto-fill, GPS button
// ---------------------------------------------------------------------------

function Step4Address({ form }: { form: UseFormReturn<QuoteFormValues> }) {
  const address = form.watch("address");
  const errors = form.formState.errors.address;

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={MapPin}
        title="Onde será o serviço?"
        description="Informe o endereço ou use sua localização para preencher automaticamente."
      />

      <InfoCard>
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
      </InfoCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Revisão (Review & Send)
// Nielsen #3: User control — edit links to go back to any step
// Nielsen #9: Error recovery — review before submit
// Nielsen #10: Help & documentation — "what happens next" timeline
// ---------------------------------------------------------------------------

function Step5Review({
  form,
  goToStep,
}: {
  form: UseFormReturn<QuoteFormValues>;
  goToStep: (s: Step) => void;
}) {
  const item = form.watch("items.0");
  const address = form.watch("address");

  const { data: providerData } = useQuery({
    queryKey: ["providers-options", ""],
    queryFn: () => apiGet<PagedResult<ProviderCard>>("/api/providers", { limit: 50 }),
    staleTime: 30 * 1000,
  });

  const { data: services } = useQuery({
    queryKey: ["services-by-provider", item?.providerId],
    queryFn: () => apiGet<ProviderService[]>("/api/services", { providerId: item?.providerId }),
    enabled: !!item?.providerId,
    staleTime: 30 * 1000,
  });

  const providerName = providerData?.items?.find((p) => p.id === item?.providerId)?.name ?? "—";
  const serviceTitle = services?.find((s) => s.id === item?.serviceId)?.title ?? "—";

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Check}
        title="Revise seu pedido"
        description="Verifique as informações antes de enviar."
      />

      {/* Provider section */}
      <ReviewSection label="Prestador" onEdit={() => goToStep(1)}>
        <p className="text-sm font-medium">{providerName}</p>
      </ReviewSection>

      {/* Service section */}
      <ReviewSection label="Serviço" onEdit={() => goToStep(2)}>
        <p className="text-sm font-medium">{serviceTitle}</p>
        <Badge variant="secondary" className="mt-1">
          {item?.quantity ?? 0} {item?.unit ? SERVICE_UNIT_SHORT[item.unit] : "un"}
        </Badge>
      </ReviewSection>

      {/* Details section */}
      <ReviewSection label="Detalhes" onEdit={() => goToStep(3)}>
        <p className="text-sm text-muted-foreground line-clamp-3">{item?.description || "—"}</p>
        {item?.photos && item.photos.length > 0 && (
          <div className="flex gap-2 mt-2">
            {item.photos.map((url, i) => (
              <div key={url + i} className="size-12 overflow-hidden rounded-md border bg-muted">
                <Image
                  src={url}
                  alt={`Foto ${i + 1}`}
                  width={48}
                  height={48}
                  className="size-full object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </ReviewSection>

      {/* Address section */}
      <ReviewSection label="Endereço" onEdit={() => goToStep(4)}>
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
      </ReviewSection>

      {/* "What happens next?" — Nielsen #10: help & documentation */}
      <InfoCard variant="emerald" className="mt-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-1.5">
          <Clock className="size-3.5" />O que acontece agora?
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
                <p className="text-[11px] text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </InfoCard>

      {/* Security note */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-600" />
        Seus dados estão protegidos
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewSection — Editable review card
// Nielsen #3: User control & freedom — "Editar" links
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
// Provider combobox — Async search with avatars
// Nielsen #6: Recognition over recall — searchable list with visual cues
// ---------------------------------------------------------------------------

function ProviderCombobox({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (providerId: string) => void;
  error?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["providers-options", query],
    queryFn: () =>
      apiGet<PagedResult<ProviderCard>>("/api/providers", {
        q: query || undefined,
        limit: 20,
      }),
    staleTime: 30 * 1000,
  });

  const providers = data?.items ?? [];
  const selected = providers.find((p) => p.id === value);

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
              "w-full justify-between font-normal h-10",
              !value && "text-muted-foreground",
              error && "border-destructive",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {selected ? (
                <>
                  <Avatar className="size-6 rounded-sm">
                    {selected.avatarUrl ? (
                      <AvatarImage src={selected.avatarUrl} alt={selected.name} />
                    ) : null}
                    <AvatarFallback className="rounded-sm bg-emerald-100 text-emerald-700 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                      {selected.name?.[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{selected.name}</span>
                  {selected.verified && (
                    <Badge
                      variant="outline"
                      className="border-emerald-500 text-emerald-700 text-[10px]"
                    >
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
                      onChange(p.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        value === p.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Avatar className="size-7 rounded-sm">
                      {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                      <AvatarFallback className="rounded-sm bg-emerald-100 text-emerald-700 text-[10px] dark:bg-emerald-950 dark:text-emerald-300">
                        {p.name?.[0]?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.city ?? "—"}
                        {p.services?.[0]?.title ? ` · ${p.services[0].title}` : ""}
                      </p>
                    </div>
                    {p.verified && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500 text-emerald-700 text-[10px] ml-2 shrink-0"
                      >
                        ✓
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
  );
}

// ---------------------------------------------------------------------------
// Service select — Depends on chosen provider
// ---------------------------------------------------------------------------

function ServiceSelect({
  providerId,
  value,
  onChange,
  error,
}: {
  providerId: string;
  value: string;
  onChange: (service: ProviderService) => void;
  error?: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["services-by-provider", providerId],
    queryFn: () => apiGet<ProviderService[]>("/api/services", { providerId }),
    enabled: !!providerId,
    staleTime: 30 * 1000,
  });

  const services = data ?? [];
  const selected = services.find((s) => s.id === value);

  return (
    <div className="grid gap-1.5">
      <Label>Serviço</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          const s = services.find((x) => x.id === v);
          if (s) onChange(s);
        }}
        disabled={!providerId}
      >
        <SelectTrigger className={cn("w-full h-10", error && "border-destructive")}>
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
        <p className="text-xs text-muted-foreground line-clamp-2">{selected.description ?? "—"}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
