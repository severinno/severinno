"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Loader2,
  Trash2,
  Wrench,
  AlertTriangle,
} from "lucide-react"

import { apiDelete, apiGet, apiPatch, apiPost, type Category } from "@/lib/api"
import {
  SERVICE_UNITS,
  SERVICE_UNIT_LABELS,
  type ServiceUnit,
} from "@/lib/constants"
import { serviceSchema, type ServiceInput } from "@/lib/validators"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { FilePhotos } from "@/components/modals/file-photos"
import { useAuthStore } from "@/store/auth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ServiceCategory = Category & { parentId?: string | null }

type ProviderService = {
  id: string
  providerId: string
  categoryId: string
  title: string
  description: string
  basePrice: number
  unit: ServiceUnit
  photos: string[]
  active: boolean
  createdAt: string
  updatedAt: string
  category?: ServiceCategory | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryPathChips(
  cat: ServiceCategory | null | undefined,
  all: Category[],
): Category[] {
  if (!cat) return []
  const chain: Category[] = []
  let current: Category | undefined = cat
  const guard = new Set<string>()
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    chain.unshift(current)
    current = current.parentId
      ? all.find((c) => c.id === current?.parentId)
      : undefined
  }
  return chain
}

// ---------------------------------------------------------------------------
// Service form (create/edit)
// ---------------------------------------------------------------------------

function ServiceFormDialog({
  open,
  onOpenChange,
  service,
  categories,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  service: ProviderService | null
  categories: Category[]
}) {
  const isEdit = !!service
  const qc = useQueryClient()

  // 3-level cascade selection
  const [parentCatId, setParentCatId] = React.useState<string>("")
  const [childCatId, setChildCatId] = React.useState<string>("")
  const [subCatId, setSubCatId] = React.useState<string>("")
  const [photos, setPhotos] = React.useState<string[]>([])

  // Level-0 categories (pais)
  const level0 = React.useMemo(
    () => categories.filter((c) => c.level === 0),
    [categories],
  )
  // Level-1 (filhas) given selected pai
  const level1 = React.useMemo(
    () => categories.filter((c) => c.level === 1 && c.parentId === parentCatId),
    [categories, parentCatId],
  )
  // Level-2 (subcategorias) given selected filha
  const level2 = React.useMemo(
    () => categories.filter((c) => c.level === 2 && c.parentId === childCatId),
    [categories, childCatId],
  )

  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema) as unknown as Resolver<ServiceInput>,
    defaultValues: {
      title: "",
      description: "",
      categoryId: "",
      basePrice: 0,
      unit: "UNIDADE",
      photos: [],
      active: true,
    },
  })

  // Hydrate React state when editing — adjust state during render (no effect:
  // react-hooks/set-state-in-effect gate). Guard trips on open transitions
  // and when a different service is selected. Keyed by id (not object
  // identity) so a re-derived service ref can never loop the render.
  const [prevEditState, setPrevEditState] = React.useState({
    open,
    serviceId: service?.id,
  })
  if (prevEditState.open !== open || prevEditState.serviceId !== service?.id) {
    setPrevEditState({ open, serviceId: service?.id })
    if (open) {
      if (service) {
        // Find category and walk up to determine pai → filha → sub
        const sub = categories.find((c) => c.id === service.categoryId)
        const filha = sub?.parentId
          ? categories.find((c) => c.id === sub?.parentId)
          : null
        const pai = filha?.parentId
          ? categories.find((c) => c.id === filha?.parentId)
          : null

        setParentCatId(pai?.id ?? "")
        setChildCatId(filha?.id ?? "")
        setSubCatId(sub?.id ?? service.categoryId)
        setPhotos(service.photos ?? [])
      } else {
        setParentCatId("")
        setChildCatId("")
        setSubCatId("")
        setPhotos([])
      }
    }
  }

  // RHF form hydration — reset-in-effect (the react-hook-form documented
  // pattern for syncing a form with props). Kept as an effect: the
  // set-state-in-effect rule only tracks React setState, and form.reset is a
  // control method (same as the setValue sync effects below).
  React.useEffect(() => {
    if (!open) return
    form.reset(
      service
        ? {
            title: service.title,
            description: service.description,
            categoryId: service.categoryId,
            basePrice: service.basePrice,
            unit: service.unit as ServiceUnit,
            photos: service.photos ?? [],
            active: service.active,
          }
        : {
            title: "",
            description: "",
            categoryId: "",
            basePrice: 0,
            unit: "UNIDADE",
            photos: [],
            active: true,
          },
    )
  }, [open, service, form])

  // Keep form's categoryId in sync with subCatId
  React.useEffect(() => {
    form.setValue("categoryId", subCatId)
  }, [subCatId, form])

  // Keep form's photos in sync
  React.useEffect(() => {
    form.setValue("photos", photos)
  }, [photos, form])

  const submit = form.handleSubmit(async (values) => {
    if (!subCatId) {
      toast.error("Selecione a subcategoria do serviço.")
      return
    }
    try {
      const payload = {
        ...values,
        categoryId: subCatId,
        photos,
      }
      if (isEdit && service) {
        await apiPatch(`/api/services/${service.id}`, payload)
        toast.success("Serviço atualizado com sucesso.")
      } else {
        await apiPost("/api/services", payload)
        toast.success("Serviço criado com sucesso.")
      }
      qc.invalidateQueries({ queryKey: ["provider", "services"] })
      onOpenChange(false)
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao salvar serviço.")
    }
  })

  const watchedPrice = useWatch({ control: form.control, name: "basePrice" })
  const currentPrice = service?.basePrice ?? 0
  const priceLowerThanCurrent =
    isEdit && Number(watchedPrice) < currentPrice

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar serviço" : "Novo serviço"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Atualize as informações do seu serviço."
              : "Cadastre um novo serviço que você oferece aos clientes."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4 py-2">
            {/* Category cascade */}
            <div className="grid gap-3">
              <div className="text-sm font-medium">Categoria</div>
              <p className="text-xs text-muted-foreground">
                Escolha pai → filha → subcategoria. A subcategoria é obrigatória.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <CategorySelect
                  label="Categoria pai"
                  placeholder="Selecione…"
                  value={parentCatId}
                  onChange={(v) => {
                    setParentCatId(v)
                    setChildCatId("")
                    setSubCatId("")
                  }}
                  options={level0}
                />
                <CategorySelect
                  label="Filha"
                  placeholder={parentCatId ? "Selecione…" : "—"}
                  value={childCatId}
                  onChange={(v) => {
                    setChildCatId(v)
                    setSubCatId("")
                  }}
                  options={level1}
                  disabled={!parentCatId}
                />
                <CategorySelect
                  label="Subcategoria"
                  placeholder={childCatId ? "Selecione…" : "—"}
                  value={subCatId}
                  onChange={setSubCatId}
                  options={level2}
                  disabled={!childCatId}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: Instalação de tomadas"
                      maxLength={80}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva o serviço, o que está incluso, condições…"
                      rows={4}
                      maxLength={1200}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Mínimo 10 caracteres. Máximo 1200.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="basePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preço base (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        {...field}
                        value={field.value ?? 0}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    {isEdit ? (
                      <FormDescription>
                        Preço atual: {formatBRL(currentPrice)}. Só é permitido
                        reajustar para cima.
                      </FormDescription>
                    ) : (
                      <FormDescription>
                        Preço mínimo sugerido para seus clientes.
                      </FormDescription>
                    )}
                    {priceLowerThanCurrent && (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="size-3" />
                        O novo preço é menor que o atual e será recusado pelo
                        servidor.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SERVICE_UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {SERVICE_UNIT_LABELS[u]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel className="m-0">Serviço ativo</FormLabel>
                    <FormDescription className="mt-1">
                      Serviços inativos não aparecem na vitrine.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FilePhotos
              value={photos}
              onChange={setPhotos}
              max={4}
              label="Fotos do serviço"
              hint="Até 4 fotos. JPG, PNG ou WEBP até 5MB cada."
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  !subCatId || priceLowerThanCurrent || form.formState.isSubmitting
                }
              >
                {form.formState.isSubmitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {isEdit ? "Salvar alterações" : "Criar serviço"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function CategorySelect({
  label,
  placeholder,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  options: Category[]
  disabled?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || options.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delete confirm
// ---------------------------------------------------------------------------

function DeleteServiceDialog({
  service,
  open,
  onOpenChange,
}: {
  service: ProviderService | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [loading, setLoading] = React.useState(false)

  const confirm = async () => {
    if (!service) return
    setLoading(true)
    try {
      await apiDelete(`/api/services/${service.id}`)
      toast.success("Serviço excluído.")
      qc.invalidateQueries({ queryKey: ["provider", "services"] })
      onOpenChange(false)
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao excluir serviço.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir serviço?</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja excluir{" "}
            <strong className="text-foreground">{service?.title}</strong>?
            Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 size-4" />
            )}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Service card
// ---------------------------------------------------------------------------

function ServiceCard({
  service,
  categories,
  onEdit,
  onDelete,
  onToggleActive,
  toggling,
}: {
  service: ProviderService
  categories: Category[]
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
  toggling: boolean
}) {
  const photo = service.photos?.[0]
  const chips = categoryPathChips(service.category, categories)
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={service.title}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
            <Wrench className="size-8" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              service.active
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
            )}
          >
            {service.active ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="line-clamp-2 text-sm font-semibold leading-tight">
          {service.title}
        </p>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {chips.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-2.5" />}
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                  {c.name}
                </span>
              </span>
            ))}
          </div>
        )}

        <p className="mt-auto text-sm">
          <span className="text-lg font-bold tabular-nums text-primary">
            {formatBRL(service.basePrice)}
          </span>
          <span className="text-xs text-muted-foreground">
            {" "}/ {SERVICE_UNIT_LABELS[service.unit]}
          </span>
        </p>

        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={service.active}
              onCheckedChange={onToggleActive}
              disabled={toggling}
              aria-label="Ativar/desativar serviço"
            />
            <span className="text-xs text-muted-foreground">
              {service.active ? "Ativo" : "Inativo"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <Pencil className="size-3.5" /> Editar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Excluir"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderServices() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ProviderService | null>(null)
  const [deleting, setDeleting] = React.useState<ProviderService | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [togglingId, setTogglingId] = React.useState<string | null>(null)

  const servicesQuery = useQuery<ProviderService[]>({
    queryKey: ["provider", "services", user?.id],
    queryFn: async () => {
      if (!user) return []
      return apiGet<ProviderService[]>("/api/services", {
        providerId: user.id,
      })
    },
    enabled: !!user,
  })

  const categoriesQuery = useQuery<Category[]>({
    queryKey: ["categories", "all"],
    queryFn: async () => apiGet<Category[]>("/api/categories"),
    staleTime: 5 * 60 * 1000,
  })

  const services = servicesQuery.data ?? []
  const filtered = React.useMemo(() => {
    if (!search.trim()) return services
    const q = search.toLowerCase()
    return services.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.category?.name?.toLowerCase().includes(q),
    )
  }, [services, search])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (s: ProviderService) => {
    setEditing(s)
    setDialogOpen(true)
  }

  const openDelete = (s: ProviderService) => {
    setDeleting(s)
    setDeleteOpen(true)
  }

  const toggleActive = async (s: ProviderService) => {
    setTogglingId(s.id)
    try {
      await apiPatch(`/api/services/${s.id}`, { active: !s.active })
      qc.invalidateQueries({ queryKey: ["provider", "services", user?.id] })
      toast.success(s.active ? "Serviço desativado." : "Serviço ativado.")
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao atualizar serviço.")
    } finally {
      setTogglingId(null)
    }
  }

  const totalActive = services.filter((s) => s.active).length
  const totalInactive = services.length - totalActive

  return (
    <div className="grid gap-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard label="Total" value={services.length} />
        <SummaryCard label="Ativos" value={totalActive} accent="emerald" />
        <SummaryCard label="Inativos" value={totalInactive} />
      </div>

      {/* Toolbar / filters bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar serviço…"
            className="pl-8"
          />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} serviço{filtered.length === 1 ? "" : "s"}
        </p>
        <Button
          onClick={openNew}
          className="ml-auto gap-1.5"
        >
          <Plus className="size-4" /> Novo serviço
        </Button>
      </div>

      {/* Grid */}
      {servicesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl border bg-muted/30"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Wrench className="size-6" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {search
                ? "Nenhum serviço encontrado"
                : "Você ainda não tem serviços cadastrados"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {search
                ? "Tente outro termo de busca."
                : "Cadastre seu primeiro serviço para aparecer na vitrine."}
            </p>
          </div>
          {!search && (
            <Button onClick={openNew} className="gap-1.5">
              <Plus className="size-4" /> Cadastrar serviço
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              categories={categoriesQuery.data ?? []}
              onEdit={() => openEdit(s)}
              onDelete={() => openDelete(s)}
              onToggleActive={() => toggleActive(s)}
              toggling={togglingId === s.id}
            />
          ))}
        </div>
      )}

      <ServiceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        service={editing}
        categories={categoriesQuery.data ?? []}
      />

      <DeleteServiceDialog
        service={deleting}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: "emerald"
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          accent === "emerald" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  )
}

export default ProviderServices
