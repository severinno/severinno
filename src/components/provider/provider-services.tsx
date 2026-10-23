"use client"
import * as React from "react"
import Image from "next/image"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Loader2,
  Trash2,
  Wrench,
  Camera,
  X,
  LayoutGrid,
  List,
  ArrowUpDown,
  Tag,
} from "lucide-react"

import { apiDelete, apiGet, apiPatch, type Category } from "@/lib/api"
import { SERVICE_UNIT_LABELS, SERVICE_UNIT_SHORT } from "@/lib/constants"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAuthStore } from "@/store/auth"
import {
  ServiceFormDialog,
  type ProviderService,
  type ServiceCategory,
} from "./service-form-dialog"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryPathChips(cat: ServiceCategory | null | undefined, all: Category[]): Category[] {
  if (!cat) return []
  const chain: Category[] = []
  let current: Category | undefined = cat
  const guard = new Set<string>()
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    chain.unshift(current)
    current = current.parentId ? all.find((c) => c.id === current?.parentId) : undefined
  }
  return chain
}

// ---------------------------------------------------------------------------
// Service form (create/edit)
// ---------------------------------------------------------------------------

// Service form (create/edit) is imported from ./service-form-dialog

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
            <strong className="text-foreground">{service?.title}</strong>? Esta ação não pode ser
            desfeita.
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
// Service card (Grid View)
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
  const categoryName = chips.length > 0 ? chips[chips.length - 1].name : service.category?.name

  return (
    <div className="bg-card group border-border/80 hover:border-primary/40 relative flex flex-col overflow-hidden rounded-2xl border shadow-xs transition-all hover:shadow-md">
      {/* Photo Header or Clean Icon Banner */}
      <div className="bg-muted/40 relative aspect-[16/10] w-full overflow-hidden">
        {photo ? (
          <Image
            src={photo}
            alt={service.title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-emerald-50/25 to-slate-100 p-4 text-center dark:from-slate-900/60 dark:via-emerald-950/20 dark:to-slate-900">
            <div className="border-border/50 text-primary flex size-11 items-center justify-center rounded-2xl border bg-white shadow-xs dark:bg-slate-800">
              <Wrench className="size-5" />
            </div>
            <span className="text-muted-foreground mt-1 text-[11px] font-medium">
              Sem fotos cadastradas
            </span>
            <button
              type="button"
              onClick={onEdit}
              className="text-primary mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
            >
              <Camera className="size-3" /> Adicionar fotos
            </button>
          </div>
        )}

        {/* Floating Category Pill */}
        {categoryName && (
          <div className="absolute top-2.5 left-2.5">
            <span className="border-border/60 bg-background/90 text-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold shadow-xs backdrop-blur-md">
              <Tag className="text-primary size-2.5" />
              {categoryName}
            </span>
          </div>
        )}

        {/* Floating Status Pill (Clickable Toggle) */}
        <div className="absolute top-2.5 right-2.5">
          <button
            type="button"
            onClick={onToggleActive}
            disabled={toggling}
            title="Clique para alternar visibilidade na vitrine"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium shadow-xs backdrop-blur-md transition-all",
              service.active
                ? "bg-emerald-600/90 text-white hover:bg-emerald-700"
                : "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-900",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", service.active ? "bg-white" : "bg-zinc-400")}
            />
            {service.active ? "Ativo" : "Inativo"}
          </button>
        </div>

        {/* Multiple photos counter */}
        {service.photos && service.photos.length > 1 && (
          <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
            {service.photos.length} fotos
          </div>
        )}
      </div>

      {/* Card Content */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-foreground group-hover:text-primary line-clamp-1 text-base font-semibold transition-colors">
          {service.title}
        </h3>

        {service.description ? (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
            {service.description}
          </p>
        ) : (
          <p className="text-muted-foreground/60 mt-1 text-xs italic">Sem descrição detalhada</p>
        )}

        {chips.length > 1 && (
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-1 text-[10px]">
            {chips.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="text-muted-foreground/40 size-2.5" />}
                <span className="bg-muted/60 rounded px-1.5 py-0.5 font-medium">{c.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Price & Unit */}
        <div className="border-border/50 mt-auto flex items-baseline justify-between border-t pt-3">
          <div>
            <span className="text-foreground text-xl font-bold tracking-tight tabular-nums">
              {formatBRL(service.basePrice)}
            </span>
            <span className="text-muted-foreground text-xs font-medium">
              {" "}
              / {SERVICE_UNIT_LABELS[service.unit]}
            </span>
          </div>
        </div>

        {/* Card Footer Actions */}
        <div className="border-border/40 mt-3 flex items-center justify-between border-t pt-2.5">
          <div className="flex items-center gap-2">
            <Switch
              checked={service.active}
              onCheckedChange={onToggleActive}
              disabled={toggling}
              aria-label="Visibilidade na vitrine"
            />
            <span className="text-muted-foreground text-xs font-medium">
              {service.active ? "Visível" : "Oculto"}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              className="h-8 gap-1.5 px-2.5 text-xs font-medium"
            >
              <Pencil className="size-3.5" /> Editar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive size-8"
              onClick={onDelete}
              aria-label="Excluir serviço"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Service table row (List View)
// ---------------------------------------------------------------------------

function ServiceTableRow({
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
  const categoryName = chips.length > 0 ? chips[chips.length - 1].name : service.category?.name

  return (
    <TableRow className="hover:bg-muted/30 transition-colors">
      <TableCell className="py-3">
        <div className="flex items-center gap-3">
          <div className="bg-muted/40 relative size-12 shrink-0 overflow-hidden rounded-xl border">
            {photo ? (
              <Image
                src={photo}
                alt={service.title}
                fill
                sizes="48px"
                className="object-cover"
                loading="lazy"
              />
            ) : (
              <div className="bg-muted/30 text-muted-foreground flex size-full items-center justify-center">
                <Wrench className="size-5" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-semibold">{service.title}</p>
            {service.description && (
              <p className="text-muted-foreground line-clamp-1 text-xs">{service.description}</p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="py-3">
        {categoryName ? (
          <span className="border-border/60 bg-muted/50 text-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">
            <Tag className="text-primary size-3" />
            {categoryName}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="py-3">
        <div className="flex items-baseline gap-1">
          <span className="text-foreground text-sm font-bold tabular-nums">
            {formatBRL(service.basePrice)}
          </span>
          <span className="text-muted-foreground text-xs">
            / {SERVICE_UNIT_SHORT[service.unit]}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={service.active}
            onCheckedChange={onToggleActive}
            disabled={toggling}
            aria-label="Ativar/desativar serviço"
          />
          <Badge
            className={cn(
              "py-0.2 inline-flex items-center gap-1 rounded-full px-2 text-[10px] font-medium shadow-none",
              service.active
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                service.active ? "bg-emerald-600 dark:bg-emerald-400" : "bg-zinc-400",
              )}
            />
            {service.active ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="h-8 gap-1 px-2.5 text-xs font-medium"
          >
            <Pencil className="size-3.5" /> Editar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive size-8"
            onClick={onDelete}
            aria-label="Excluir"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

type SortOption = "recent" | "price-asc" | "price-desc" | "name"
type ViewMode = "grid" | "list"

export function ProviderServices() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL")
  const [categoryFilter, setCategoryFilter] = React.useState<string>("ALL")
  const [sortBy, setSortBy] = React.useState<SortOption>("recent")
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid")
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

  const services = React.useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])

  // Business intelligence / Metrics
  const stats = React.useMemo(() => {
    const total = services.length
    const active = services.filter((s) => s.active).length
    const inactive = total - active
    const visibilityPercent = total > 0 ? Math.round((active / total) * 100) : 0
    const prices = services.map((s) => s.basePrice).filter((p) => p > 0)
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0

    return { total, active, inactive, visibilityPercent, minPrice, maxPrice, avgPrice }
  }, [services])

  // Categories in use by provider's services
  const categoriesInUse = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const s of services) {
      if (s.category?.id && s.category?.name) {
        map.set(s.category.id, s.category.name)
      } else if (s.categoryId) {
        const found = categoriesQuery.data?.find((c) => c.id === s.categoryId)
        if (found) {
          map.set(found.id, found.name)
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [services, categoriesQuery.data])

  // Filtered & Sorted
  const filteredAndSorted = React.useMemo(() => {
    let list = services.filter((s) => {
      if (statusFilter === "ACTIVE" && !s.active) return false
      if (statusFilter === "INACTIVE" && s.active) return false
      if (
        categoryFilter !== "ALL" &&
        s.categoryId !== categoryFilter &&
        s.category?.id !== categoryFilter
      ) {
        return false
      }
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        s.title.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.category?.name?.toLowerCase().includes(q)
      )
    })

    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "price-asc":
          return a.basePrice - b.basePrice
        case "price-desc":
          return b.basePrice - a.basePrice
        case "name":
          return a.title.localeCompare(b.title, "pt-BR")
        case "recent":
        default:
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      }
    })

    return list
  }, [services, statusFilter, categoryFilter, search, sortBy])

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
      toast.success(s.active ? "Serviço desativado." : "Serviço ativado na vitrine.")
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao atualizar serviço.")
    } finally {
      setTogglingId(null)
    }
  }

  const resetFilters = () => {
    setSearch("")
    setStatusFilter("ALL")
    setCategoryFilter("ALL")
  }

  const hasActiveFilters =
    search.trim() !== "" || statusFilter !== "ALL" || categoryFilter !== "ALL"

  return (
    <div className="grid gap-5">
      {/* Top Business Metrics Bar & Primary CTA - Nielsen #1 (Visibility of system status) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          <div className="bg-card/60 rounded-xl border px-3.5 py-2 backdrop-blur-xs">
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Total de Serviços
            </span>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-foreground text-lg font-bold tracking-tight tabular-nums">
                {stats.total}
              </span>
              <span className="text-muted-foreground text-xs">({stats.active} ativos)</span>
            </div>
          </div>

          <div className="bg-card/60 rounded-xl border px-3.5 py-2 backdrop-blur-xs">
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Visibilidade Vitrine
            </span>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-bold tracking-tight text-emerald-600 tabular-nums dark:text-emerald-400">
                {stats.visibilityPercent}%
              </span>
              <span className="text-muted-foreground text-xs">no ar</span>
            </div>
          </div>

          {stats.total > 0 && stats.maxPrice > 0 && (
            <div className="bg-card/60 col-span-2 rounded-xl border px-3.5 py-2 backdrop-blur-xs sm:col-span-1">
              <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                Ticket Médio
              </span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-foreground text-lg font-bold tracking-tight tabular-nums">
                  {formatBRL(stats.avgPrice)}
                </span>
                <span className="text-muted-foreground text-xs">(médio)</span>
              </div>
            </div>
          )}
        </div>

        <Button onClick={openNew} className="gap-1.5 shadow-sm sm:self-center">
          <Plus className="size-4" /> Novo serviço
        </Button>
      </div>

      {/* Unified Toolbar & Filter Bar - Nielsen #7 (Flexibility & efficiency of use) */}
      <div className="bg-card/80 flex flex-col gap-2.5 rounded-xl border p-2.5 shadow-2xs backdrop-blur-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Status Pills */}
          <div className="bg-muted/40 flex items-center gap-1 rounded-lg border p-1">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                statusFilter === "ALL"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Todos
              <span className="bg-muted py-0.2 rounded-full px-1.5 text-[10px] tabular-nums">
                {stats.total}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("ACTIVE")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                statusFilter === "ACTIVE"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Ativos
              <span className="py-0.2 rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800 tabular-nums dark:bg-emerald-950/60 dark:text-emerald-300">
                {stats.active}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("INACTIVE")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                statusFilter === "INACTIVE"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Inativos
              <span className="bg-muted py-0.2 rounded-full px-1.5 text-[10px] tabular-nums">
                {stats.inactive}
              </span>
            </button>
          </div>

          {/* Right side toolbar controls: Sort & View Mode Switcher */}
          <div className="flex items-center gap-2">
            {/* Sort Dropdown */}
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="h-8 w-36 gap-1.5 text-xs">
                <ArrowUpDown className="text-muted-foreground size-3.5" />
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="recent">Mais recentes</SelectItem>
                <SelectItem value="price-asc">Menor preço</SelectItem>
                <SelectItem value="price-desc">Maior preço</SelectItem>
                <SelectItem value="name">Nome (A-Z)</SelectItem>
              </SelectContent>
            </Select>

            {/* View Mode Toggle: Grid vs List */}
            <div className="bg-muted/40 inline-flex items-center rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-label="Visualização em grade"
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-all",
                  viewMode === "grid"
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="Visualização em lista"
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-all",
                  viewMode === "list"
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Search & Category Filter Sub-row */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar serviço por título ou descrição..."
              className="h-8 pr-8 pl-8 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {categoriesInUse.length > 1 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-52">
                <Tag className="text-muted-foreground size-3.5" />
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas as categorias</SelectItem>
                {categoriesInUse.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {servicesQuery.isLoading ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-muted/30 h-72 animate-pulse rounded-2xl border" />
            ))}
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border p-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-muted/30 h-12 animate-pulse rounded-lg" />
            ))}
          </div>
        )
      ) : filteredAndSorted.length === 0 ? (
        /* Empty State - Nielsen #9 (Help recover) & #10 (Help and documentation) */
        <div className="bg-card/40 flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
            <Wrench className="size-6" />
          </div>
          <div>
            <p className="text-foreground text-sm font-semibold">
              {hasActiveFilters
                ? "Nenhum serviço corresponde aos filtros selecionados"
                : "Você ainda não tem serviços cadastrados"}
            </p>
            <p className="text-muted-foreground mt-1 max-w-sm text-xs">
              {hasActiveFilters
                ? "Tente limpar os filtros de busca, status ou categoria para visualizar todos os serviços."
                : "Cadastre seus serviços com preços transparentes e fotos de qualidade para atrair clientes em Governador Valadares."}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button variant="outline" size="sm" onClick={resetFilters} className="gap-1.5 text-xs">
              <X className="size-3.5" /> Limpar filtros
            </Button>
          ) : (
            <Button onClick={openNew} className="gap-1.5 shadow-sm">
              <Plus className="size-4" /> Cadastrar primeiro serviço
            </Button>
          )}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAndSorted.map((s) => (
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
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border shadow-2xs">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[45%] text-xs font-semibold">Serviço</TableHead>
                <TableHead className="text-xs font-semibold">Categoria</TableHead>
                <TableHead className="text-xs font-semibold">Preço Base</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="w-24 text-right text-xs font-semibold">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSorted.map((s) => (
                <ServiceTableRow
                  key={s.id}
                  service={s}
                  categories={categoriesQuery.data ?? []}
                  onEdit={() => openEdit(s)}
                  onDelete={() => openDelete(s)}
                  onToggleActive={() => toggleActive(s)}
                  toggling={togglingId === s.id}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ServiceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        service={editing}
        categories={categoriesQuery.data ?? []}
      />

      <DeleteServiceDialog service={deleting} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}

export default ProviderServices
