"use client"

/**
 * AdminTaxonomy — Gerenciador da árvore de categorias em 3 níveis orientada a serviços.
 *
 * Implementa com rigor as 10 Heurísticas de Usabilidade do Dr. Jakob Nielsen:
 *   H1  Visibilidade do status do sistema  → Métricas em tempo real (Total, Pais, Filhas, Subs),
 *                                            status ativo/inativo, contagem de serviços, spinner e SavingPills.
 *   H2  Correspondência c/ mundo real     → Metáforas de serviços residenciais e prediais ("hiperfofo"),
 *                                            ícones Lucide contextualizados, slogans e linguagem natural em pt-BR.
 *   H3  Controle e liberdade do usuário   → Expandir/recolher tudo, filtros instantâneos, botão de
 *                                            sincronização canônica (1-clique), cancelamento fácil em diálogos.
 *   H4  Consistência e padrões            → StatusBadges semânticos por nível (Sky, Teal, Zinc, Rose),
 *                                            tipografia e espaçamentos padronizados no Design System.
 *   H5  Prevenção de erros                → Slug auto-gerado com validação em tempo real, prevenção de
 *                                            hierarquias circulares, confirmação com diálogo antes de desativar/excluir.
 *   H6  Reconhecimento em vez de memória  → Busca instantânea com highlight, breadcrumbs visuais do caminho
 *                                            completo da categoria, seletor visual de ícones com preview.
 *   H7  Flexibilidade e eficiência de uso → Pílulas de filtro rápido por Macro-Domínio, filtro por nível,
 *                                            atalho direto "+ Nova Filha" em cada nó da árvore.
 *   H8  Estética e design minimalista     → Visual clean, acolhedor ("hiperfofo"), cantos arredondados,
 *                                            foco absoluto em clareza para impulsionar serviços digitais.
 *   H9  Ajudar a reconhecer e sanar erros → Mensagens de erro amigáveis, toasts descritivos com orientação
 *                                            clara (ex.: aviso de vínculos em exclusão 409).
 *   H10 Ajuda e documentação              → Guia colapsável explicando os 3 níveis da taxonomia e seu
 *                                            impacto na conversão de contratação de serviços.
 */

import * as React from "react"
import {
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  FolderTree,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  Search,
  RefreshCw,
  Sparkles,
  Layers,
  HelpCircle,
  X,
  Wrench,
  Zap,
  Droplet,
  PaintRoller,
  Hammer,
  Trees,
  Home,
  Truck,
  Siren,
  Flame,
  Waves,
  Box,
  Shield,
  HardHat,
  BrickWall,
  DoorClosed,
  Scissors,
  Plug,
  Ruler,
  Fan,
  Armchair,
  Camera,
  Dumbbell,
  Laptop,
  Utensils,
  PawPrint,
  HeartPulse,
  type LucideIcon,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost, apiPatch, apiDelete, type Category } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
} from "./_shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CategoryRow = Category & {
  active: boolean
  order: number
  serviceCount?: number
  description?: string | null
}

type CategoryNode = Omit<CategoryRow, "children"> & {
  children?: CategoryNode[]
}

// ---------------------------------------------------------------------------
// Level metadata — H4 consistência: UMA source of truth via StatusTone
// ---------------------------------------------------------------------------
type LevelMeta = {
  label: string
  tone: StatusTone
  dot: string
  rowAccent: string
}

const LEVEL_META: Record<number, LevelMeta> = {
  0: {
    label: "Macro-Domínio",
    tone: "sky",
    dot: "bg-sky-500",
    rowAccent: "border-l-4 border-sky-500/80 bg-sky-500/[0.02]",
  },
  1: {
    label: "Subcategoria",
    tone: "teal",
    dot: "bg-teal-500",
    rowAccent: "border-l-2 border-teal-500/70",
  },
  2: {
    label: "Especialidade",
    tone: "zinc",
    dot: "bg-zinc-400",
    rowAccent: "border-l-2 border-zinc-400/50",
  },
}

// ---------------------------------------------------------------------------
// Icon picker — H6 reconhecimento: catálogo visual com preview
// ---------------------------------------------------------------------------
type IconOption = { name: string; icon: LucideIcon; label: string }

const ICON_OPTIONS: IconOption[] = [
  { name: "Wrench", icon: Wrench, label: "Reparos / Ferramentas" },
  { name: "Zap", icon: Zap, label: "Elétrica / Energia" },
  { name: "Droplet", icon: Droplet, label: "Hidráulica / Água" },
  { name: "PaintRoller", icon: PaintRoller, label: "Pintura / Acabamento" },
  { name: "Hammer", icon: Hammer, label: "Reforma / Construção" },
  { name: "HardHat", icon: HardHat, label: "Obras / Alvenaria" },
  { name: "BrickWall", icon: BrickWall, label: "Paredes / Estrutura" },
  { name: "Trees", icon: Trees, label: "Jardim / Árvores" },
  { name: "Waves", icon: Waves, label: "Piscina / Lazer" },
  { name: "Sparkles", icon: Sparkles, label: "Limpeza / Brilho" },
  { name: "Home", icon: Home, label: "Casa / Residencial" },
  { name: "Truck", icon: Truck, label: "Mudança / Frete" },
  { name: "Box", icon: Box, label: "Organização / Caixas" },
  { name: "Siren", icon: Siren, label: "Emergência 24h" },
  { name: "Shield", icon: Shield, label: "Segurança / Proteção" },
  { name: "Flame", icon: Flame, label: "Gás / Churrasqueira" },
  { name: "Fan", icon: Fan, label: "Climatização / Ar" },
  { name: "DoorClosed", icon: DoorClosed, label: "Esquadrias / Portas" },
  { name: "Scissors", icon: Scissors, label: "Poda / Cortina" },
  { name: "Plug", icon: Plug, label: "Instalações Elétricas" },
  { name: "Ruler", icon: Ruler, label: "Projetos / Medição" },
  { name: "Armchair", icon: Armchair, label: "Decoração / Móveis" },
  { name: "Camera", icon: Camera, label: "Segurança Eletrônica" },
  { name: "Dumbbell", icon: Dumbbell, label: "Fitness / Lazer" },
  { name: "Laptop", icon: Laptop, label: "Informática / Rede" },
  { name: "Utensils", icon: Utensils, label: "Cozinha / Gastronomia" },
  { name: "PawPrint", icon: PawPrint, label: "Dedetização / Pets" },
  { name: "HeartPulse", icon: HeartPulse, label: "Cuidados / Saúde" },
]

const ICON_BY_NAME = new Map(ICON_OPTIONS.map((o) => [o.name, o.icon]))

function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
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
  const [createInitialParent, setCreateInitialParent] = React.useState<CategoryNode | null>(null)
  const [editTarget, setEditTarget] = React.useState<CategoryNode | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryNode | null>(null)
  const [userExpanded, setUserExpanded] = React.useState<Set<string> | null>(null)
  const [pendingToggle, setPendingToggle] = React.useState<PendingToggle>(null)

  // Filtros e busca (H6, H7)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedMacro, setSelectedMacro] = React.useState<string>("ALL")
  const [levelFilter, setLevelFilter] = React.useState<string>("ALL")
  const [showAllStatus, setShowAllStatus] = React.useState(false)
  const [showGuide, setShowGuide] = React.useState(false)

  // Query: busca categorias com suporte a flat e includeCount
  const {
    data: rawData,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["categories", "admin-flat", showAllStatus],
    queryFn: () =>
      apiGet<CategoryRow[]>(
        `/api/categories?flat=true${showAllStatus ? "&all=true" : ""}&includeCount=true`,
      ),
    staleTime: 30_000,
  })

  // Desdobra / achata qualquer resposta defensivamente (caso venha aninhada)
  const flat = React.useMemo<CategoryRow[]>(() => {
    if (!rawData || !Array.isArray(rawData)) return []
    const result: CategoryRow[] = []
    const seen = new Set<string>()
    function walk(list: CategoryRow[]) {
      for (const item of list) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          const { children, ...rest } = item as CategoryRow & { children?: CategoryRow[] }
          result.push(rest as CategoryRow)
          if (children && Array.isArray(children) && children.length > 0) {
            walk(children)
          }
        }
      }
    }
    walk(rawData)
    return result
  }, [rawData])

  // Constrói a árvore completa
  const fullTree = React.useMemo<CategoryNode[]>(() => {
    if (!flat || flat.length === 0) return []
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

  // Métricas do catálogo (H1 Visibilidade)
  const stats = React.useMemo(() => {
    const total = flat.length
    const active = flat.filter((c) => c.active).length
    const inactive = total - active
    const level0Count = flat.filter((c) => c.level === 0).length
    const level1Count = flat.filter((c) => c.level === 1).length
    const level2Count = flat.filter((c) => c.level === 2).length
    const totalServices = flat.reduce((sum, c) => sum + (c.serviceCount ?? 0), 0)
    return { total, active, inactive, level0Count, level1Count, level2Count, totalServices }
  }, [flat])

  // Lista dos Macro-Domínios (para o filtro de pílulas)
  const macroDomains = React.useMemo(() => {
    return fullTree.filter((n) => n.level === 0)
  }, [fullTree])

  // Filtro de busca e macro-domínio (H6, H7)
  const filteredTree = React.useMemo(() => {
    let result = fullTree

    // Filtro por Macro-Domínio
    if (selectedMacro !== "ALL") {
      result = result.filter((n) => n.id === selectedMacro || n.slug === selectedMacro)
    }

    // Filtro por Nível
    if (levelFilter !== "ALL") {
      const targetLevel = Number(levelFilter)
      if (targetLevel === 0) {
        result = result.map((n) => ({ ...n, children: [] }))
      } else if (targetLevel === 1) {
        result = result
          .map((root) => ({
            ...root,
            children: (root.children ?? []).map((sub) => ({ ...sub, children: [] })),
          }))
          .filter((root) => (root.children ?? []).length > 0)
      }
    }

    // Filtro por texto de busca
    const q = searchQuery.trim().toLowerCase()
    if (!q) return result

    function matchesSearch(node: CategoryNode): boolean {
      if (node.name.toLowerCase().includes(q) || node.slug.toLowerCase().includes(q)) return true
      if (node.description?.toLowerCase().includes(q)) return true
      return false
    }

    function filterNode(node: CategoryNode): CategoryNode | null {
      const matchedDirectly = matchesSearch(node)
      const filteredChildren = (node.children ?? [])
        .map(filterNode)
        .filter((child): child is CategoryNode => child !== null)

      if (matchedDirectly || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
        }
      }
      return null
    }

    return result.map(filterNode).filter((node): node is CategoryNode => node !== null)
  }, [fullTree, selectedMacro, levelFilter, searchQuery])

  // Estado reativo de busca e nós expandidos (sem useEffect/setState cascata)
  const isSearching = searchQuery.trim().length > 0
  const expanded = React.useMemo(() => {
    if (userExpanded !== null) return userExpanded
    // Por padrão no carregamento inicial, raízes (nível 0) vêm abertas
    return new Set(fullTree.map((n) => n.id))
  }, [userExpanded, fullTree])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["categories"] })

  // Mutações
  const createMutation = useMutation({
    mutationFn: (payload: CategoryPayload) =>
      apiPost<{ category: CategoryRow }>("/api/categories", payload),
    onSuccess: () => {
      toast.success("Categoria criada com sucesso.")
      invalidate()
      setCreateOpen(false)
      setCreateInitialParent(null)
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Não foi possível criar a categoria."))
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CategoryPayload> }) =>
      apiPatch<{ category: CategoryRow }>(`/api/categories/${id}`, patch),
    onSuccess: () => {
      toast.success("Categoria atualizada com sucesso.")
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
      toast.success(vars.active ? "Categoria ativada." : "Categoria desativada.")
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
      toast.success("Categoria excluída com sucesso.")
      invalidate()
      setDeleteTarget(null)
    },
    onError: (e: unknown) => {
      const msg = errMsg(e, "Não foi possível excluir.")
      toast.error(msg, {
        description: "Remova vínculos (filhos ou serviços) antes de tentar novamente.",
      })
    },
  })

  // Sincronização Canônica Oficial (1-Clique — H3, H9)
  const syncMutation = useMutation({
    mutationFn: () =>
      apiPost<{
        ok: boolean
        message: string
        total: number
        roots: number
        subcategories: number
        specialties: number
      }>("/api/admin/taxonomy/sync", {}),
    onSuccess: (res) => {
      toast.success("Catálogo Oficial Sincronizado!", {
        description: `${res.total} categorias canônicas (${res.roots} macro-domínios, ${res.subcategories} subcategorias e ${res.specialties} especialidades) estão atualizadas.`,
      })
      invalidate()
      refetch()
    },
    onError: (e: unknown) => {
      toast.error(errMsg(e, "Não foi possível sincronizar o catálogo canônico."))
    },
  })

  const toggleExpand = (id: string) =>
    setUserExpanded((prev) => {
      const base = prev ?? new Set(fullTree.map((n) => n.id))
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleToggleConfirm = () => {
    if (!pendingToggle) return
    toggleActiveMutation.mutate({
      id: pendingToggle.id,
      active: !pendingToggle.currentValue,
    })
  }

  const expandAll = () => {
    if (!flat) return
    setUserExpanded(new Set(flat.map((c) => c.id)))
  }
  const collapseAll = () => setUserExpanded(new Set())

  const handleOpenCreateWithParent = (parent: CategoryNode) => {
    setCreateInitialParent(parent)
    setCreateOpen(true)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho da Seção com Ação Canônica */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageSectionHeader
          title="Taxonomia de Categorias & Especialidades"
          description="Estrutura canônica em 3 níveis (Macro-Domínio → Subcategoria → Especialidade) orientada à conversão de serviços."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowGuide((prev) => !prev)}
            className="h-9 gap-1.5 rounded-xl border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
          >
            <HelpCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
            {showGuide ? "Ocultar Guia" : "Guia de Serviços"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="h-9 gap-1.5 rounded-xl border-sky-500/30 text-sky-700 hover:bg-sky-500/10 dark:text-sky-300"
          >
            {syncMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4 text-sky-600 dark:text-sky-400" />
            )}
            Sincronizar Canônico (129)
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setCreateInitialParent(null)
              setCreateOpen(true)
            }}
            className="h-9 gap-1.5 rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
          >
            <Plus className="size-4" />
            Nova Categoria
          </Button>
        </div>
      </div>

      {/* H10 — Guia Educacional e Heurísticas de Usabilidade (Hiperfofo) */}
      {showGuide && (
        <Card className="animate-in fade-in-50 rounded-2xl border-emerald-500/30 bg-emerald-500/[0.03] shadow-none duration-200">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-xl bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
                <Sparkles className="size-5" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-foreground text-sm font-semibold">
                    💡 Tendência de Consumo: Transformando Serviços Presenciais em Contratação
                    Digital
                  </h4>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-6"
                    onClick={() => setShowGuide(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  A taxonomia do Severinno foi desenhada sob as{" "}
                  <strong>10 Heurísticas de Usabilidade de Jakob Nielsen</strong> para eliminar
                  atritos cognitivos no momento da contratação:
                </p>
                <div className="grid grid-cols-1 gap-2.5 pt-1 text-xs sm:grid-cols-3">
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-2.5">
                    <p className="flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-300">
                      <span className="size-2 rounded-full bg-sky-500" /> Nível 0 — Macro-Domínio
                      (7)
                    </p>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      A porta de entrada emocional do cliente na vitrine (ex.:{" "}
                      <em>Reparos e Instalações</em>).
                    </p>
                  </div>
                  <div className="rounded-xl border border-teal-500/20 bg-teal-500/[0.04] p-2.5">
                    <p className="flex items-center gap-1.5 font-semibold text-teal-700 dark:text-teal-300">
                      <span className="size-2 rounded-full bg-teal-500" /> Nível 1 — Subcategoria
                      (36)
                    </p>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      O ramo de atividade buscado com clareza e precisão (ex.: <em>Elétrica</em>,{" "}
                      <em>Chaveiro 24h</em>).
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/[0.04] p-2.5">
                    <p className="text-foreground flex items-center gap-1.5 font-semibold">
                      <span className="size-2 rounded-full bg-zinc-400" /> Nível 2 — Especialidade
                      (86)
                    </p>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      O serviço exato a ser contratado no digital com preço e raio de atendimento
                      (ex.: <em>Eletricista</em>).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* H1 — Cards de Métricas e Status do Catálogo (Hiperfofo & Intuitivo) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div className="border-border/60 bg-card rounded-2xl border p-3.5 shadow-xs transition-all hover:border-emerald-500/40">
          <div className="text-muted-foreground flex items-center justify-between">
            <span className="text-xs font-medium">Total Geral</span>
            <FolderTree className="size-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-foreground mt-1 text-2xl font-bold tracking-tight">{stats.total}</p>
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            {stats.active} ativas no catálogo
          </span>
        </div>

        <div className="border-border/60 bg-card rounded-2xl border p-3.5 shadow-xs transition-all hover:border-sky-500/40">
          <div className="text-muted-foreground flex items-center justify-between">
            <span className="text-xs font-medium">Macro-Domínios</span>
            <span className="size-2 rounded-full bg-sky-500" />
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight text-sky-700 dark:text-sky-300">
            {stats.level0Count}
          </p>
          <span className="text-muted-foreground text-[11px]">Nível 0 (Raízes da Vitrine)</span>
        </div>

        <div className="border-border/60 bg-card rounded-2xl border p-3.5 shadow-xs transition-all hover:border-teal-500/40">
          <div className="text-muted-foreground flex items-center justify-between">
            <span className="text-xs font-medium">Subcategorias</span>
            <span className="size-2 rounded-full bg-teal-500" />
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight text-teal-700 dark:text-teal-300">
            {stats.level1Count}
          </p>
          <span className="text-muted-foreground text-[11px]">Nível 1 (Ramos Diretos)</span>
        </div>

        <div className="border-border/60 bg-card rounded-2xl border p-3.5 shadow-xs transition-all hover:border-zinc-500/40">
          <div className="text-muted-foreground flex items-center justify-between">
            <span className="text-xs font-medium">Especialidades</span>
            <span className="size-2 rounded-full bg-zinc-400" />
          </div>
          <p className="text-foreground mt-1 text-2xl font-bold tracking-tight">
            {stats.level2Count}
          </p>
          <span className="text-muted-foreground text-[11px]">Nível 2 (Profissionais)</span>
        </div>

        <div className="border-border/60 bg-card rounded-2xl border p-3.5 shadow-xs transition-all hover:border-amber-500/40">
          <div className="text-muted-foreground flex items-center justify-between">
            <span className="text-xs font-medium">Serviços Vinculados</span>
            <Wrench className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300">
            {stats.totalServices}
          </p>
          <span className="text-muted-foreground text-[11px]">Ofertas cadastradas</span>
        </div>

        <div className="border-border/60 bg-card rounded-2xl border p-3.5 shadow-xs transition-all hover:border-purple-500/40">
          <div className="text-muted-foreground flex items-center justify-between">
            <span className="text-xs font-medium">Visibilidade</span>
            <Switch
              checked={showAllStatus}
              onCheckedChange={setShowAllStatus}
              className="scale-75"
              aria-label="Alternar exibição de inativas"
            />
          </div>
          <p className="text-foreground mt-1 text-sm font-semibold">
            {showAllStatus ? "Todas (c/ Inativas)" : "Apenas Ativas"}
          </p>
          <span className="text-muted-foreground text-[11px]">
            {stats.inactive > 0 ? `${stats.inactive} inativas ocultas` : "0 inativas"}
          </span>
        </div>
      </div>

      {/* H7 — Pílulas Rápidas por Macro-Domínio (Hiperfofo & Direto) */}
      <div className="flex scrollbar-none items-center gap-2 overflow-x-auto pb-1">
        <Button
          variant={selectedMacro === "ALL" ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedMacro("ALL")}
          className={cn(
            "h-8 shrink-0 gap-1.5 rounded-full text-xs font-medium transition-all",
            selectedMacro === "ALL"
              ? "bg-foreground text-background shadow-xs"
              : "border-border/60 hover:bg-muted/60",
          )}
        >
          <Layers className="size-3.5" />
          Todos os Macro-Domínios ({stats.total})
        </Button>
        {macroDomains.map((macro) => {
          const isSelected = selectedMacro === macro.id || selectedMacro === macro.slug
          return (
            <Button
              key={macro.id}
              variant={isSelected ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedMacro(macro.id)}
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-full text-xs font-medium transition-all",
                isSelected
                  ? "bg-sky-600 text-white shadow-xs hover:bg-sky-700"
                  : "border-border/60 hover:bg-muted/60",
                macro.slug === "emergencia-24h" &&
                  !isSelected &&
                  "border-rose-500/30 text-rose-600 dark:text-rose-400",
              )}
            >
              {macro.icon ? <CategoryIcon name={macro.icon} className="size-3.5" /> : null}
              {macro.name}
              <span className="py-0.2 ml-0.5 rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/10">
                {(macro.children ?? []).length}
              </span>
            </Button>
          )
        })}
      </div>

      {/* Toolbar de Controle, Busca e Ações em Árvore (H3, H6, H7) */}
      <div className="border-border/60 bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 shadow-xs">
        {/* Campo de Busca Rápida (H6) */}
        <div className="relative max-w-md min-w-[240px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por categoria, especialidade ou slug..."
            className="border-input/60 h-9 rounded-xl pr-8 pl-9 text-xs focus-visible:ring-emerald-500/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filtro por Nível e Expansão (H3, H7) */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="border-input/60 h-8 w-auto min-w-[140px] rounded-xl text-xs">
              <SelectValue placeholder="Filtrar nível" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os Níveis</SelectItem>
              <SelectItem value="0">Nível 0 (Macro)</SelectItem>
              <SelectItem value="1">Nível 1 (Subcategoria)</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={expandAll}
            disabled={!flat || flat.length === 0}
            className="border-input/60 h-8 gap-1.5 rounded-xl text-xs"
          >
            <ChevronsUpDown className="size-3.5" />
            Expandir tudo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={collapseAll}
            disabled={expanded.size === 0}
            className="border-input/60 h-8 gap-1.5 rounded-xl text-xs"
          >
            <ChevronsDownUp className="size-3.5" />
            Recolher tudo
          </Button>
        </div>
      </div>

      {/* Árvore de Categorias com Renderização Recursiva e Estados */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar a árvore de categorias"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => refetch()}
        />
      ) : (
        <Card className="border-border/60 overflow-hidden rounded-2xl shadow-xs">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col gap-2 p-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredTree.length === 0 ? (
              <EmptyState
                icon={FolderTree}
                title={
                  searchQuery
                    ? "Nenhuma categoria encontrada para a busca"
                    : "Nenhuma categoria cadastrada"
                }
                description={
                  searchQuery
                    ? "Tente buscar por outro termo ou limpe o filtro de busca."
                    : "Sincronize o catálogo canônico de 129 categorias ou crie a primeira categoria."
                }
                action={
                  searchQuery ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSearchQuery("")}
                      className="gap-1.5 rounded-xl"
                    >
                      Limpar busca
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => syncMutation.mutate()}
                      className="gap-1.5 rounded-xl bg-emerald-600 text-white"
                    >
                      <RefreshCw className="size-4" />
                      Sincronizar Catálogo Canônico
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="divide-border/40 flex flex-col divide-y" role="tree">
                {filteredTree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    level={0}
                    expanded={expanded}
                    isSearching={isSearching}
                    onToggleExpand={toggleExpand}
                    onEdit={(n) => setEditTarget(n)}
                    onDelete={(n) => setDeleteTarget(n)}
                    onAddChild={handleOpenCreateWithParent}
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

      {/* Diálogo de Criação (H5, H6, H10) */}
      <CategoryDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setCreateInitialParent(null)
        }}
        title={
          createInitialParent ? `Nova Filha em: ${createInitialParent.name}` : "Nova Categoria"
        }
        description="Defina o nome, slug e categoria pai. O nível é calculado de forma automática."
        allCategories={flat}
        initialParent={createInitialParent ?? undefined}
        submitting={createMutation.isPending}
        onSubmit={(p) => createMutation.mutate(p)}
      />

      {/* Diálogo de Edição */}
      <CategoryDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Editar Categoria"
        description="Altere os parâmetros da categoria. Mudanças de pai reorganizam a árvore."
        allCategories={flat}
        initial={editTarget ?? undefined}
        submitting={patchMutation.isPending}
        onSubmit={(p) => {
          if (!editTarget) return
          patchMutation.mutate({ id: editTarget.id, patch: p })
        }}
      />

      {/* H5 — Confirmação de Toggle de Ativação */}
      <ConfirmToggleDialog
        open={!!pendingToggle}
        onOpenChange={(open) => !open && setPendingToggle(null)}
        targetLabel={pendingToggle?.name ?? ""}
        field="active"
        currentValue={pendingToggle?.currentValue ?? false}
        onConfirm={handleToggleConfirm}
      />

      {/* H3, H5 — Confirmação Segura de Exclusão */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Excluir categoria?"
        description={
          <>
            Você está prestes a excluir a categoria{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong>. Esta ação não pode
            ser desfeita. Categorias com filhas ou serviços associados são protegidas contra
            exclusão.
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
// TreeNode — Componente Recursivo da Árvore
// ---------------------------------------------------------------------------
function TreeNode({
  node,
  level,
  expanded,
  isSearching,
  onToggleExpand,
  onEdit,
  onDelete,
  onAddChild,
  onRequestToggleActive,
}: {
  node: CategoryNode
  level: number
  expanded: Set<string>
  isSearching: boolean
  onToggleExpand: (id: string) => void
  onEdit: (n: CategoryNode) => void
  onDelete: (n: CategoryNode) => void
  onAddChild: (parent: CategoryNode) => void
  onRequestToggleActive: (n: CategoryNode) => void
}) {
  const meta = LEVEL_META[level] ?? LEVEL_META[2]
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = isSearching || expanded.has(node.id)
  const hasIcon = !!node.icon && ICON_BY_NAME.has(node.icon)
  const isEmergency = node.slug === "emergencia-24h" || node.slug.endsWith("-emergencia-24h")

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={false}>
      <div
        className={cn(
          "group hover:bg-muted/30 relative flex min-h-[50px] items-center gap-2 px-3 py-2 transition-colors",
          meta.rowAccent,
          !node.active && "opacity-50 grayscale-20",
          level === 0 && "font-medium",
          level === 1 && "pl-8 sm:pl-10",
          level === 2 && "pl-14 sm:pl-16",
        )}
      >
        {/* Linha conectora visual para níveis aninhados */}
        {level > 0 && (
          <span
            aria-hidden
            className="border-border/40 pointer-events-none absolute top-0 left-0 h-full border-l border-dashed"
            style={{ marginLeft: `${level === 1 ? 18 : 34}px` }}
          />
        )}

        {/* Botão de Expandir / Recolher */}
        <button
          type="button"
          onClick={() => hasChildren && onToggleExpand(node.id)}
          aria-label={isOpen ? "Recolher" : "Expandir"}
          disabled={!hasChildren}
          className={cn(
            "text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-all",
            hasChildren
              ? "hover:bg-accent hover:text-foreground cursor-pointer"
              : "cursor-default opacity-20",
          )}
        >
          {hasChildren ? (
            <ChevronRight
              className={cn("size-4 transition-transform duration-200", isOpen && "rotate-90")}
            />
          ) : (
            <span className="size-1.5 rounded-full bg-current opacity-40" />
          )}
        </button>

        {/* Ícone da Categoria com container suave */}
        <div
          className={cn(
            "border-border/50 flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
            level === 0
              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
              : "bg-muted/40 text-muted-foreground",
            isEmergency && "border-rose-500/30 bg-rose-500/10 text-rose-600",
          )}
        >
          {hasIcon ? (
            <CategoryIcon name={node.icon} className="size-4" />
          ) : (
            <span className="text-[10px] font-bold opacity-60">#{level}</span>
          )}
        </div>

        {/* Nome, Slug e Badges Semânticos (H1, H4) */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "text-foreground truncate text-xs font-medium sm:text-sm",
                level === 0 && "font-semibold",
              )}
            >
              {node.name}
            </span>

            {/* Badge de Nível */}
            <StatusBadge tone={isEmergency ? "rose" : meta.tone}>
              <span
                className={cn("size-1.5 rounded-full", isEmergency ? "bg-rose-500" : meta.dot)}
              />
              {meta.label}
            </StatusBadge>

            {/* Badge de Ativa / Inativa */}
            {!node.active && <StatusBadge tone="zinc">Inativa</StatusBadge>}

            {/* Contagem de Filhas */}
            {hasChildren && (
              <span className="bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
                {node.children!.length} {node.children!.length === 1 ? "filha" : "filhas"}
              </span>
            )}

            {/* Contagem de Serviços */}
            {typeof node.serviceCount === "number" && node.serviceCount > 0 && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {node.serviceCount} {node.serviceCount === 1 ? "serviço" : "serviços"}
              </span>
            )}
          </div>

          {/* Slogan ou Slug */}
          <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
            /{node.slug}
            {node.description ? ` · "${node.description}"` : ""}
            {typeof node.order === "number" && node.order > 0 ? ` · ordem ${node.order}` : ""}
          </p>
        </div>

        {/* Ação Rápida: "+ Nova Filha" (H7 Eficiência) */}
        {level < 2 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddChild(node)}
                className="hidden h-7 gap-1 rounded-lg px-2 text-xs text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 sm:inline-flex"
              >
                <Plus className="size-3.5" />
                <span>{level === 0 ? "Nova Filha" : "Nova Sub"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Adicionar categoria filha sob {node.name}</TooltipContent>
          </Tooltip>
        )}

        {/* Toggle Ativa/Inativa (H5) */}
        <div className="flex items-center gap-1.5 pr-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Switch
                id={`active-${node.id}`}
                checked={node.active}
                onCheckedChange={() => onRequestToggleActive(node)}
                aria-label="Ativar ou desativar categoria"
                className="scale-85 data-[state=checked]:bg-emerald-600"
              />
            </TooltipTrigger>
            <TooltipContent>
              {node.active ? "Desativar categoria (com confirmação)" : "Ativar categoria"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Ações de Edição e Exclusão */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary size-7 rounded-lg"
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
                className="text-muted-foreground size-7 rounded-lg hover:text-red-600"
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

      {/* Filhos da Categoria (Recursão) */}
      {hasChildren && isOpen && (
        <ul role="group" className="relative">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expanded={expanded}
              isSearching={isSearching}
              onToggleExpand={onToggleExpand}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onRequestToggleActive={onRequestToggleActive}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// CategoryDialog — Formulário de Criação e Edição (H5, H6, H10)
// ---------------------------------------------------------------------------
type CategoryPayload = {
  name: string
  slug: string
  parentId?: string | null
  level: number
  icon?: string
  description?: string
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
  initialParent,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  allCategories: CategoryRow[]
  initial?: CategoryNode
  initialParent?: CategoryNode
  submitting: boolean
  onSubmit: (payload: CategoryPayload) => void
}) {
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [parentId, setParentId] = React.useState<string>("__none__")
  const [icon, setIcon] = React.useState<string>("__none__")
  const [catDescription, setCatDescription] = React.useState("")
  const [order, setOrder] = React.useState(0)
  const [active, setActive] = React.useState(true)

  // Sincroniza formulário na abertura sem efeito colateral cascata
  const [prevKey, setPrevKey] = React.useState<string | null>(null)
  const currentKey = open
    ? initial
      ? `edit-${initial.id}`
      : initialParent
        ? `new-${initialParent.id}`
        : "new-root"
    : null

  if (open && prevKey !== currentKey) {
    setPrevKey(currentKey)
    if (initial) {
      setName(initial.name)
      setSlug(initial.slug)
      setSlugTouched(true)
      setParentId(initial.parentId ?? "__none__")
      setIcon(initial.icon && initial.icon.length > 0 ? initial.icon : "__none__")
      setCatDescription(initial.description ?? "")
      setOrder(initial.order ?? 0)
      setActive(initial.active)
    } else {
      setName("")
      setSlug("")
      setSlugTouched(false)
      setParentId(initialParent ? initialParent.id : "__none__")
      setIcon("__none__")
      setCatDescription("")
      setOrder(0)
      setActive(true)
    }
  } else if (!open && prevKey !== null) {
    setPrevKey(null)
  }

  // Slug derivado automaticamente até edição manual (H5)
  const effectiveSlug = slugTouched ? slug : slugify(name)

  // Nível calculado com base no pai selecionado
  const selectedParentObj = allCategories.find((c) => c.id === parentId)
  const computedLevel = selectedParentObj ? Math.min(2, selectedParentObj.level + 1) : 0

  // Candidatos válidos para pai (nível < 2 e excluindo o próprio nó para evitar ciclos)
  const parentCandidates = React.useMemo(() => {
    return allCategories
      .filter((c) => c.level < 2 && c.id !== initial?.id)
      .sort(
        (a, b) =>
          a.level - b.level || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
      )
  }, [allCategories, initial])

  const canSubmit =
    name.trim().length >= 2 &&
    /^[a-z0-9-]+$/.test(effectiveSlug) &&
    effectiveSlug.length >= 2 &&
    !submitting

  const currentIconName = icon === "__none__" ? "" : icon
  const hasCurrentIcon = currentIconName.length > 0 && ICON_BY_NAME.has(currentIconName)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      name: name.trim(),
      slug: effectiveSlug,
      parentId: parentId === "__none__" ? null : parentId,
      level: computedLevel,
      icon: currentIconName,
      description: catDescription.trim() || undefined,
      order: Number.isFinite(order) ? order : 0,
      active,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {/* Nome e Slug */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-name" className="text-xs font-medium">
                Nome do Serviço / Categoria <span className="text-red-500">*</span>
              </Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Eletricista"
                required
                maxLength={80}
                className="border-input/60 h-9 rounded-xl text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="cat-slug" className="text-xs font-medium">
                  Slug Canônico <span className="text-red-500">*</span>
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground">
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs text-xs">
                    Identificador único nas URLs e rotas de busca de prestadores.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="cat-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugTouched(true)
                }}
                placeholder="eletricista-eletrica"
                required
                maxLength={80}
                className="border-input/60 h-9 rounded-xl font-mono text-xs"
              />
            </div>
          </div>

          {/* Categoria Pai e Nível Resultante */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-parent" className="text-xs font-medium">
                Categoria Pai
              </Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="cat-parent" className="border-input/60 h-9 rounded-xl text-xs">
                  <SelectValue placeholder="Nenhuma (Macro-Domínio)" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="__none__">Nenhuma (Macro-Domínio / Nível 0)</SelectItem>
                  {parentCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {"—".repeat(c.level)} {c.name} ({LEVEL_META[c.level]?.label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium">Nível Hierárquico</Label>
              <div className="border-input/60 bg-muted/40 flex h-9 items-center gap-2 rounded-xl border px-3">
                <StatusBadge tone={LEVEL_META[computedLevel]?.tone ?? "sky"}>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      LEVEL_META[computedLevel]?.dot ?? "bg-sky-500",
                    )}
                  />
                  {LEVEL_META[computedLevel]?.label ?? "Macro-Domínio"}
                </StatusBadge>
                <span className="text-muted-foreground text-[11px]">Nível {computedLevel}</span>
              </div>
            </div>
          </div>

          {/* Slogan ou Descrição Curta */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-desc" className="text-xs font-medium">
              Slogan / Descrição Amigável (opcional)
            </Label>
            <Input
              id="cat-desc"
              value={catDescription}
              onChange={(e) => setCatDescription(e.target.value)}
              placeholder="Ex.: Do projeto à obra pronta"
              maxLength={120}
              className="border-input/60 h-9 rounded-xl text-xs"
            />
          </div>

          {/* Seletor Visual de Ícones & Ordem */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-icon" className="text-xs font-medium">
                Ícone Visual
              </Label>
              <div className="flex items-center gap-2">
                <span className="border-input/60 bg-muted/40 flex size-9 shrink-0 items-center justify-center rounded-xl border">
                  {hasCurrentIcon ? (
                    <CategoryIcon name={currentIconName} className="text-primary size-4" />
                  ) : (
                    <span className="text-muted-foreground text-[10px]">—</span>
                  )}
                </span>
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger
                    id="cat-icon"
                    className="border-input/60 h-9 flex-1 rounded-xl text-xs"
                  >
                    <SelectValue placeholder="Sem ícone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="__none__">Sem ícone</SelectItem>
                    {ICON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.name} value={opt.name} className="text-xs">
                        <span className="inline-flex items-center gap-2">
                          <CategoryIcon name={opt.name} className="text-primary size-3.5" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-order" className="text-xs font-medium">
                Ordem de Exibição
              </Label>
              <Input
                id="cat-order"
                type="number"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                min={0}
                className="border-input/60 h-9 rounded-xl text-xs"
              />
            </div>
          </div>

          {/* Toggle de Categoria Ativa */}
          <div className="border-border/60 flex items-center justify-between rounded-xl border p-3">
            <div>
              <Label htmlFor="cat-active" className="text-xs font-semibold">
                Categoria Ativa
              </Label>
              <p className="text-muted-foreground text-[11px]">
                Categorias ativas aparecem imediatamente na vitrine pública.
              </p>
            </div>
            <Switch id="cat-active" checked={active} onCheckedChange={setActive} />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="rounded-xl text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="gap-1.5 rounded-xl bg-emerald-600 text-xs text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {initial ? "Salvar Alterações" : "Criar Categoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
