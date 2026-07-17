"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useFieldArray, useForm, type Resolver, type UseFormReturn } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion, AnimatePresence } from "framer-motion"
import {
  Check,
  ChevronDown,
  Loader2,
  LogIn,
  MapPin,
  Plus,
  Trash2,
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
import { Separator } from "@/components/ui/separator"
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
// Form model — extends the API payload with per-item providerId
// (the API needs providerId per item, plus an outer providerId for the
//  primary provider — we mirror this by sending the first item's provider
//  as the outer providerId).
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
    // Cast around Zod 4's `z.coerce.number().optional()` typing (widens
    // input to `unknown`, breaks Resolver inference).
    resolver: zodResolver(quoteFormSchema) as unknown as Resolver<QuoteFormValues>,
    defaultValues: {
      items: [emptyItem(providerIdPreset, serviceIdPreset)],
      address: emptyAddress,
    },
    mode: "onTouched",
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  // Reset preset when modal opens.
  React.useEffect(() => {
    if (open) {
      form.reset({
        items: [emptyItem(providerIdPreset, serviceIdPreset)],
        address: emptyAddress,
      })
    }
  }, [open, providerIdPreset, serviceIdPreset, form])

  const [submitting, setSubmitting] = React.useState(false)

  const onSubmit = async (values: QuoteFormValues) => {
    // Prevention heuristic — must be authenticated.
    if (!user) {
      toast.info("Faça cadastro gratuito para pedir orçamentos.")
      openAuth("register", "CLIENT")
      return
    }

    // First item's provider = outer providerId (legacy API contract).
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
    <FormBody
      form={form}
      fields={fields}
      append={append}
      remove={remove}
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
            Solicite orçamentos de um ou mais serviços.
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

function FormBody({
  form,
  fields,
  append,
  remove,
  submitting,
  onSubmit,
}: {
  form: UseFormReturn<QuoteFormValues>
  fields: Record<"id", string>[]
  append: (v: QuoteItemForm) => void
  remove: (i: number) => void
  submitting: boolean
  onSubmit: () => void
}) {
  const items = form.watch("items")
  const address = form.watch("address")
  const errors = form.formState.errors
  const user = useAuthStore((s) => s.user)
  const openAuth = useUIStore((s) => s.openAuth)

  const canAddItem = items.length < 5

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <form
          id="quote-form"
          onSubmit={onSubmit}
          className="grid gap-5 px-4 sm:px-6 py-4"
        >
          {/* Auth gate */}
          {!user && (
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
          )}

          {/* Section 1 — items */}
          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                    1
                  </span>
                  Itens do orçamento
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adicione um ou mais serviços para cotar.
                </p>
              </div>
              <Badge variant="secondary">{items.length} item(s)</Badge>
            </div>

            <AnimatePresence initial={false}>
              {fields.map((field, index) => (
                <motion.div
                  key={field.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <ItemCard
                    index={index}
                    form={form}
                    onRemove={() => remove(index)}
                    canRemove={items.length > 1}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {errors.items?.message && (
              <p className="text-xs text-destructive">{errors.items.message}</p>
            )}

            {canAddItem && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  append(emptyItem(items[items.length - 1]?.providerId))
                }
                className="border-dashed border-primary/30 text-primary hover:border-primary hover:bg-primary/5"
              >
                <Plus className="size-4" />
                Adicionar item
              </Button>
            )}
          </section>

          <Separator />

          {/* Section 2 — address */}
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                2
              </span>
              Endereço do serviço
            </h3>
            <div className="rounded-xl border bg-card p-4">
              <AddressForm
                value={address}
                onChange={(v) => form.setValue("address", v, { shouldDirty: true })}
                errors={{
                  cep: errors.address?.cep?.message,
                  street: errors.address?.street?.message,
                  number: errors.address?.number?.message,
                  city: errors.address?.city?.message,
                  state: errors.address?.state?.message,
                }}
              />
            </div>
          </section>

          <Separator />

          {/* Section 3 — summary */}
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                3
              </span>
              Resumo
            </h3>
            <SummaryList items={items} address={address} />
          </section>

          {/* hidden submit for enter-key support */}
          <button type="submit" className="hidden" aria-hidden />
        </form>
      </ScrollArea>

      {/* Sticky footer */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {items.length} item(s) ·{" "}
            {new Set(items.map((i) => i.providerId).filter(Boolean)).size}{" "}
            prestador(es)
          </p>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="h-11 bg-emerald-600 hover:bg-emerald-700"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Enviar orçamentos
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-item card
// ---------------------------------------------------------------------------

function ItemCard({
  index,
  form,
  onRemove,
  canRemove,
}: {
  index: number
  form: UseFormReturn<QuoteFormValues>
  onRemove: () => void
  canRemove: boolean
}) {
  const item = form.watch(`items.${index}`)
  const error = form.formState.errors.items?.[index]

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Item {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
          >
            <Trash2 className="size-3.5" />
            Remover
          </button>
        )}
      </div>

      <div className="grid gap-3">
        {/* Provider combobox */}
        <ProviderCombobox
          value={item.providerId}
          onChange={(providerId) =>
            form.setValue(
              `items.${index}`,
              { ...item, providerId, serviceId: "" },
              { shouldDirty: true, shouldValidate: true },
            )
          }
          error={error?.providerId?.message}
        />

        {/* Service select (depends on provider) */}
        <ServiceSelect
          providerId={item.providerId}
          value={item.serviceId}
          onChange={(service) =>
            form.setValue(
              `items.${index}`,
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

        {/* Description */}
        <div className="grid gap-1.5">
          <Label htmlFor={`item-${index}-desc`}>Descrição do serviço</Label>
          <Textarea
            id={`item-${index}-desc`}
            placeholder="Ex.: Instalar tomada na parede da sala, fio visível."
            value={item.description}
            onChange={(e) =>
              form.setValue(`items.${index}.description`, e.target.value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            rows={3}
            aria-invalid={!!error?.description}
          />
          {error?.description && (
            <p className="text-xs text-destructive">
              {error.description.message}
            </p>
          )}
        </div>

        {/* Quantity + unit */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`item-${index}-qty`}>Quantidade</Label>
            <Input
              id={`item-${index}-qty`}
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              value={item.quantity}
              onChange={(e) =>
                form.setValue(
                  `items.${index}.quantity`,
                  Number(e.target.value),
                  { shouldDirty: true, shouldValidate: true },
                )
              }
              aria-invalid={!!error?.quantity}
            />
            {error?.quantity && (
              <p className="text-xs text-destructive">
                {error.quantity.message}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Unidade</Label>
            <Select
              value={item.unit}
              onValueChange={(v) =>
                form.setValue(`items.${index}.unit`, v as ServiceUnit, {
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
          value={item.photos}
          onChange={(photos) =>
            form.setValue(`items.${index}.photos`, photos, {
              shouldDirty: true,
            })
          }
          max={4}
          label="Fotos do serviço"
          hint="Você pode enviar até 4 imagens (5 MB cada)."
        />
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

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryList({
  items,
  address,
}: {
  items: QuoteItemForm[]
  address: AddressFormValue
}) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="grid gap-1.5">
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 border-b last:border-b-0 pb-1.5 last:pb-0"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">
                {it.description
                  ? it.description.slice(0, 60) +
                    (it.description.length > 60 ? "…" : "")
                  : `Item ${i + 1}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {it.quantity} {SERVICE_UNIT_SHORT[it.unit]}
                {it.photos.length > 0 && ` · ${it.photos.length} foto(s)`}
              </p>
            </div>
          </div>
        ))}
      </div>
      <Separator />
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5 mt-0.5 shrink-0 text-emerald-600" />
        <span>
          {address.street
            ? `${address.street}, ${address.number}${
                address.district ? ` - ${address.district}` : ""
              }`
            : "Endereço não informado"}
          {address.city ? ` · ${address.city}/${address.state}` : ""}
        </span>
      </div>
    </div>
  )
}
