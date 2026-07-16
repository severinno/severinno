"use client"

/**
 * AdminTaxonomy — the flagship 3-level category tree manager.
 *
 * Visualization:
 *   Level 0 (Categoria pai)    — emerald
 *   Level 1 (Categoria filha)  — teal
 *   Level 2 (Subcategoria)     — lime
 *
 * Features:
 *   - Expandable/collapsible tree (Accordion-style with custom tree UX)
 *   - Per-node: edit, toggle active, delete (with 409 guard)
 *   - "Nova categoria" dialog: name, slug (auto-generated), parent select,
 *     icon (lucide name), order
 *   - Inline edit dialog
 *   - Service count per category
 *   - Visual hierarchy with indentation + connecting lines + level badges
 *
 * APIs (relative):
 *   GET    /api/categories
 *   POST   /api/categories            { name, slug, parentId?, level, icon?, order? }
 *   PATCH  /api/categories/[id]       { name?, slug?, parentId?, level?, icon?, order?, active? }
 *   DELETE /api/categories/[id]       (409 if has children/services)
 */

import * as React from "react"
import {
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  FolderTree,
  GripVertical,
  ChevronsDownUp,
  ChevronsUpDown,
  Wrench,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost, apiPatch, apiDelete, type Category } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The /api/categories endpoint returns the full Prisma row (includes `active`,
 * `order`, `parentId`, `level`, `icon`, `createdAt`, `updatedAt`) — but the
 * client-side `Category` type from `@/lib/api` is narrower. Extend it locally
 * so we can read the extra fields.
 */
type CategoryRow = Category & {
  active: boolean
  order: number
}

type CategoryNode = Omit<CategoryRow, "children"> & {
  children?: CategoryNode[]
  serviceCount?: number
  childrenCount?: number
}

type LevelMeta = {
  label: string
  badgeClass: string
  rowAccent: string
  dot: string
}

const LEVEL_META: Record<number, LevelMeta> = {
  0: {
    label: "Pai",
    badgeClass:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    rowAccent: "border-l-2 border-emerald-500/60",
    dot: "bg-emerald-500",
  },
  1: {
    label: "Filha",
    badgeClass:
      "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
    rowAccent: "border-l-2 border-teal-500/60",
    dot: "bg-teal-500",
  },
  2: {
    label: "Subcategoria",
    badgeClass:
      "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200",
    rowAccent: "border-l-2 border-slate-400/70",
    dot: "bg-slate-400",
  },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AdminTaxonomy() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<CategoryNode | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryNode | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  const { data: flat, isLoading, isError } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiGet<CategoryRow[]>("/api/categories"),
    staleTime: 30_000,
  })

  // Build the tree + counts (from a flat list)
  const tree = React.useMemo<CategoryNode[]>(() => {
    if (!flat) return []
    const byParent = new Map<string | null, CategoryNode[]>()
    for (const c of flat) {
      const key = c.parentId ?? null
      const arr = byParent.get(key) ?? []
      arr.push({ ...c, children: [] })
      byParent.set(key, arr)
    }
    const roots = byParent.get(null) ?? []
    const build = (nodes: CategoryNode[]): CategoryNode[] =>
      nodes
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
        .map((n) => {
          const children = byParent.get(n.id) ?? []
          n.children = build(children)
          return n
        })
    return build(roots)
  }, [flat])

  const serviceCounts = React.useMemo(() => {
    // Service count is fetched per-category lazily via a separate query —
    // but for MVP we only have the flat /api/categories (no counts). We'll
    // render counts if present on the node (admin extensions may add later).
    return new Map<string, number>()
  }, [])

  // Auto-expand all level-0 nodes on first load
  React.useEffect(() => {
    if (tree.length && expanded.size === 0) {
      setExpanded(new Set(tree.map((n) => n.id)))
    }
  }, [tree, expanded.size])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["categories"] })

  const createMutation = useMutation({
    mutationFn: (payload: CategoryPayload) =>
      apiPost<{ category: CategoryRow }>("/api/categories", payload),
    onSuccess: () => {
      toast.success("Categoria criada com sucesso.")
      invalidate()
      setCreateOpen(false)
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Não foi possível criar a categoria."))
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CategoryPayload> }) =>
      apiPatch<{ category: CategoryRow }>(`/api/categories/${id}`, patch),
    onSuccess: () => {
      toast.success("Categoria atualizada.")
      invalidate()
      setEditTarget(null)
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Não foi possível atualizar a categoria."))
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPatch<{ category: CategoryRow }>(`/api/categories/${id}`, { active }),
    onSuccess: () => {
      invalidate()
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Falha ao alternar o estado ativo."))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/categories/${id}`),
    onSuccess: () => {
      toast.success("Categoria excluída.")
      invalidate()
      setDeleteTarget(null)
    },
    onError: (e: unknown) => {
      const msg = errMsg(e, "Não foi possível excluir.")
      // Special 409 message
      toast.error(msg, {
        description:
          "Remova os vínculos (filhos ou serviços) antes de tentar novamente.",
      })
    },
  })

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Não foi possível carregar a árvore de categorias.
        </CardContent>
      </Card>
    )
  }

  const totalNodes = flat?.length ?? 0
  const expandAll = () => {
    if (!flat) return
    setExpanded(new Set(flat.map((c) => c.id)))
  }
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <FolderTree className="size-3.5 text-primary" />
            {totalNodes} categoria(s)
          </span>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            Níveis:
            <Badge
              variant="secondary"
              className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Pai
            </Badge>
            <Badge
              variant="secondary"
              className="gap-1 bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200"
            >
              <span className="size-1.5 rounded-full bg-teal-500" />
              Filha
            </Badge>
            <Badge
              variant="secondary"
              className="gap-1 bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200"
            >
              <span className="size-1.5 rounded-full bg-slate-400" />
              Sub
            </Badge>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={expandAll}
            disabled={!flat || flat.length === 0}
            className="h-8 gap-1.5"
          >
            <ChevronsUpDown className="size-3.5" />
            Expandir tudo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={collapseAll}
            disabled={expanded.size === 0}
            className="h-8 gap-1.5"
          >
            <ChevronsDownUp className="size-3.5" />
            Recolher tudo
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="h-8 gap-1.5"
          >
            <Plus className="size-4" />
            Nova categoria
          </Button>
        </div>
      </div>

      {/* Tree */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : tree.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderTree className="size-7" />
              </div>
              <div>
                <p className="text-lg font-semibold">Nenhuma categoria cadastrada</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Crie a primeira categoria pai para iniciar a taxonomia.
                </p>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="size-4" />
                Criar primeira categoria
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col" role="tree">
              {tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  level={0}
                  expanded={expanded}
                  onToggleExpand={toggleExpand}
                  onEdit={(n) => setEditTarget(n)}
                  onDelete={(n) => setDeleteTarget(n)}
                  onToggleActive={(n, active) =>
                    toggleActiveMutation.mutate({ id: n.id, active })
                  }
                  serviceCounts={serviceCounts}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <CategoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Nova categoria"
        description="Defina o nome, slug e o pai. O nível é determinado automaticamente pelo pai escolhido."
        allCategories={(flat as CategoryRow[] | undefined) ?? []}
        submitting={createMutation.isPending}
        onSubmit={(p) => createMutation.mutate(p)}
      />

      {/* Edit dialog */}
      <CategoryDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Editar categoria"
        description="Altere os campos abaixo. Mudar o pai pode alterar o nível da categoria."
        allCategories={(flat as CategoryRow[] | undefined) ?? []}
        initial={editTarget ?? undefined}
        submitting={patchMutation.isPending}
        onSubmit={(p) => {
          if (!editTarget) return
          patchMutation.mutate({ id: editTarget.id, patch: p })
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir{" "}
              <strong className="text-foreground">
                {deleteTarget?.name}
              </strong>
              . Esta ação não pode ser desfeita. Categorias com filhos ou
              serviços vinculados não podem ser excluídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="gap-1.5 bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TreeNode — recursive
// ---------------------------------------------------------------------------
function TreeNode({
  node,
  level,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleActive,
  serviceCounts,
}: {
  node: CategoryNode
  level: number
  expanded: Set<string>
  onToggleExpand: (id: string) => void
  onEdit: (n: CategoryNode) => void
  onDelete: (n: CategoryNode) => void
  onToggleActive: (n: CategoryNode, active: boolean) => void
  serviceCounts: Map<string, number>
}) {
  const meta = LEVEL_META[level] ?? LEVEL_META[0]
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = expanded.has(node.id)
  const services = serviceCounts.get(node.id) ?? 0

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={false}
    >
      <div
        className={cn(
          "group flex items-center gap-2 border-b px-3 py-2.5 transition-colors hover:bg-muted/30 last:border-0",
          meta.rowAccent,
          !node.active && "opacity-60",
        )}
        style={{ paddingLeft: `${12 + level * 22}px` }}
      >
        {/* Connecting line (visual only, for nested levels) */}
        {level > 0 ? (
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full border-l border-dashed border-border"
            style={{ marginLeft: `${12 + (level - 1) * 22 + 8}px` }}
          />
        ) : null}

        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => hasChildren && onToggleExpand(node.id)}
          aria-label={isOpen ? "Recolher" : "Expandir"}
          disabled={!hasChildren}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
            hasChildren
              ? "hover:bg-accent hover:text-foreground"
              : "cursor-default opacity-30",
          )}
        >
          {hasChildren ? (
            <ChevronRight
              className={cn(
                "size-4 transition-transform",
                isOpen && "rotate-90",
              )}
            />
          ) : (
            <span className="size-1.5 rounded-full bg-current opacity-40" />
          )}
        </button>

        {/* Drag handle (visual only) */}
        <GripVertical
          className="size-4 shrink-0 cursor-grab text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/70"
          aria-hidden
        />

        {/* Name + level badge */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{node.name}</span>
            <Badge
              variant="secondary"
              className={cn(
                "h-5 gap-1 px-2 text-[10px] font-medium uppercase tracking-wide",
                meta.badgeClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </Badge>
            {!node.active ? (
              <Badge
                variant="outline"
                className="h-5 gap-1 px-2 text-[10px] font-medium text-muted-foreground"
              >
                Inativa
              </Badge>
            ) : null}
            {services > 0 ? (
              <Badge
                variant="outline"
                className="h-5 gap-1 px-2 text-[10px] font-medium"
              >
                <Wrench className="size-3" />
                {services} serviço(s)
              </Badge>
            ) : null}
            {hasChildren ? (
              <Badge
                variant="outline"
                className="h-5 gap-1 px-2 text-[10px] font-medium text-muted-foreground"
              >
                {node.children!.length} filha(s)
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            /{node.slug}
            {node.icon ? ` · ícone: ${node.icon}` : ""}
            {typeof node.order === "number" ? ` · ordem ${node.order}` : ""}
          </p>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-1.5 pr-1">
          <Label
            htmlFor={`active-${node.id}`}
            className="hidden text-[11px] text-muted-foreground sm:block"
          >
            Ativa
          </Label>
          <Switch
            id={`active-${node.id}`}
            checked={node.active}
            onCheckedChange={(v) => onToggleActive(node, v)}
            aria-label="Ativar ou desativar categoria"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-primary"
            onClick={() => onEdit(node)}
            aria-label="Editar categoria"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-red-600"
            onClick={() => onDelete(node)}
            aria-label="Excluir categoria"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isOpen ? (
        <ul role="group">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleActive={onToggleActive}
              serviceCounts={serviceCounts}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// CategoryDialog — create / edit form
// ---------------------------------------------------------------------------
type CategoryPayload = {
  name: string
  slug: string
  parentId?: string | null
  level: number
  icon?: string
  order: number
  active: boolean
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function CategoryDialog({
  open,
  onOpenChange,
  title,
  description,
  allCategories,
  initial,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  allCategories: CategoryRow[]
  initial?: CategoryNode
  submitting: boolean
  onSubmit: (payload: CategoryPayload) => void
}) {
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [parentId, setParentId] = React.useState<string>("__none__")
  const [icon, setIcon] = React.useState("")
  const [order, setOrder] = React.useState(0)
  const [active, setActive] = React.useState(true)

  // Reset form when opening
  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setSlug(initial.slug)
      setSlugTouched(true)
      setParentId(initial.parentId ?? "__none__")
      setIcon(initial.icon ?? "")
      setOrder(initial.order ?? 0)
      setActive(initial.active)
    } else {
      setName("")
      setSlug("")
      setSlugTouched(false)
      setParentId("__none__")
      setIcon("")
      setOrder(0)
      setActive(true)
    }
  }, [open, initial])

  // Auto-generate slug from name unless user edited it manually
  React.useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  // Determine the level from the chosen parent
  const parent = allCategories.find((c) => c.id === parentId)
  const level = parent ? Math.min(2, parent.level + 1) : 0

  // Candidates for parent (any node whose level allows a child at our intended level)
  // - To create a PAI (level 0): no parent.
  // - To create a FILHA (level 1): parent must be level 0.
  // - To create a SUB (level 2): parent must be level 1.
  const parentCandidates = allCategories.filter(
    (c) => c.level < 2 && c.id !== initial?.id,
  )

  const canSubmit =
    name.trim().length >= 2 &&
    /^[a-z0-9-]+$/.test(slug) &&
    slug.length >= 2 &&
    !submitting

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      name: name.trim(),
      slug,
      parentId: parentId === "__none__" ? null : parentId,
      level,
      icon: icon.trim() || "",
      order: Number.isFinite(order) ? order : 0,
      active,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-1">
          {/* Name + slug */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-name">
                Nome <span className="text-red-500">*</span>
              </Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Reparos"
                required
                maxLength={80}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-slug">
                Slug <span className="text-red-500">*</span>
              </Label>
              <Input
                id="cat-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugTouched(true)
                }}
                placeholder="reparos"
                required
                maxLength={80}
              />
              <p className="text-[11px] text-muted-foreground">
                Apenas letras minúsculas, números e hífens.
              </p>
            </div>
          </div>

          {/* Parent + level preview */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-parent">Categoria pai</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="cat-parent">
                  <SelectValue placeholder="Nenhuma (categoria pai)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    Nenhuma (categoria pai)
                  </SelectItem>
                  {parentCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {"—".repeat(c.level)} {c.name}{" "}
                      <span className="text-muted-foreground">
                        ({LEVEL_META[c.level]?.label})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Nível resultante</Label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3">
                <Badge
                  variant="secondary"
                  className={LEVEL_META[level]?.badgeClass}
                >
                  {LEVEL_META[level]?.label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Nível {level}
                </span>
              </div>
            </div>
          </div>

          {/* Icon + order */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-icon">Ícone (opcional)</Label>
              <Input
                id="cat-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="Ex.: Wrench (lucide)"
                maxLength={40}
              />
              <p className="text-[11px] text-muted-foreground">
                Nome de um ícone lucide-react.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-order">Ordem</Label>
              <Input
                id="cat-order"
                type="number"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                min={0}
              />
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label
                htmlFor="cat-active"
                className="text-sm font-medium"
              >
                Ativa
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Categorias inativas não aparecem na vitrine pública.
              </p>
            </div>
            <Switch
              id="cat-active"
              checked={active}
              onCheckedChange={setActive}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-1.5">
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {initial ? "Salvar alterações" : "Criar categoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message ?? fallback)
  }
  return fallback
}
