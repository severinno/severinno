"use client"

import * as React from "react"
import {
  Download,
  FileSpreadsheet,
  Calendar,
  DollarSign,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { PageTransition } from "@/components/shared/page-transition"

export function ReportsExport() {
  const [reportType, setReportType] = React.useState<"bookings" | "quotes" | "financial">(
    "bookings",
  )
  const [period, setPeriod] = React.useState("30d")
  const [downloading, setDownloading] = React.useState(false)

  const handleDownload = () => {
    setDownloading(true)
    try {
      const url = `/api/provider/reports?type=${reportType}&period=${period}&format=csv`
      const a = document.createElement("a")
      a.href = url
      a.setAttribute("download", `relatorio-${reportType}-${period}.csv`)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      toast.success("Download do relatório iniciado!", {
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
      })
    } catch {
      toast.error("Erro ao iniciar download.")
    } finally {
      setDownloading(false)
    }
  }

  const reportsConfig = [
    {
      type: "bookings",
      title: "Agendamentos e Serviços",
      description: "Histórico detalhado de clientes, datas, serviços executados e valores.",
      icon: <Calendar className="h-5 w-5 text-blue-500" />,
    },
    {
      type: "quotes",
      title: "Orçamentos e Propostas",
      description: "Listagem de propostas enviadas, taxa de aceite e valores ofertados.",
      icon: <FileSpreadsheet className="h-5 w-5 text-purple-500" />,
    },
    {
      type: "financial",
      title: "Fechamento Financeiro",
      description: "Demonstrativo de faturamento bruto, taxas de serviço e valor líquido recebido.",
      icon: <DollarSign className="h-5 w-5 text-emerald-500" />,
    },
  ]

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary rounded-xl p-2.5">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Exportação de Relatórios Gerenciais</CardTitle>
              <CardDescription>
                Baixe planilhas CSV compatíveis com Excel e Google Sheets para sua contabilidade.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Report Type Selector */}
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              1. Selecione o Tipo de Relatório
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {reportsConfig.map((item) => {
                const isSelected = reportType === item.type
                return (
                  <div
                    key={item.type}
                    onClick={() => setReportType(item.type as "bookings" | "quotes" | "financial")}
                    className={`cursor-pointer rounded-xl border p-4 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-primary shadow-xs ring-1"
                        : "border-border/60 bg-muted/10 hover:bg-muted/30"
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      {item.icon}
                      <span className="text-foreground text-sm font-semibold">{item.title}</span>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Period Selector */}
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              2. Período de Apuração
            </label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-10 w-full sm:w-[260px]">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias (Trimestre)</SelectItem>
                <SelectItem value="all">Todo o histórico</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Export Action */}
          <div className="border-border/50 flex flex-col items-center justify-between gap-4 border-t pt-4 sm:flex-row">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Formato UTF-8 com separador padrão brasileiro (;).
            </p>
            <Button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full gap-2 px-6 shadow-sm sm:w-auto"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? "Gerando planilha..." : "Baixar Relatório em CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageTransition>
  )
}

export default ReportsExport
