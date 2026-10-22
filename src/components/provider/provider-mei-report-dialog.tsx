"use client"

/**
 * ProviderMeiReportDialog — Modal de Demonstrativo Mensal & Relatório MEI/DRE.
 *
 * Permite ao prestador gerar em 1 clique o Demonstrativo Contábil do Exercício (DRE)
 * e o Extrato de Faturamento para o MEI, com exportação para PDF, CSV e compartilhamento.
 */

import * as React from "react"
import { Download, FileSpreadsheet, Loader2, Printer, Share2 } from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { formatBRL } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ProviderMeiReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProviderMeiReportDialog({ open, onOpenChange }: ProviderMeiReportDialogProps) {
  const now = React.useMemo(() => new Date(), [])
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const [selectedMonth, setSelectedMonth] = React.useState(currentMonthStr)
  const [loading, setLoading] = React.useState(false)
  const [reportData, setReportData] = React.useState<{
    dre: {
      providerName: string
      totalBookings: number
      grossRevenue: number
      platformFees: number
      netRevenue: number
      escrowReleased: number
      ytdGross: number
      meiAnnualLimit: number
      meiPercentUsed: number
      isWithinMeiLimit: boolean
    }
  } | null>(null)

  // Last 6 months options
  const monthOptions = React.useMemo(() => {
    return Array.from({ length: 6 }).map((_, index) => {
      const d = new Date(now.getFullYear(), now.getMonth() - index, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      return {
        value: val,
        label: label.charAt(0).toUpperCase() + label.slice(1),
      }
    })
  }, [now])

  React.useEffect(() => {
    if (!open) return

    let cancelled = false
    async function fetchDreData() {
      setLoading(true)
      try {
        const res = await fetch(`/api/provider/reports?type=dre&month=${selectedMonth}&format=json`)
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            setReportData(data)
          }
        }
      } catch {
        // Fallback
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchDreData()
    return () => {
      cancelled = true
    }
  }, [open, selectedMonth])

  const handlePrintPdf = () => {
    triggerHaptic("selection")
    const url = `/api/provider/reports?type=dre&month=${selectedMonth}&format=html`
    window.open(url, "_blank")
  }

  const handleDownloadCsv = () => {
    triggerHaptic("selection")
    const url = `/api/provider/reports?type=dre&month=${selectedMonth}&format=csv`
    const a = document.createElement("a")
    a.href = url
    a.download = `demonstrativo-mei-${selectedMonth}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleShareWhatsApp = () => {
    triggerHaptic("selection")
    const dre = reportData?.dre
    const appUrl =
      typeof window !== "undefined" ? window.location.origin : "https://severinno.com.br"
    const receiptUrl = `${appUrl}/api/provider/reports?type=dre&month=${selectedMonth}&format=html`
    const msg = `*Demonstrativo Contábil MEI — Severinno*\nCompetência: ${selectedMonth}\nAtendimentos: ${dre?.totalBookings ?? 0}\nFaturamento Bruto: ${formatBRL(dre?.grossRevenue ?? 0)}\nRepasse Líquido: ${formatBRL(dre?.netRevenue ?? 0)}\n\nAcesse o DRE completo em:\n${receiptUrl}`
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600">
              <FileSpreadsheet className="size-5" />
            </span>
            <div>
              <DialogTitle className="text-base font-bold">
                Demonstrativo Mensal &amp; Extrato MEI
              </DialogTitle>
              <DialogDescription className="text-xs">
                Relatório contábil DRE com faturamento bruto, taxas e repasses PIX
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-5">
          {/* Competency Month Selector */}
          <div>
            <label className="text-foreground text-xs font-semibold">Mês de Competência</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {monthOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    setSelectedMonth(opt.value)
                  }}
                  className={`h-8 rounded-lg border text-xs font-medium transition-all ${
                    selectedMonth === opt.value
                      ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "border-border/60 bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* DRE Summary Card */}
          <div className="border-border/70 bg-card rounded-xl border p-4 shadow-2xs">
            {loading ? (
              <div className="text-muted-foreground flex h-32 items-center justify-center text-xs">
                <Loader2 className="mr-2 size-4 animate-spin" /> Carregando demonstrativo...
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-muted-foreground text-xs">Faturamento Bruto</span>
                  <span className="text-foreground text-sm font-bold tabular-nums">
                    {formatBRL(reportData?.dre?.grossRevenue ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-muted-foreground text-xs">Taxa da Plataforma (12%)</span>
                  <span className="text-xs font-semibold text-rose-500 tabular-nums">
                    - {formatBRL(reportData?.dre?.platformFees ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-foreground text-xs font-semibold">
                    Receita Líquida Recebida
                  </span>
                  <span className="text-base font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                    {formatBRL(reportData?.dre?.netRevenue ?? 0)}
                  </span>
                </div>

                {/* MEI Limit Bar */}
                <div className="bg-muted/40 rounded-lg p-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Limite Anual MEI (R$ 81k)</span>
                    <span className="font-semibold tabular-nums">
                      {reportData?.dre?.meiPercentUsed ?? 0}% utilizado
                    </span>
                  </div>
                  <div className="bg-muted-foreground/20 mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${Math.min(reportData?.dre?.meiPercentUsed ?? 0, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Export Action Buttons */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              onClick={handlePrintPdf}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-1.5 rounded-xl text-xs font-semibold shadow-xs active:scale-95"
            >
              <Printer className="size-3.5" /> Imprimir / Salvar PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              className="border-border/80 hover:bg-muted h-9 gap-1.5 rounded-xl text-xs font-semibold active:scale-95"
            >
              <Download className="size-3.5" /> Baixar Planilha CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleShareWhatsApp}
              className="h-9 gap-1.5 rounded-xl border-emerald-500/30 text-xs font-semibold text-emerald-700 hover:bg-emerald-50/50 active:scale-95 sm:col-span-2 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              <Share2 className="size-3.5" /> Enviar Resumo pelo WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
