"use client"

import * as React from "react"
import { Plus, Loader2, Sparkles, ChevronRight } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { slugify } from "./_shared"
import { type CategoryRow, type CategoryNode, CategoryIcon, ICON_OPTIONS } from "./admin-taxonomy"

export type CategoryPayload = {
  name: string
  slug: string
  parentId?: string | null
  level: number
  icon?: string
  description?: string
  order: number
  active: boolean
}

export function CategoryDialog({
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
      setActive(initial.active ?? true)
    } else if (initialParent) {
      setName("")
      setSlug("")
      setSlugTouched(false)
      setParentId(initialParent.id)
      setIcon("__none__")
      setCatDescription("")
      setOrder(0)
      setActive(true)
    } else {
      setName("")
      setSlug("")
      setSlugTouched(false)
      setParentId("__none__")
      setIcon("__none__")
      setCatDescription("")
      setOrder(0)
      setActive(true)
    }
  }

  const handleNameChange = (val: string) => {
    setName(val)
    if (!slugTouched) {
      setSlug(slugify(val))
    }
  }

  // Nível derivado do parent selecionado
  const selectedParent = React.useMemo(() => {
    if (!parentId || parentId === "__none__") return null
    return allCategories.find((c) => c.id === parentId) ?? null
  }, [parentId, allCategories])

  const computedLevel = selectedParent ? Math.min(selectedParent.level + 1, 2) : 0

  // Candidatos a pai: apenas níveis 0 e 1, e não pode ser a própria categoria nem seus descendentes
  const eligibleParents = React.useMemo(() => {
    return allCategories.filter((c) => {
      if (c.level >= 2) return false
      if (initial && c.id === initial.id) return false
      return true
    })
  }, [allCategories, initial])

  const canSubmit = name.trim().length >= 2 && slug.trim().length >= 2 && !submitting

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    onSubmit({
      name: name.trim(),
      slug: slug.trim(),
      parentId: parentId === "__none__" ? null : parentId,
      level: computedLevel,
      icon: icon === "__none__" ? undefined : icon,
      description: catDescription.trim() || undefined,
      order: Number(order) || 0,
      active,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="size-4 text-emerald-600" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* Nome da categoria */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-name" className="text-xs font-medium">
              Nome da Categoria <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: Eletricista Residencial"
              className="border-input/60 h-9 rounded-xl text-xs"
              required
            />
          </div>

          {/* Slug amigável */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-slug" className="text-xs font-medium">
              Slug (Identificador URL) <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="cat-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(slugify(e.target.value))
              }}
              placeholder="Ex: eletricista-residencial"
              className="border-input/60 h-9 rounded-xl font-mono text-xs"
              required
            />
          </div>

          {/* Categoria Pai */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-parent" className="text-xs font-medium">
              Categoria Pai (Hierarquia)
            </Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="cat-parent" className="border-input/60 h-9 rounded-xl text-xs">
                <SelectValue placeholder="Selecione o pai (ou deixe vazio para Macro-Domínio)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="font-semibold text-emerald-600">
                    Nenhum (Será Macro-Domínio Nível 0)
                  </span>
                </SelectItem>
                {eligibleParents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-1.5">
                      <CategoryIcon name={p.icon} className="size-3.5" />
                      <span>{p.name}</span>
                      <span className="text-muted-foreground text-[10px]">
                        (Nível {p.level === 0 ? "0 — Macro" : "1 — Sub"})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <ChevronRight className="size-3" />
              Nível resultante:{" "}
              <strong className="text-foreground">
                {computedLevel === 0
                  ? "0 — Macro-Domínio"
                  : computedLevel === 1
                    ? "1 — Subcategoria"
                    : "2 — Especialidade"}
              </strong>
            </p>
          </div>

          {/* Seletor de Ícone Visual */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Ícone Visual Representativo</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger className="border-input/60 h-9 rounded-xl text-xs">
                <SelectValue placeholder="Selecione um ícone">
                  {icon !== "__none__" ? (
                    <span className="flex items-center gap-2">
                      <CategoryIcon name={icon} className="size-4 text-emerald-600" />
                      <span>{ICON_OPTIONS.find((o) => o.name === icon)?.label ?? icon}</span>
                    </span>
                  ) : (
                    "Sem ícone específico"
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="__none__">Sem ícone específico</SelectItem>
                {ICON_OPTIONS.map((opt) => {
                  const Icon = opt.icon
                  return (
                    <SelectItem key={opt.name} value={opt.name}>
                      <span className="flex items-center gap-2">
                        <Icon className="size-4 text-emerald-600" />
                        <span>{opt.label}</span>
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Descrição orientativa */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-desc" className="text-xs font-medium">
              Descrição Curta (SEO e Orientação)
            </Label>
            <Textarea
              id="cat-desc"
              value={catDescription}
              onChange={(e) => setCatDescription(e.target.value)}
              placeholder="Descreva os tipos de serviço compreendidos por esta categoria..."
              rows={2}
              className="border-input/60 rounded-xl text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Ordem de exibição */}
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
