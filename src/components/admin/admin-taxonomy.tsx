"use client"

/**
 * AdminTaxonomy — gerenciador da árvore de categorias em 3 níveis.
 *
 * Heurísticas de Nielsen aplicadas neste redesign:
 *   H1  Visibilidade do status  → PageSectionHeader + contagem + SavingPill
 *   H2  Correspondência c/ mundo real → labels pt-BR; remoção do drag-handle
 *        visual-only (substituído por botões explícitos "Mover p/ cima/baixo")
 *   H3  Controle e liberdade    → ConfirmDialog antes de excluir; toggle c/ confirmação
 *   H4  Consistência            → StatusBadge (ÚNICA source of truth) p/ nível e estado
 *   H5  Prevenção de erros      → Switch não é instantâneo: abre ConfirmToggleDialog
 *   H6  Reconhecimento          → Select de ícones com preview; tooltips em icon-buttons
 *   H7  Eficiência              → Botões Mover p/ cima/baixo (disabled c/ tooltip honesto)
 *   H8  Minimalismo             → hierarquia clara, retirada de badge "serviço(s)" sem dados
 *   H9  Recuperar erros         → ErrorState c/ retry; toast específico p/ 409
 *   H10 Ajuda e documentação    → Info tooltip no campo Slug
 *
 * APIs (relativas, mantidas):
 *   GET    /api/categories
 *   POST   /api/categories            { name, slug, parentId?, level, icon?, order? }
 *   PATCH  /api/categories/[id]       { name?, slug?, parentId?, level?, icon?, order?, active? }
 *   DELETE /api/categories/[id]       (409 se tiver filhos ou serviços)
 *
 * Observação H7: a API atual não expõe endpoint de reordenação. Para não enganar
 * o administrador (H2), mantemos os botões "Mover p/ cima/baixo" visíveis mas
 * desabilitados com tooltip explicativo — em vez de um "drag handle" mudo que
 * sugere uma ação que não existe.
 */

import * as React from "react"
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  FolderTree,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  Wrench,
  Zap,
  Droplet,
  PaintRoller,
  Hammer,
  Trees,
  Sparkles,
  Home,
  ShowerHead,
  Thermometer,
  Car,
  ChefHat,
  type LucideIcon,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost, apiPatch, apiDelete, type Category } from "@/lib/api"
import { cn } from "@/lib/utils"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  PageSectionHeader,
  EmptyState,
  ErrorState,
  ConfirmDialog,
  ConfirmToggleDialog,
  StatusBadge,
  type StatusTone,
  errMsg,
  slugify,
} from "@/components/admin/admin-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * O endpoint /api/categories devolve a linha Prisma completa (inclui `active`,
 * `order`, `parentId`, `level`, `icon`, `createdAt`, `updatedAt`), mas o tipo
 * client-side `Category` de `@/lib/api` é mais estreito. Estendemos localmente.
 */
type CategoryRow = Category & {
  active: boolean
  order: number
  serviceCount?: number
}

type CategoryNode = Omit<CategoryRow, "children"> & {
  children?: CategoryNode[]
}

// ---------------------------------------------------------------------------
// Level metadata — H4 consistência: UMA source of truth via StatusTone
//   level 0 (Pai)          → emerald
//   level 1 (Filha)        → teal
//   level 2 (Subcategoria) → zinc
// Antes o nível 2 usava "slate" (divergia do comentário "lime"); padronizamos.
// ---------------------------------------------------------------------------
type LevelMeta = {
  label: string
  tone: StatusTone
  dot: string
  rowAccent: string
}

const LEVEL_META: Record<number, LevelMeta> = {
  0: {
    label: "Pai",
    tone: "sky",
    dot: "bg-sky-500",
    rowAccent: "border-l-2 border-sky-500/60",
  },
  1: {
    label: "Filha",
    tone: "teal",
    dot: "bg-teal-500",
    rowAccent: "border-l-2 border-teal-500/60",
  },
  2: {
    label: "Sub",
    tone: "zinc",
    dot: "bg-zinc-400",
    rowAccent: "border-l-2 border-zinc-400/70",
  },
}

// ---------------------------------------------------------------------------
// Icon picker — H6 reconhecimento: catálogo fixo dos 12 ícones lucide mais
// comuns, com preview. Se a categoria já tiver um ícone fora da lista,
// mostramos como entrada "personalizada".
// ---------------------------------------------------------------------------
type IconOption = { name: string; icon: LucideIcon; label: string }

const ICON_OPTIONS: IconOption[] = [
  { name: "Wrench", icon: Wrench, label: "Chave inglesa" },
  { name: "Zap", icon: Zap, label: "Raio (elétrica)" },
  { name: "Droplet", icon: Droplet, label: "Gota (hidráulica)" },
  { name: "PaintRoller", icon: PaintRoller, label: "Rolo de tinta" },
  { name: "Hammer", icon: Hammer, label: "Martelo" },
  { name: "Trees", icon: Trees, label: "Árvores (jardinagem)" },
  { name: "Sparkles", icon: Sparkles, label: "Brilho (limpeza)" },
  { name: "Home", icon: Home, label: "Casa" },
  { name: "ShowerHead", icon: ShowerHead, label: "Chuveiro" },
  { name: "Thermometer", icon: Thermometer, label: "Termômetro" },
  { name: "Car", icon: Car, label: "Carro" },
  { name: "ChefHat", icon: ChefHat, label: "Chef (gastronomia)" },
]

const ICON_BY_NAME = new Map(ICON_OPTIONS.map((o) => [o.name, o.icon]))

/**
 * Renderiza um ícone lucide pelo nome (H6 — preview).
 * Usa React.createElement para evitar o lint react-hooks/static-components,
 * que confunde variáveis capitalizadas com declaração de componente.
 */
function CategoryIcon({
  name,
  className,
}: {
  name?: string | null
  className?: string
}) {
  const Icon = name ? ICON_BY_NAME.get(name) : null
  if (!Icon) return null
  return React.createElement(Icon, { className })
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
type PendingToggle = {
  id: string
  name: string
  currentValue: boolean
} | null

export function AdminTaxonomy() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<CategoryNode | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryNode | null>(
    null,
  )
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [pendingToggle, setPendingToggle] = React.useState<PendingToggle>(null)

  const { data: flat, isLoading, isError, refetch } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiGet<CategoryRow[]>("/api/categories", { includeCount: "true" }),
    staleTime: 30_000,
  })

  // Build the tree (from a flat list)
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
        .sort(
          (a, b) =>
            (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
        )
        .map((n) => {
          const children = byParent.get(n.id) ?? []
          n.children = build(children)
          return n
        })
    return build(roots)
  }, [flat])

  // Service count por categoria — enriquecido via includeCount=true no backend

  // Auto-expand all level-0 nodes on first load — adjust state during render
  // (no effect: react-hooks/set-state-in-effect gate).
  const [prevTree, setPrevTree] = React.useState(tree)
  if (tree.length && expanded.size === 0 && tree !== prevTree) {
    setPrevTree(tree)
    setExpanded(new Set(tree.map((n) => n.id)))
  }

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
    onSuccess: (_d, vars) => {
      toast.success(
        vars.active
          ? "Categoria ativada."
          : "Categoria desativada.",
      )
      invalidate()
      setPendingToggle(null)
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Falha ao alternar o estado ativo."))
      setPendingToggle(null)
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
      // H9 — mensagem específica para 409 (vínculos existentes)
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

  // H5 — handler do confirm-toggle
  const handleToggleConfirm = () => {
    if (!pendingToggle) return
    toggleActiveMutation.mutate({
      id: pendingToggle.id,
      active: !pendingToggle.currentValue,
    })
  }

  const totalNodes = flat?.length ?? 0
  const expandAll = () => {
    if (!flat) return
    setExpanded(new Set(flat.map((c) => c.id)))
  }
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Taxonomia de categorias"
        description="Organize a árvore em até 3 níveis: pai, filha e subcategoria."
      />

      {/* Toolbar — H8 minimalismo, agrupa contagem + ações de árvore */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <FolderTree className="size-3.5 text-primary" />
            {totalNodes} {totalNodes === 1 ? "categoria" : "categorias"}
          </span>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            Níveis:
            {([0, 1, 2] as const).map((lv) => (
              <StatusBadge key={lv} tone={LEVEL_META[lv].tone}>
                <span className={cn("size-1.5 rounded-full", LEVEL_META[lv].dot)} />
                {LEVEL_META[lv].label}
              </StatusBadge>
            ))}
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

      {/* H9 — error recovery */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar a árvore de categorias"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => refetch()}
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border/50 shadow-none">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col gap-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-md" />
                ))}
              </div>
            ) : tree.length === 0 ? (
              <EmptyState
                icon={FolderTree}
                title="Nenhuma categoria cadastrada"
                description="Crie a primeira categoria pai para iniciar a taxonomia."
                action={
                  <Button
                    size="sm"
                    onClick={() => setCreateOpen(true)}
                    className="gap-1.5"
                  >
                    <Plus className="size-4" />
                    Criar primeira categoria
                  </Button>
                }
              />
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
                    onRequestToggleActive={(n) =>
                      setPendingToggle({
                        id: n.id,
                        name: n.name,
                        currentValue: n.active,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* H5 — confirmação de toggle (não-instantâneo) */}
      <ConfirmToggleDialog
        open={!!pendingToggle}
        onOpenChange={(open) => !open && setPendingToggle(null)}
        targetLabel={pendingToggle?.name ?? ""}
        field="active"
        currentValue={pendingToggle?.currentValue ?? false}
        onConfirm={handleToggleConfirm}
      />

      {/* H3/H5 — confirmação de exclusão */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Excluir categoria?"
        description={
          <>
            Você está prestes a excluir{" "}
            <strong className="text-foreground">
              {deleteTarget?.name}
            </strong>
            . Esta ação não pode ser desfeita. Categorias com filhos ou serviços
            vinculados não podem ser excluídas.
          </>
        }
        confirmLabel={deleteMutation.isPending ? "Excluindo…" : "Excluir"}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        variant="destructive"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// TreeNode — recursivo
// ---------------------------------------------------------------------------
function TreeNode({
  node,
  level,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onRequestToggleActive,
}: {
  node: CategoryNode
  level: number
  expanded: Set<string>
  onToggleExpand: (id: string) => void
  onEdit: (n: CategoryNode) => void
  onDelete: (n: CategoryNode) => void
  onRequestToggleActive: (n: CategoryNode) => void
}) {
  const meta = LEVEL_META[level] ?? LEVEL_META[0]
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = expanded.has(node.id)
  const hasIcon = !!node.icon && ICON_BY_NAME.has(node.icon)

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={false}
    >
      <div
        className={cn(
          "group relative flex flex-wrap items-center gap-2 border-b border-border/50 h-12 transition-colors hover:bg-muted/20 last:border-0",
          meta.rowAccent,
          !node.active && "opacity-60",
          level === 0 && "pl-3",
          level === 1 && "pl-6",
          level === 2 && "pl-12",
        )}
      >
        {/* Connecting line (visual, níveis aninhados) */}
        {level > 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-full border-l border-dashed border-border/50"
            style={{ marginLeft: `${(level - 1) * 12 + 14}px` }}
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

        {/* H7 — botões explícitos de mover (substituem o drag-handle mudo).
            API ainda não suporta reordenação — desabilitados c/ tooltip honesto. */}
        <div className="flex shrink-0 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label="Mover para cima (indisponível)">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled
                  className="size-7 text-muted-foreground/40"
                  aria-label="Mover para cima"
                >
                  <ChevronUp className="size-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Reordenação disponível em breve
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label="Mover para baixo (indisponível)">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled
                  className="size-7 text-muted-foreground/40"
                  aria-label="Mover para baixo"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Reordenação disponível em breve
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Name + level badge (H4 — StatusBadge ÚNICA source of truth) */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {hasIcon ? (
              <span className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground">
                <CategoryIcon name={node.icon} className="size-4" />
              </span>
            ) : null}
            <span className="truncate text-sm font-medium">{node.name}</span>
            <StatusBadge tone={meta.tone}>
              <span className={cn("size-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </StatusBadge>
            {!node.active ? (
              <StatusBadge tone="zinc">Inativa</StatusBadge>
            ) : null}
            {hasChildren ? (
              <StatusBadge tone="zinc">
                {node.children!.length}{" "}
                {node.children!.length === 1 ? "filha" : "filhas"}
              </StatusBadge>
            ) : null}
            {typeof node.serviceCount === "number" ? (
              <StatusBadge tone="zinc">
                {node.serviceCount}{" "}
                {node.serviceCount === 1 ? "serviço" : "serviços"}
              </StatusBadge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            /{node.slug}
            {typeof node.order === "number" ? ` · ordem ${node.order}` : ""}
          </p>
        </div>

        {/* Active toggle — H5: clique abre ConfirmToggleDialog */}
        <div className="flex items-center gap-1.5 pr-1">
          <Label
            htmlFor={`active-${node.id}`}
            className="hidden text-[11px] text-muted-foreground sm:block"
          >
            Ativa
          </Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Switch
                id={`active-${node.id}`}
                checked={node.active}
                onCheckedChange={() => onRequestToggleActive(node)}
                aria-label="Ativar ou desativar categoria (com confirmação)"
                className="data-[state=checked]:bg-emerald-600"
              />
            </TooltipTrigger>
            <TooltipContent>
              {node.active
                ? "Desativar categoria (com confirmação)"
                : "Ativar categoria (com confirmação)"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-primary"
                onClick={() => onEdit(node)}
                aria-label="Editar categoria"
              >
                <Pencil className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Editar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-red-600"
                onClick={() => onDelete(node)}
                aria-label="Excluir categoria"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Excluir</TooltipContent>
          </Tooltip>
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
              onRequestToggleActive={onRequestToggleActive}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// CategoryDialog — create / edit form (H6 icon picker, H10 slug help)
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
  const [icon, setIcon] = React.useState<string>("__none__")
  const [order, setOrder] = React.useState(0)
  const [active, setActive] = React.useState(true)

  // Reset form when opening — adjust state during render (no effect:
  // react-hooks/set-state-in-effect gate). Guard keyed by id (not object
  // identity) so a re-derived initial ref can never loop the render.
  const [prevDialogState, setPrevDialogState] = React.useState({
    open,
    initialId: initial?.id,
  })
  if (prevDialogState.open !== open || prevDialogState.initialId !== initial?.id) {
    setPrevDialogState({ open, initialId: initial?.id })
    if (open) {
      if (initial) {
        setName(initial.name)
        setSlug(initial.slug)
        setSlugTouched(true)
        setParentId(initial.parentId ?? "__none__")
        setIcon(initial.icon && initial.icon.length > 0 ? initial.icon : "__none__")
        setOrder(initial.order ?? 0)
        setActive(initial.active)
      } else {
        setName("")
        setSlug("")
        setSlugTouched(false)
        setParentId("__none__")
        setIcon("__none__")
        setOrder(0)
        setActive(true)
      }
    }
  }

  // Auto-generate slug from name unless user edited it manually — adjust
  // state during render (no effect: react-hooks/set-state-in-effect gate).
  const [prevSlugName, setPrevSlugName] = React.useState(name)
  if (!slugTouched && name !== prevSlugName) {
    setPrevSlugName(name)
    setSlug(slugify(name))
  }

  // Determine the level from the chosen parent
  const parent = allCategories.find((c) => c.id === parentId)
  const level = parent ? Math.min(2, parent.level + 1) : 0

  // Candidates for parent
  const parentCandidates = allCategories.filter(
    (c) => c.level < 2 && c.id !== initial?.id,
  )

  const canSubmit =
    name.trim().length >= 2 &&
    /^[a-z0-9-]+$/.test(slug) &&
    slug.length >= 2 &&
    !submitting

  // H6 — nome/preview do ícone atual
  const currentIconName = icon === "__none__" ? "" : icon
  const hasCurrentIcon = currentIconName.length > 0 && ICON_BY_NAME.has(currentIconName)
  const isCustomIcon =
    currentIconName.length > 0 && !ICON_BY_NAME.has(currentIconName)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      name: name.trim(),
      slug,
      parentId: parentId === "__none__" ? null : parentId,
      level,
      icon: currentIconName,
      order: Number.isFinite(order) ? order : 0,
      active,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {/* Name + slug (H10 — Info tooltip no Slug) */}
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
                className="h-9 rounded-lg border-input/60"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="cat-slug">
                  Slug <span className="text-red-500">*</span>
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="O que é um slug?"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="max-w-xs text-xs leading-relaxed"
                  >
                    Identificador único usado nas URLs. Gerado
                    automaticamente a partir do nome.
                  </TooltipContent>
                </Tooltip>
              </div>
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
                className="h-9 rounded-lg border-input/60"
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
                <SelectTrigger id="cat-parent" className="rounded-lg border-input/60">
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
              <div className="flex h-9 items-center gap-2 rounded-lg border border-input/60 bg-muted/40 px-3">
                <StatusBadge tone={LEVEL_META[level]?.tone ?? "sky"}>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      LEVEL_META[level]?.dot ?? "bg-sky-500",
                    )}
                  />
                  {LEVEL_META[level]?.label ?? "Pai"}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  Nível {level}
                </span>
              </div>
            </div>
          </div>

          {/* H6 — Icon picker (Select c/ preview) + Ordem */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-icon">Ícone (opcional)</Label>
              <div className="flex items-center gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-input/60 bg-muted/40">
                  {hasCurrentIcon ? (
                    <CategoryIcon name={currentIconName} className="size-4 text-foreground" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </span>
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger id="cat-icon" className="flex-1 rounded-lg border-input/60">
                    <SelectValue placeholder="Sem ícone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem ícone</SelectItem>
                    {ICON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.name} value={opt.name}>
                        <span className="inline-flex items-center gap-2">
                          <CategoryIcon name={opt.name} className="size-4" />
                          {opt.label}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {opt.name}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                    {/* H6 — se a categoria tem ícone fora da lista, mostrar como entrada custom */}
                    {isCustomIcon ? (
                      <SelectItem value={currentIconName}>
                        <span className="inline-flex items-center gap-2">
                          <span className="text-[10px]">★</span>
                          Personalizado: {currentIconName}
                        </span>
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Escolha um ícone que represente a categoria.
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
                className="h-9 rounded-lg border-input/60"
              />
              <p className="text-[11px] text-muted-foreground">
                Posição relativa entre irmãos (menor = antes).
              </p>
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div>
              <Label htmlFor="cat-active" className="text-sm font-medium">
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

          <DialogFooter className="gap-2">
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
// Local error retry (H9)
// ---------------------------------------------------------------------------
function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-6 py-14 text-center dark:border-rose-900/50 dark:bg-rose-950/30">
      <div className="flex size-14 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
        <FolderTree className="size-7" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">
        Não foi possível carregar a árvore de categorias
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-4 gap-1.5"
      >
        Tentar novamente
      </Button>
    </div>
  )
}
