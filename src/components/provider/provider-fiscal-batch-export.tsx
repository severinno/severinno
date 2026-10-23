"use client"

import { useState, useEffect } from "react"
import {
  FileText,
  Download,
  Printer,
  FileSpreadsheet,
  Code,
  Calendar,
  Share2,
  Mail,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function ProviderFiscalBatchExport() {
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr)
  const [format, setFormat] = useState<"html" | "csv" | "json">("html")
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<{
    totalBookings: number
    totalGross: number
    totalNet: number
  } | null>(null)

  // Generate options for the last 6 months
  const monthOptions = Array.from({ length: 6 }).map((_, index) => {
    const d = new Date(now.getFullYear(), now.getMonth() - index, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    return {
      value: val,
      label: label.charAt(0).toUpperCase() + label.slice(1),
    }
  })

  useEffect(() => {
    async function fetchStats() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/provider/reports/batch-receipts?month=${selectedMonth}&format=json`,
        )
        if (res.ok) {
          const data = await res.json()
          setStats({
            totalBookings: data.totalBookings,
            totalGross: data.totalGross,
            totalNet: data.totalNet,
          })
        }
      } catch {
        // Fallback
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [selectedMonth])

  const handleExport = () => {
    const exportUrl = `/api/provider/reports/batch-receipts?month=${selectedMonth}&format=${format}`
    if (format === "html") {
      window.open(exportUrl, "_blank")
    } else {
      const a = document.createElement("a")
      a.href = exportUrl
      a.download = `recibos-lote-${selectedMonth}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const handleShareWhatsApp = () => {
    const appUrl =
      typeof window !== "undefined" ? window.location.origin : "https://severinno.com.br"
    const receiptUrl = `${appUrl}/api/provider/reports/batch-receipts?month=${selectedMonth}&format=html`
    const msg = `*Extrato Fiscal e Recibos — Severinno*\nCompetência: ${selectedMonth}\nRecibos emitidos: ${stats?.totalBookings ?? 0}\nFaturamento Bruto: R$ ${(stats?.totalGross ?? 0).toFixed(2)}\nRepasse Líquido: R$ ${(stats?.totalNet ?? 0).toFixed(2)}\n\nAcesse o lote de recibos em:\n${receiptUrl}`
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank")
  }

  const handleShareEmail = () => {
    const appUrl =
      typeof window !== "undefined" ? window.location.origin : "https://severinno.com.br"
    const receiptUrl = `${appUrl}/api/provider/reports/batch-receipts?month=${selectedMonth}&format=html`
    const subject = `Extrato de Recibos e Faturamento - Competência ${selectedMonth} - Severinno`
    const body = `Olá!\n\nSegue o extrato consolidado de prestação de serviços referente à competência ${selectedMonth}.\n\nTotal de atendimentos: ${stats?.totalBookings ?? 0}\nFaturamento Bruto: R$ ${(stats?.totalGross ?? 0).toFixed(2)}\nRepasse Líquido: R$ ${(stats?.totalNet ?? 0).toFixed(2)}\n\nO documento fiscal com recibos e códigos de autenticidade pode ser visualizado e impresso no link:\n${receiptUrl}\n\nAtenciosamente,\nSeverinno Marketplace`
    window.open(
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      "_blank",
    )
  }

  const handleExportDRE = (outputFormat: "html" | "csv") => {
    const dreUrl = `/api/provider/reports?type=dre&month=${selectedMonth}&format=${outputFormat}`
    if (outputFormat === "html") {
      window.open(dreUrl, "_blank")
    } else {
      const a = document.createElement("a")
      a.href = dreUrl
      a.download = `dre-mensal-${selectedMonth}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
              <FileText className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                Lote de Recibos Fiscais & Extrato Contábil
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                Exporte recibos consolidados e retenções para MEI, Simples Nacional ou IRPF
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300"
          >
            Fiscal
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Mês de Competência */}
          <div className="space-y-1.5">
            <label
              htmlFor="competencia-select"
              className="text-muted-foreground flex items-center gap-1 text-xs font-semibold"
            >
              <Calendar className="size-3.5" /> Competência (Mês/Ano)
            </label>
            <select
              id="competencia-select"
              aria-label="Competência (Mês/Ano)"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border-input bg-background focus:ring-primary w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Formato de Exportação */}
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-semibold">Formato de Saída</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormat("html")}
                className={`flex flex-col items-center justify-center rounded-md border p-2 text-xs font-medium transition-all ${
                  format === "html"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <Printer className="mb-1 size-4" />
                HTML / PDF
              </button>
              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={`flex flex-col items-center justify-center rounded-md border p-2 text-xs font-medium transition-all ${
                  format === "csv"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <FileSpreadsheet className="mb-1 size-4" />
                Excel (CSV)
              </button>
              <button
                type="button"
                onClick={() => setFormat("json")}
                className={`flex flex-col items-center justify-center rounded-md border p-2 text-xs font-medium transition-all ${
                  format === "json"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <Code className="mb-1 size-4" />
                JSON
              </button>
            </div>
          </div>
        </div>

        {/* Resumo do Mês */}
        <div className="bg-muted/40 rounded-lg border p-3">
          <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs">
            <span>Prévia da Competência</span>
            {loading && <span className="animate-pulse">Atualizando...</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-muted-foreground text-xs">Recibos Emitidos</p>
              <p className="text-foreground text-base font-bold">{stats?.totalBookings ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Faturamento Bruto</p>
              <p className="text-foreground text-base font-bold">
                R$ {(stats?.totalGross ?? 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Repasse Líquido</p>
              <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                R$ {(stats?.totalNet ?? 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleExport} className="flex-1 gap-2">
            {format === "html" ? <Printer className="size-4" /> : <Download className="size-4" />}
            {format === "html"
              ? "Visualizar e Imprimir Lote (PDF)"
              : `Baixar Lote (${format.toUpperCase()})`}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleShareWhatsApp}
            className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
          >
            <Share2 className="size-4" /> WhatsApp
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleShareEmail}
            className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300"
          >
            <Mail className="size-4" /> Contador
          </Button>
        </div>

        {/* DRE & Extrato Contábil Especializado para MEI / Autônomo */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <FileText className="size-3.5" />
            <span className="text-foreground font-medium">Demonstrativo DRE &amp; Escrow:</span>
            <span>Fluxo de caixa, taxas (12%) e enquadramento SIMEI</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExportDRE("html")}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Printer className="size-3.5" /> DRE Imprimível (PDF)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExportDRE("csv")}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <FileSpreadsheet className="size-3.5" /> DRE em CSV
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
