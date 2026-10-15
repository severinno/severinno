"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Wrench,
  Package,
  Store,
  ShieldCheck,
  Plus,
  Trash2,
  ExternalLink,
  MessageCircle,
  Copy,
  Check,
  MapPin,
} from "lucide-react"
import {
  GV_PARTNER_STORES,
  getPartnerStoresForCategory,
  type TransparentQuoteBreakdown,
  type MaterialItem,
  type PartnerStoreGV,
} from "@/lib/materials-breakdown"
import { formatBRL } from "@/lib/format"
import { toast } from "sonner"

export type TransparentQuoteModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "compose" | "view"
  serviceTitle: string
  serviceCategory?: string
  initialBreakdown?: TransparentQuoteBreakdown | null
  onSave?: (breakdown: TransparentQuoteBreakdown, totalPrice: number) => void
}

export function TransparentQuoteModal({
  open,
  onOpenChange,
  mode,
  serviceTitle,
  serviceCategory,
  initialBreakdown,
  onSave,
}: TransparentQuoteModalProps) {
  // Available partner stores in GV for this category
  const suggestedStores = React.useMemo(() => {
    return getPartnerStoresForCategory(serviceCategory)
  }, [serviceCategory])

  // State for Compose mode
  const [laborCost, setLaborCost] = React.useState<number>(initialBreakdown?.laborCost ?? 0)
  const [payer, setPayer] = React.useState<"CLIENT" | "PROVIDER">(
    initialBreakdown?.payer ?? "CLIENT",
  )
  const [selectedStoreId, setSelectedStoreId] = React.useState<string>(
    initialBreakdown?.suggestedStoreId ?? suggestedStores[0]?.id ?? "",
  )
  const [materials, setMaterials] = React.useState<MaterialItem[]>(
    initialBreakdown?.materials ?? [],
  )

  // New item inputs
  const [newItemName, setNewItemName] = React.useState<string>("")
  const [newItemQty, setNewItemQty] = React.useState<string>("1")
  const [newItemUnit, setNewItemUnit] = React.useState<string>("un")
  const [newItemPrice, setNewItemPrice] = React.useState<string>("")

  const [copied, setCopied] = React.useState(false)

  // Calculate totals
  const totalMaterialsCost = React.useMemo(() => {
    return materials.reduce((acc, item) => acc + item.estimatedPrice * item.quantity, 0)
  }, [materials])

  const totalQuotePrice = React.useMemo(() => {
    return Math.round((laborCost + totalMaterialsCost) * 100) / 100
  }, [laborCost, totalMaterialsCost])

  const handleAddMaterial = () => {
    if (!newItemName.trim()) {
      toast.error("Informe o nome do material ou peça.")
      return
    }
    const qty = parseFloat(newItemQty) || 1
    const price = parseFloat(newItemPrice) || 0

    const item: MaterialItem = {
      id: `mat-${Date.now()}`,
      name: newItemName.trim(),
      quantity: qty,
      unit: newItemUnit.trim() || "un",
      estimatedPrice: price,
    }

    setMaterials((prev) => [...prev, item])
    setNewItemName("")
    setNewItemQty("1")
    setNewItemPrice("")
  }

  const handleRemoveMaterial = (id: string) => {
    setMaterials((prev) => prev.filter((m) => m.id !== id))
  }

  const handleSaveCompose = () => {
    if (laborCost <= 0) {
      toast.error("Informe o valor da mão de obra.")
      return
    }

    const breakdown: TransparentQuoteBreakdown = {
      laborCost,
      materialsCost: totalMaterialsCost,
      payer,
      materials,
      suggestedStoreId: selectedStoreId || undefined,
    }

    if (onSave) {
      onSave(breakdown, totalQuotePrice)
    }
    toast.success("Orçamento transparente configurado!")
    onOpenChange(false)
  }

  // Selected store details
  const activeStore: PartnerStoreGV | undefined = React.useMemo(() => {
    const storeId = mode === "view" ? initialBreakdown?.suggestedStoreId : selectedStoreId
    return GV_PARTNER_STORES.find((s) => s.id === storeId) || suggestedStores[0]
  }, [mode, initialBreakdown, selectedStoreId, suggestedStores])

  const copyShoppingList = () => {
    const itemsList = (mode === "view" ? initialBreakdown?.materials : materials) ?? []
    if (itemsList.length === 0) {
      toast.info("Nenhum material listado neste orçamento.")
      return
    }

    const text = [
      `🛒 *Lista de Materiais - ${serviceTitle}*`,
      `🏢 Indicação: ${activeStore ? `${activeStore.name} (${activeStore.neighborhood})` : "Depósito em GV"}`,
      "",
      ...itemsList.map(
        (m, i) =>
          `${i + 1}. ${m.name} - ${m.quantity} ${m.unit} (aprox. ${formatBRL(m.estimatedPrice * m.quantity)})`,
      ),
      "",
      `💰 Total estimado em materiais: ${formatBRL(mode === "view" ? (initialBreakdown?.materialsCost ?? 0) : totalMaterialsCost)}`,
      "",
      "_Orçamento transparente via Severinno Marketplace_",
    ].join("\n")

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast.success("Lista de compras copiada para a área de transferência!")
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
              <Package className="size-5" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold">
                {mode === "compose"
                  ? "Orçamento Transparente: Mão de Obra vs Materiais"
                  : "Discriminação Transparente do Orçamento"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {mode === "compose"
                  ? "Segregue o valor do seu serviço profissional dos materiais necessários."
                  : `Detalhamento claro para o serviço: ${serviceTitle}`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {mode === "compose" ? (
          /* ============================================================== */
          /* MODE: COMPOSE (PROVIDER)                                       */
          /* ============================================================== */
          <div className="space-y-4 py-2">
            {/* 1. Labor Cost */}
            <div className="border-border/80 bg-muted/20 space-y-2 rounded-xl border p-3.5">
              <div className="flex items-center justify-between">
                <label className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                  <Wrench className="size-4 text-emerald-600" />
                  1. Valor da Mão de Obra (R$)
                </label>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  100% Protegido no Escrow
                </span>
              </div>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Ex: 150,00"
                value={laborCost || ""}
                onChange={(e) => setLaborCost(parseFloat(e.target.value) || 0)}
                className="text-base font-semibold"
              />
              <p className="text-muted-foreground text-[11px]">
                Este valor fica retido com segurança e é liberado a você assim que o cliente aprovar
                o laudo de entrega.
              </p>
            </div>

            {/* 2. Materials & Parts */}
            <div className="border-border/80 bg-muted/20 space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center justify-between">
                <label className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                  <Package className="size-4 text-blue-600" />
                  2. Materiais e Insumos Necessários
                </label>
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">Quem compra:</span>
                  <button
                    type="button"
                    onClick={() => setPayer(payer === "CLIENT" ? "PROVIDER" : "CLIENT")}
                    className="text-primary font-bold underline underline-offset-2"
                  >
                    {payer === "CLIENT" ? "Cliente compra" : "Prestador inclui"}
                  </button>
                </div>
              </div>

              {/* Add material inputs */}
              <div className="grid grid-cols-12 gap-1.5">
                <Input
                  className="col-span-5 text-xs"
                  placeholder="Nome do material (ex: Tubo PVC)"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                />
                <Input
                  className="col-span-2 text-xs"
                  type="number"
                  placeholder="Qtd"
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(e.target.value)}
                />
                <Input
                  className="col-span-2 text-xs"
                  placeholder="Un (m, un)"
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                />
                <Input
                  className="col-span-3 text-xs"
                  type="number"
                  step="0.01"
                  placeholder="R$ est."
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddMaterial}
                className="w-full gap-1.5 text-xs font-semibold"
              >
                <Plus className="size-3.5" />
                Adicionar Item à Lista de Materiais
              </Button>

              {/* Added materials list */}
              {materials.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {materials.map((m) => (
                    <div
                      key={m.id}
                      className="bg-background flex items-center justify-between rounded-lg border p-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-foreground truncate font-semibold">{m.name}</span>
                        <div className="text-muted-foreground text-[11px]">
                          {m.quantity} {m.unit} × {formatBRL(m.estimatedPrice)} ={" "}
                          <span className="text-foreground font-medium">
                            {formatBRL(m.quantity * m.estimatedPrice)}
                          </span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10 size-7"
                        onClick={() => handleRemoveMaterial(m.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1.5 text-xs font-semibold">
                    <span>Subtotal Materiais:</span>
                    <span className="text-blue-600 dark:text-blue-400">
                      {formatBRL(totalMaterialsCost)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Partner Stores in Governador Valadares */}
            <div className="border-border/80 bg-muted/20 space-y-2 rounded-xl border p-3.5">
              <label className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                <Store className="size-4 text-amber-600" />
                3. Indicar Loja ou Depósito Parceiro em GV
              </label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="border-border bg-background text-foreground w-full rounded-lg border px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {suggestedStores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.neighborhood}) - {s.discountNote || s.phone}
                  </option>
                ))}
              </select>
            </div>

            {/* Total Summary */}
            <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 p-3.5 text-white shadow-sm">
              <div>
                <span className="text-[11px] font-medium tracking-wider text-emerald-100 uppercase">
                  Valor Total do Orçamento
                </span>
                <div className="text-xl font-black">{formatBRL(totalQuotePrice)}</div>
              </div>
              <div className="text-right text-xs text-emerald-100">
                <div>Mão de Obra: {formatBRL(laborCost)}</div>
                <div>Materiais: {formatBRL(totalMaterialsCost)}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t pt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSaveCompose}
                className="gap-1.5 bg-blue-600 font-semibold text-white hover:bg-blue-700"
              >
                <Check className="size-4" />
                Confirmar Discriminação
              </Button>
            </div>
          </div>
        ) : (
          /* ============================================================== */
          /* MODE: VIEW (CLIENT)                                            */
          /* ============================================================== */
          <div className="space-y-4 py-2">
            {/* Summary Cards Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <Wrench className="size-3.5" />
                  Mão de Obra
                </div>
                <div className="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-300">
                  {formatBRL(initialBreakdown?.laborCost ?? 0)}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-3 shrink-0" />
                  Protegido no Escrow
                </div>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300">
                  <Package className="size-3.5" />
                  Materiais Estimados
                </div>
                <div className="mt-1 text-lg font-black text-blue-700 dark:text-blue-300">
                  {formatBRL(initialBreakdown?.materialsCost ?? 0)}
                </div>
                <div className="text-muted-foreground mt-1 text-[10px]">
                  {initialBreakdown?.payer === "CLIENT"
                    ? "Comprados pelo cliente"
                    : "Inclusos pelo prestador"}
                </div>
              </div>
            </div>

            {/* Materials breakdown list */}
            {initialBreakdown?.materials && initialBreakdown.materials.length > 0 ? (
              <div className="border-border/80 bg-card space-y-2 rounded-xl border p-3">
                <div className="text-foreground flex items-center justify-between text-xs font-semibold">
                  <span>Lista de Materiais Necessários</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyShoppingList}
                    className="text-primary hover:bg-primary/10 h-7 gap-1 text-[11px] font-medium"
                  >
                    {copied ? (
                      <Check className="size-3 text-emerald-600" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copied ? "Copiado!" : "Copiar Lista"}
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {initialBreakdown.materials.map((m) => (
                    <div
                      key={m.id}
                      className="bg-muted/40 flex items-center justify-between rounded-lg p-2 text-xs"
                    >
                      <span className="text-foreground font-medium">{m.name}</span>
                      <span className="text-muted-foreground">
                        {m.quantity} {m.unit}{" "}
                        {m.estimatedPrice > 0 && `(~${formatBRL(m.quantity * m.estimatedPrice)})`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground rounded-lg border border-dashed py-3 text-center text-xs">
                Nenhum item avulso discriminado. Materiais gerais combinados diretamente.
              </p>
            )}

            {/* Partner Store in Governador Valadares */}
            {activeStore && (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                    <Store className="size-4 text-amber-600" />
                    Onde Comprar em Governador Valadares
                  </div>
                  {activeStore.discountNote && (
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                      {activeStore.discountNote}
                    </span>
                  )}
                </div>

                <div className="text-foreground text-xs font-semibold">{activeStore.name}</div>
                <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
                  <MapPin className="size-3 shrink-0" />
                  <span>{activeStore.address}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    className="h-8 flex-1 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                    onClick={() => {
                      const text = encodeURIComponent(
                        `Olá! Estou comprando materiais para o serviço de ${serviceTitle} através do Severinno Marketplace. Vocês têm os itens disponíveis?`,
                      )
                      window.open(`https://wa.me/${activeStore.whatsapp}?text=${text}`, "_blank")
                    }}
                  >
                    <MessageCircle className="size-3.5" />
                    Chamar no WhatsApp
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 gap-1.5 text-xs font-semibold"
                    onClick={() => window.open(activeStore.mapsUrl, "_blank")}
                  >
                    <ExternalLink className="size-3.5" />
                    Ver no Google Maps
                  </Button>
                </div>
              </div>
            )}

            {/* Action */}
            <div className="flex justify-end border-t pt-2">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
