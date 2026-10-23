"use client"

import * as React from "react"
import Image from "next/image"
import { useQueryClient } from "@tanstack/react-query"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  Sparkles,
  ShieldCheck,
  Wrench,
  Plus,
  Loader2,
  AlertTriangle,
  Eye,
  Check,
  TrendingUp,
  Tag,
} from "lucide-react"

import { apiPatch, apiPost, type Category } from "@/lib/api"
import {
  SERVICE_UNITS,
  SERVICE_UNIT_LABELS,
  SERVICE_UNIT_SHORT,
  type ServiceUnit,
} from "@/lib/constants"
import { serviceSchema, type ServiceInput } from "@/lib/validators"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
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

// ---------------------------------------------------------------------------
// Types & Contracts
// ---------------------------------------------------------------------------

export type ServiceCategory = Category & { parentId?: string | null }

export type ProviderService = {
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

export type ServiceFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: ProviderService | null
  categories: Category[]
  onSuccess?: () => void
}

// ---------------------------------------------------------------------------
// Smart Templates & Quick Prompts by Trade
// ---------------------------------------------------------------------------

type TradeTemplate = {
  label: string
  title: string
  basePrice: number
  unit: ServiceUnit
  snippet: string
}

const TEMPLATES_BY_NICHE: Record<string, TradeTemplate[]> = {
  eletric: [
    {
      label: "Troca de Disjuntor",
      title: "Troca e Instalação de Disjuntor no Quadro",
      basePrice: 150,
      unit: "UNIDADE",
      snippet:
        "Substituição de disjuntor com dimensionamento de carga, aperto de conexões e teste de tensão com multímetro.",
    },
    {
      label: "Instalação de Chuveiro",
      title: "Instalação ou Troca de Chuveiro Elétrico",
      basePrice: 90,
      unit: "UNIDADE",
      snippet:
        "Instalação segura com conectores de cerâmica/porcelana, verificação de aterramento e teste de vazamento.",
    },
    {
      label: "Tomadas & Interruptores",
      title: "Troca e Instalação de Tomadas e Interruptores",
      basePrice: 45,
      unit: "UNIDADE",
      snippet:
        "Substituição pelo novo padrão brasileiro ABNT NBR 14136, com reaperto de fiação e isolamento de segurança.",
    },
    {
      label: "Quadro de Distribuição (QDC)",
      title: "Montagem e Organização de Quadro de Energia",
      basePrice: 380,
      unit: "UNIDADE",
      snippet:
        "Organização completa de barramento, identificação de circuitos com anilhas e balanceamento de fases.",
    },
  ],
  hidraul: [
    {
      label: "Conserto de Vazamento",
      title: "Localização e Reparo de Vazamento Hidráulico",
      basePrice: 120,
      unit: "UNIDADE",
      snippet:
        "Diagnóstico de cano furado, troca de conexão PVC/PPR e teste de estanqueidade sob pressão de água.",
    },
    {
      label: "Troca de Torneira/Sifão",
      title: "Instalação ou Troca de Torneira e Sifão",
      basePrice: 80,
      unit: "UNIDADE",
      snippet:
        "Instalação com vedação em fita teflon profissional, alinhamento de cuba e verificação de escoamento sem goteiras.",
    },
    {
      label: "Vaso Sanitário",
      title: "Instalação de Vaso Sanitário com Caixa Acoplada",
      basePrice: 160,
      unit: "UNIDADE",
      snippet:
        "Fixação com anel de vedação anti-odor, fixação em parafusos inox e calafetação com silicone bactericida.",
    },
    {
      label: "Limpeza de Caixa d'Água",
      title: "Higienização e Desinfecção de Caixa d'Água",
      basePrice: 220,
      unit: "UNIDADE",
      snippet:
        "Esvaziamento com sucção, escovação mecânica sem químicos abrasivos, desinfecção com cloro ativo e vedação da tampa.",
    },
  ],
  pintur: [
    {
      label: "Pintura Parede / Teto",
      title: "Pintura Residencial Interna (Paredes e Tetos)",
      basePrice: 25,
      unit: "METRO_QUADRADO",
      snippet:
        "Proteção de pisos e rodapés com lona e fita crepe, emassamento de pequenas trincas, lixamento e 2 demãos de tinta acrílica lavável.",
    },
    {
      label: "Portas e Janelas",
      title: "Pintura e Esmaltação de Portas e Batentes",
      basePrice: 90,
      unit: "UNIDADE",
      snippet:
        "Lixamento minucioso, fundo nivelador e acabamento em esmalte sintético acetinado ou brilhante.",
    },
    {
      label: "Massa Corrida",
      title: "Aplicação de Massa Corrida e Lixamento Mecanizado",
      basePrice: 28,
      unit: "METRO_QUADRADO",
      snippet:
        "Aplicação uniforme em duas demãos para nivelamento de alvenaria e acabamento liso e uniforme para pintura fina.",
    },
  ],
  limp: [
    {
      label: "Limpeza Pós-Obra",
      title: "Limpeza Pesada Especializada Pós-Obra",
      basePrice: 350,
      unit: "UNIDADE",
      snippet:
        "Remoção profunda de resíduos de tinta, rejunte, cimento em pisos, vidros e esquadrias com maquinário e produtos específicos.",
    },
    {
      label: "Faxina Residencial",
      title: "Faxina Geral e Higienização Residencial Completa",
      basePrice: 180,
      unit: "UNIDADE",
      snippet:
        "Higienização de cozinhas, banheiros com desinfecção, quartos, salas, vidraças internas e pisos.",
    },
  ],
  climat: [
    {
      label: "Higienização de Ar",
      title: "Higienização e Limpeza Completa de Ar-Condicionado Split",
      basePrice: 160,
      unit: "UNIDADE",
      snippet:
        "Desmontagem da carenagem, limpeza da serpentina e turbina com bactericida biodegradável, higienização dos filtros e dreno.",
    },
    {
      label: "Instalação Split",
      title: "Instalação Padrão de Ar-Condicionado Split (até 12.000 BTUs)",
      basePrice: 480,
      unit: "UNIDADE",
      snippet:
        "Furação em alvenaria, tubulação de cobre isolada até 3m, vácuo com bomba e manômetro digital e teste de drenagem.",
    },
  ],
}

// Quick description snippet additions
const QUICK_SNIPPETS = [
  "Mão de obra especializada inclusa.",
  "Teste e vistoria de funcionamento no local.",
  "Garantia de 90 dias com recibo pela plataforma.",
  "Materiais e peças por conta do cliente.",
  "Atendimento residencial e comercial em Valadares.",
  "Descarte e limpeza da área após o serviço.",
]

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
  categories,
  onSuccess,
}: ServiceFormDialogProps) {
  const isEdit = !!service
  const qc = useQueryClient()

  // 3-level cascade selection
  const [parentCatId, setParentCatId] = React.useState<string>("")
  const [childCatId, setChildCatId] = React.useState<string>("")
  const [subCatId, setSubCatId] = React.useState<string>("")
  const [photos, setPhotos] = React.useState<string[]>([])
  const [saveAndAddAnother, setSaveAndAddAnother] = React.useState(false)

  // Level-0 categories (Macro áreas)
  const level0 = React.useMemo(() => categories.filter((c) => c.level === 0), [categories])

  // Level-1 (Especialidades) given selected macro área
  const level1 = React.useMemo(
    () => categories.filter((c) => c.level === 1 && c.parentId === parentCatId),
    [categories, parentCatId],
  )

  // Level-2 (Subcategorias específicas) given selected especialidade
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

  // Hydrate form when opening or editing
  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevService, setPrevService] = React.useState(service)
  if (open && (prevOpen !== open || prevService !== service)) {
    setPrevOpen(open)
    setPrevService(service)
    if (service) {
      const sub = categories.find((c) => c.id === service.categoryId)
      const filha = sub?.parentId ? categories.find((c) => c.id === sub?.parentId) : null
      const pai = filha?.parentId ? categories.find((c) => c.id === filha?.parentId) : null

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

  // Sync form categoryId with selected subcategory (or child if leaf)
  React.useEffect(() => {
    form.setValue("categoryId", subCatId)
  }, [subCatId, form])

  // Sync photos
  React.useEffect(() => {
    form.setValue("photos", photos)
  }, [photos, form])

  // Watch fields for live preview and quality score
  const watchedTitle = useWatch({ control: form.control, name: "title" }) || ""
  const watchedDesc = useWatch({ control: form.control, name: "description" }) || ""
  const watchedPrice = useWatch({ control: form.control, name: "basePrice" }) || 0
  const watchedUnit = (useWatch({ control: form.control, name: "unit" }) ||
    "UNIDADE") as ServiceUnit
  const watchedActive = useWatch({ control: form.control, name: "active" }) ?? true

  const currentPrice = service?.basePrice ?? 0
  const priceLowerThanCurrent = isEdit && Number(watchedPrice) < currentPrice

  // Determine current active category names for preview & breadcrumb
  const currentSubCat = React.useMemo(
    () => categories.find((c) => c.id === subCatId),
    [categories, subCatId],
  )
  const currentChildCat = React.useMemo(
    () => categories.find((c) => c.id === childCatId),
    [categories, childCatId],
  )
  const currentParentCat = React.useMemo(
    () => categories.find((c) => c.id === parentCatId),
    [categories, parentCatId],
  )

  // Smart suggestions relevant to the chosen categories
  const suggestedTemplates = React.useMemo(() => {
    const textSearch =
      `${currentParentCat?.name || ""} ${currentChildCat?.name || ""} ${currentSubCat?.name || ""}`.toLowerCase()

    for (const [key, tpls] of Object.entries(TEMPLATES_BY_NICHE)) {
      if (textSearch.includes(key)) {
        return tpls
      }
    }
    // Default fallback to electrical/handyman suggestions
    return TEMPLATES_BY_NICHE.eletric
  }, [currentParentCat, currentChildCat, currentSubCat])

  // Listing quality score (0 to 100%)
  const qualityScore = React.useMemo(() => {
    let score = 0
    if (subCatId) score += 25
    if (watchedTitle.trim().length >= 5) score += 25
    if (watchedDesc.trim().length >= 30) score += 20
    if (Number(watchedPrice) > 0) score += 15
    if (photos.length > 0) score += 15
    return Math.min(100, score)
  }, [subCatId, watchedTitle, watchedDesc, watchedPrice, photos])

  // Quality badge tier
  const qualityTier = React.useMemo(() => {
    if (qualityScore >= 85)
      return {
        label: "Anúncio Campeão (Alta Conversão)",
        color:
          "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
        tip: "Seu serviço está completo e receberá prioridade nas buscas da vitrine!",
      }
    if (qualityScore >= 50)
      return {
        label: "Anúncio Bom (Quase lá)",
        color: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300",
        tip:
          photos.length === 0
            ? "Adicione pelo menos 1 foto real para atingir o topo!"
            : "Aprimore a descrição com o que está incluso.",
      }
    return {
      label: "Incompleto (Básico)",
      color: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",
      tip: "Preencha a especialidade e o título para os clientes encontrarem seu serviço.",
    }
  }, [qualityScore, photos])

  // Apply a 1-click template
  const applyTemplate = (tpl: TradeTemplate) => {
    form.setValue("title", tpl.title, { shouldValidate: true })
    form.setValue("basePrice", tpl.basePrice, { shouldValidate: true })
    form.setValue("unit", tpl.unit, { shouldValidate: true })

    const existingDesc = form.getValues("description")
    if (!existingDesc || existingDesc.length < 10) {
      form.setValue("description", tpl.snippet, { shouldValidate: true })
    }
    toast.info(`Modelo "${tpl.label}" aplicado! Ajuste os valores como preferir.`)
  }

  // Append a quick snippet to the description
  const appendSnippet = (snippet: string) => {
    const cur = form.getValues("description") || ""
    const trimmed = cur.trim()
    const next = trimmed ? `${trimmed}\n• ${snippet}` : `• ${snippet}`
    form.setValue("description", next, { shouldValidate: true })
  }

  // Submit handler
  const submit = form.handleSubmit(async (values) => {
    if (!subCatId) {
      toast.error("Por favor, selecione o serviço específico para classificar seu anúncio.")
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
        toast.success("Serviço atualizado com sucesso na vitrine!")
      } else {
        await apiPost("/api/services", payload)
        toast.success("Serviço publicado com sucesso na vitrine!")
      }

      qc.invalidateQueries({ queryKey: ["provider", "services"] })
      onSuccess?.()

      if (saveAndAddAnother && !isEdit) {
        // Reset form for another service but preserve the category to speed up entry!
        form.reset({
          title: "",
          description: "",
          categoryId: subCatId,
          basePrice: 0,
          unit: "UNIDADE",
          photos: [],
          active: true,
        })
        setPhotos([])
        setSaveAndAddAnother(false)
        toast.info("Pronto para cadastrar o próximo serviço!")
      } else {
        onOpenChange(false)
      }
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao salvar serviço.")
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-4xl lg:max-w-5xl">
        {/* Sticky Dialog Header with Value Proposition */}
        <div className="border-border/70 via-background to-background shrink-0 border-b bg-gradient-to-r from-emerald-500/10 p-5 md:px-6 md:py-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                  <Wrench className="size-4" />
                </span>
                <DialogTitle className="text-foreground text-xl font-bold tracking-tight">
                  {isEdit ? "Editar serviço" : "Cadastrar novo serviço"}
                </DialogTitle>
                <Badge
                  variant="outline"
                  className="hidden border-emerald-500/30 bg-emerald-50 text-emerald-700 sm:inline-flex dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <Sparkles className="mr-1 size-3" /> Vitrine de Valadares
                </Badge>
              </div>
              <DialogDescription className="text-muted-foreground mt-1 text-xs">
                {isEdit
                  ? "Atualize as informações, fotos e preços para manter seu perfil atraente e atualizado."
                  : "Cadastre todos os serviços que você realiza. Prestadores com catálogo completo recebem até 4x mais pedidos!"}
              </DialogDescription>
            </div>

            {/* Quality Score Pill Bar */}
            <div className="border-border/80 bg-background/80 flex flex-col gap-1 rounded-xl border p-2.5 shadow-2xs backdrop-blur-xs md:min-w-[240px]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-semibold">Força do Anúncio</span>
                <span className="font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                  {qualityScore}%
                </span>
              </div>
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    qualityScore >= 80
                      ? "bg-emerald-500"
                      : qualityScore >= 50
                        ? "bg-blue-500"
                        : "bg-amber-500",
                  )}
                  style={{ width: `${qualityScore}%` }}
                />
              </div>
              <span className="text-muted-foreground text-[10px] leading-tight">
                {qualityTier.tip}
              </span>
            </div>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Scrollable Form Body with 2 Columns on Desktop */}
            <div className="flex-1 overflow-y-auto p-5 md:p-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Left Column: Interactive Form Controls (7 cols) */}
                <div className="space-y-6 lg:col-span-7">
                  {/* ──────────────────────────────────────────────────────────
                    SECTION 1: CATEGORY & SPECIALTY
                ────────────────────────────────────────────────────────── */}
                  <div className="border-border/80 bg-card rounded-2xl border p-4 shadow-2xs md:p-5">
                    <div className="mb-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          1
                        </span>
                        <h3 className="text-foreground text-sm font-bold">
                          Classificação do Serviço
                        </h3>
                      </div>
                      <span className="text-muted-foreground text-[11px] font-medium">
                        Obrigatório
                      </span>
                    </div>

                    <p className="text-muted-foreground mb-4 text-xs">
                      Selecione a área e a especialidade para que clientes encontrem seu serviço com
                      precisão nas buscas.
                    </p>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <CategorySelect
                        label="1. Área Principal"
                        placeholder="Ex.: Reparos..."
                        value={parentCatId}
                        onChange={(v) => {
                          setParentCatId(v)
                          setChildCatId("")
                          setSubCatId("")
                        }}
                        options={level0}
                      />

                      <CategorySelect
                        label="2. Especialidade"
                        placeholder={parentCatId ? "Selecione..." : "Escolha a área"}
                        value={childCatId}
                        onChange={(v) => {
                          setChildCatId(v)
                          setSubCatId("")
                        }}
                        options={level1}
                        disabled={!parentCatId}
                      />

                      <CategorySelect
                        label="3. Serviço Específico"
                        placeholder={childCatId ? "Selecione..." : "Escolha a especialidade"}
                        value={subCatId}
                        onChange={setSubCatId}
                        options={level2}
                        disabled={!childCatId}
                      />
                    </div>

                    {/* 1-Click Smart Suggestion Chips */}
                    <div className="border-border/50 mt-4 border-t pt-3">
                      <div className="text-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold">
                        <Sparkles className="size-3.5 text-amber-500" />
                        <span>Sugestões rápidas de 1 clique:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestedTemplates.map((tpl) => (
                          <button
                            key={tpl.label}
                            type="button"
                            onClick={() => applyTemplate(tpl)}
                            className="border-border/70 bg-muted/30 text-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:border-emerald-500/50 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
                          >
                            <Plus className="text-muted-foreground size-3" />
                            {tpl.label}
                            <span className="text-muted-foreground ml-1 text-[10px]">
                              (R$ {tpl.basePrice})
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ──────────────────────────────────────────────────────────
                    SECTION 2: TITLE & DESCRIPTION
                ────────────────────────────────────────────────────────── */}
                  <div className="border-border/80 bg-card space-y-4 rounded-2xl border p-4 shadow-2xs md:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          2
                        </span>
                        <h3 className="text-foreground text-sm font-bold">
                          Apresentação e Descrição
                        </h3>
                      </div>
                      <span className="text-muted-foreground text-[11px] font-medium">
                        Persuasão
                      </span>
                    </div>

                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel className="text-xs font-semibold">
                              Título do Serviço
                            </FormLabel>
                            <span className="text-muted-foreground text-[10px] tabular-nums">
                              {field.value?.length || 0}/80
                            </span>
                          </div>
                          <FormControl>
                            <Input
                              placeholder="Ex.: Instalação e Troca de Chuveiro Elétrico"
                              maxLength={80}
                              className="h-10 text-sm font-medium"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-[11px]">
                            Escreva de forma clara e objetiva para facilitar a busca do cliente.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel className="text-xs font-semibold">
                              O que está incluso no serviço?
                            </FormLabel>
                            <span className="text-muted-foreground text-[10px] tabular-nums">
                              {field.value?.length || 0}/1200
                            </span>
                          </div>
                          <FormControl>
                            <Textarea
                              placeholder="Descreva detalhadamente o que está incluso, como é feita a execução e condições..."
                              rows={4}
                              maxLength={1200}
                              className="text-xs leading-relaxed"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />

                          {/* Quick Snippets to prevent writer's block */}
                          <div className="mt-2 space-y-1.5">
                            <span className="text-muted-foreground text-[11px] font-medium">
                              Clique para adicionar tópicos recomendados:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {QUICK_SNIPPETS.map((snippet) => (
                                <button
                                  key={snippet}
                                  type="button"
                                  onClick={() => appendSnippet(snippet)}
                                  className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] transition-all hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"
                                >
                                  <Plus className="size-2.5" />
                                  {snippet}
                                </button>
                              ))}
                            </div>
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* ──────────────────────────────────────────────────────────
                    SECTION 3: PRICING & CONDITIONS
                ────────────────────────────────────────────────────────── */}
                  <div className="border-border/80 bg-card space-y-4 rounded-2xl border p-4 shadow-2xs md:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          3
                        </span>
                        <h3 className="text-foreground text-sm font-bold">
                          Preço Base & Condições
                        </h3>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        A partir de
                      </Badge>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="basePrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-semibold">
                              Preço base inicial (R$)
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm font-bold">
                                  R$
                                </span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  className="text-foreground h-10 pl-10 text-base font-bold tabular-nums"
                                  {...field}
                                  value={field.value ?? 0}
                                  onChange={(e) => field.onChange(Number(e.target.value))}
                                />
                              </div>
                            </FormControl>
                            {isEdit ? (
                              <FormDescription className="text-[11px]">
                                Preço atual: {formatBRL(currentPrice)}. (Reajuste apenas para cima).
                              </FormDescription>
                            ) : (
                              <FormDescription className="text-[11px]">
                                Preço mínimo sugerido inicial. Você pode enviar orçamentos
                                personalizados depois.
                              </FormDescription>
                            )}
                            {priceLowerThanCurrent && (
                              <p className="text-destructive flex items-center gap-1 text-xs">
                                <AlertTriangle className="size-3" />O novo preço é menor que o atual
                                e será recusado pelo servidor.
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
                            <FormLabel className="text-xs font-semibold">
                              Unidade de Cobrança
                            </FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger className="h-10">
                                  <SelectValue placeholder="Selecione a unidade..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {SERVICE_UNITS.map((u) => (
                                  <SelectItem key={u} value={u}>
                                    {SERVICE_UNIT_LABELS[u]} ({SERVICE_UNIT_SHORT[u]})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription className="text-[11px]">
                              Como o serviço costuma ser medido ou cobrado.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Escrow PIX & Security Guarantee Note */}
                    <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
                      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                      <div>
                        <p className="font-semibold text-emerald-950 dark:text-emerald-200">
                          Recebimento 100% Garantido com Custódia PIX
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                          O cliente deposita o valor em custódia segura do Severinno antes de você
                          iniciar a execução. Zero risco de calote.
                        </p>
                      </div>
                    </div>

                    {/* Active Toggle Switch */}
                    <FormField
                      control={form.control}
                      name="active"
                      render={({ field }) => (
                        <FormItem className="border-border/80 bg-muted/20 flex items-center justify-between rounded-xl border p-3">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <FormLabel className="text-xs font-semibold">
                                Exibir na Vitrine Pública
                              </FormLabel>
                              {field.value ? (
                                <Badge className="bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                  Ativo no Ar
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">
                                  Rascunho Oculto
                                </Badge>
                              )}
                            </div>
                            <FormDescription className="text-[11px]">
                              {field.value
                                ? "Clientes de Valadares podem ver e solicitar este serviço agora mesmo."
                                : "Serviço pausado. Não aparecerá nas buscas nem no seu perfil público."}
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* ──────────────────────────────────────────────────────────
                    SECTION 4: PHOTOS
                ────────────────────────────────────────────────────────── */}
                  <div className="border-border/80 bg-card space-y-3 rounded-2xl border p-4 shadow-2xs md:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          4
                        </span>
                        <h3 className="text-foreground text-sm font-bold">
                          Fotos dos seus Trabalhos Realizados
                        </h3>
                      </div>
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        +300% de cliques
                      </span>
                    </div>

                    <p className="text-muted-foreground text-xs">
                      Fotos reais de antes/depois ou do serviço pronto geram confiança imediata no
                      contratante.
                    </p>

                    <FilePhotos
                      value={photos}
                      onChange={setPhotos}
                      max={4}
                      label=""
                      hint="Até 4 fotos reais (JPG, PNG ou WebP de até 5MB cada)."
                    />
                  </div>
                </div>

                {/* Right Column: Live Vitrine Preview & Persuasion Sidebar (5 cols) */}
                <div className="space-y-5 lg:col-span-5">
                  <div className="sticky top-0 space-y-4">
                    {/* Preview Card Header */}
                    <div className="border-border/80 bg-muted/30 rounded-2xl border p-4 shadow-2xs">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-foreground flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
                          <Eye className="size-4 text-emerald-600" />
                          <span>Prévia ao Vivo na Vitrine</span>
                        </div>
                        <Badge variant="outline" className="bg-background text-[10px]">
                          Governador Valadares
                        </Badge>
                      </div>

                      <p className="text-muted-foreground mb-3 text-[11px]">
                        É assim que os clientes verão seu anúncio ao navegar ou buscar na vitrine:
                      </p>

                      {/* Simulated Service Card */}
                      <div className="group border-border/80 bg-card relative flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all">
                        {/* Photo or Clean Thematic Banner */}
                        <div className="bg-muted/50 relative aspect-[16/10] w-full overflow-hidden">
                          {photos[0] ? (
                            <Image
                              src={photos[0]}
                              alt={watchedTitle || "Foto do serviço"}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex size-full flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-emerald-50/30 to-slate-100 p-4 text-center dark:from-slate-900/60 dark:via-emerald-950/20 dark:to-slate-900">
                              <div className="border-border/50 flex size-12 items-center justify-center rounded-2xl border bg-white text-emerald-600 shadow-2xs dark:bg-slate-800">
                                <Wrench className="size-6" />
                              </div>
                              <span className="text-muted-foreground mt-2 text-xs font-semibold">
                                {currentChildCat?.name || "Sem foto cadastrada"}
                              </span>
                              <span className="text-muted-foreground/80 text-[10px]">
                                Adicione fotos para atrair mais clientes
                              </span>
                            </div>
                          )}

                          {/* Guarantee Badge */}
                          <div className="bg-background/90 text-foreground absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-xs backdrop-blur-xs">
                            <ShieldCheck className="size-3 text-emerald-600" />
                            <span>Garantia 90 dias</span>
                          </div>

                          {/* Status Pill */}
                          <div className="absolute top-2.5 right-2.5">
                            <Badge
                              className={cn(
                                "text-[10px] shadow-xs",
                                watchedActive
                                  ? "bg-emerald-600 text-white"
                                  : "bg-zinc-600 text-white",
                              )}
                            >
                              {watchedActive ? "Ativo" : "Pausado"}
                            </Badge>
                          </div>
                        </div>

                        {/* Card Content */}
                        <div className="space-y-2.5 p-4">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            <Tag className="size-3" />
                            <span>
                              {currentSubCat?.name || currentChildCat?.name || "Especialidade"}
                            </span>
                          </div>

                          <h4 className="text-foreground line-clamp-2 text-sm leading-snug font-bold">
                            {watchedTitle || "Título do seu serviço aparecerá aqui"}
                          </h4>

                          <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                            {watchedDesc ||
                              "A descrição completa do que está incluso será exibida aqui para o cliente..."}
                          </p>

                          <div className="border-border/60 flex items-baseline justify-between border-t pt-2">
                            <div>
                              <span className="text-muted-foreground block text-[10px]">
                                A partir de
                              </span>
                              <span className="text-foreground text-base font-bold tabular-nums">
                                {formatBRL(Number(watchedPrice) || 0)}
                              </span>
                              <span className="text-muted-foreground ml-1 text-xs">
                                /{SERVICE_UNIT_SHORT[watchedUnit]}
                              </span>
                            </div>

                            <div className="flex gap-1.5">
                              <span className="pointer-events-none rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs">
                                Agendar
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Persuasive Callout Box: Why register more services? */}
                    <div className="via-background dark:to-background rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-50/50 to-emerald-50/20 p-4 dark:from-emerald-950/20">
                      <div className="mb-1.5 flex items-center gap-2">
                        <TrendingUp className="size-4 text-emerald-600" />
                        <h4 className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                          Como faturar mais no Severinno?
                        </h4>
                      </div>
                      <ul className="text-muted-foreground space-y-1.5 text-[11px] leading-relaxed">
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                          <span>
                            <strong>Cadastre variações:</strong> Clientes buscam por termos
                            específicos (ex: "Troca de Chuveiro", "Fiação").
                          </span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                          <span>
                            <strong>Fotos reais:</strong> Anúncios com fotos fecham negócio 3x mais
                            rápido.
                          </span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                          <span>
                            <strong>Preço honesto:</strong> O valor mínimo ajuda o cliente a dar o
                            primeiro passo no agendamento.
                          </span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky Action Footer */}
            <div className="border-border/80 bg-background flex shrink-0 flex-col items-center justify-between gap-3 border-t p-4 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="w-full text-xs sm:w-auto"
              >
                Cancelar
              </Button>

              <div className="flex w-full flex-col items-center gap-2 sm:w-auto sm:flex-row">
                {!isEdit && (
                  <Button
                    type="submit"
                    variant="outline"
                    onClick={() => setSaveAndAddAnother(true)}
                    disabled={!subCatId || form.formState.isSubmitting}
                    className="w-full border-emerald-600/30 text-xs font-medium text-emerald-700 hover:bg-emerald-50 sm:w-auto dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                  >
                    Salvar e cadastrar outro
                  </Button>
                )}

                <Button
                  type="submit"
                  onClick={() => setSaveAndAddAnother(false)}
                  disabled={!subCatId || priceLowerThanCurrent || form.formState.isSubmitting}
                  className="w-full gap-1.5 bg-emerald-600 px-5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 sm:w-auto"
                >
                  {form.formState.isSubmitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  {isEdit ? "Salvar alterações" : "Publicar serviço na vitrine"}
                </Button>
              </div>
            </div>
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
      <label className="text-muted-foreground text-xs font-medium">{label}</label>
      <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
        <SelectTrigger className="h-10 w-full text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default ServiceFormDialog
