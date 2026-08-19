"use client"

/**
 * ProviderFinancialHub — Comprehensive Financial Management & Digital Receipts for Providers.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, FileText, Loader2, Lock, Receipt, TrendingUp, Wallet } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatBRL, formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

type FinancialResponse = {
  ok: boolean
  summary: {
    totalGross: number
    totalNet: number
    totalPlatformFee: number
    custodyBalance: number
    availableBalance: number
    completedCount: number
    inProgressCount: number
  }
  transactions: Array<{
    id: string
    date: string
    serviceTitle: string
    clientName: string
    grossAmount: number
    netAmount: number
    receiptUrl: string
  }>
}

type ReceiptData = {
  serialNumber: string
  authCode: string
  issueDate: string
  serviceDate: string
  service: { title: string; location: string }
  financials: { formattedTotal: string; paymentMethod: string }
  provider: { name: string; document: string }
  client: { name: string }
}

export function ProviderFinancialHub() {
  const [selectedReceiptId, setSelectedReceiptId] = React.useState<string | null>(null)

  const { data, isLoading } = useQuery<FinancialResponse>({
    queryKey: ["provider-financial-summary"],
    queryFn: () => apiGet<FinancialResponse>("/api/provider/financial-summary"),
  })

  const { data: receiptData, isLoading: loadingReceipt } = useQuery<{
    ok: boolean
    receipt: ReceiptData
  }>({
    queryKey: ["booking-receipt", selectedReceiptId],
    queryFn: () =>
      apiGet<{ ok: boolean; receipt: ReceiptData }>(`/api/bookings/${selectedReceiptId}/receipt`),
    enabled: !!selectedReceiptId,
  })

  if (isLoading) {
    return <Skeleton className="h-80 w-full rounded-xl" />
  }

  const s = data?.summary
  const transactions = data?.transactions ?? []

  return (
    <div className="space-y-6">
      {/* 4 Overview Metric Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-background rounded-xl border shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Faturamento Bruto</div>
              <div className="text-foreground text-lg font-bold tabular-nums">
                {formatBRL(s?.totalGross ?? 0)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background rounded-xl border shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-950">
              <Wallet className="size-5" />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Líquido Recebido</div>
              <div className="text-lg font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                {formatBRL(s?.totalNet ?? 0)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background rounded-xl border shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950">
              <Lock className="size-5" />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Em Custódia (Escrow)</div>
              <div className="text-lg font-bold text-amber-600 tabular-nums">
                {formatBRL(s?.custodyBalance ?? 0)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background rounded-xl border shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-950">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Serviços Concluídos</div>
              <div className="text-foreground text-lg font-bold tabular-nums">
                {s?.completedCount ?? 0}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Escrow Custody Explanation Alert */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="space-y-0.5">
          <strong>Como funciona a Custódia Segura (Escrow):</strong>
          <p className="text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
            Os pagamentos dos clientes ficam 100% protegidos em conta custodiada. Assim que você
            finalizar o serviço e o cliente confirmar (ou em até 72h automáticas), o valor líquido é
            liberado para a sua chave PIX cadastrada.
          </p>
        </div>
      </div>

      {/* Recent Transactions & Digital Receipts Table */}
      <Card className="rounded-xl border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Receipt className="size-5 text-emerald-600" />
              Extrato de Serviços & Recibos Oficiais
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-xs">
              Nenhuma transação concluída ainda.
            </div>
          ) : (
            <div className="divide-y text-xs">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between gap-2 py-3">
                  <div className="space-y-0.5">
                    <div className="text-foreground font-semibold">{tx.serviceTitle}</div>
                    <div className="text-muted-foreground text-[11px]">
                      Cliente: {tx.clientName} • {formatDate(tx.date)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                        {formatBRL(tx.netAmount)}
                      </div>
                      <div className="text-muted-foreground text-[10px] line-through">
                        Bruto: {formatBRL(tx.grossAmount)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedReceiptId(tx.id)}
                      className="h-7 gap-1 border-emerald-300 px-2.5 text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                      <FileText className="size-3" />
                      Recibo
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Modal Dialog */}
      <Dialog
        open={!!selectedReceiptId}
        onOpenChange={(open) => !open && setSelectedReceiptId(null)}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Receipt className="size-5 text-emerald-600" />
              Recibo Digital de Serviço
            </DialogTitle>
          </DialogHeader>

          {loadingReceipt || !receiptData?.receipt ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-emerald-600" />
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="bg-muted/40 space-y-1 rounded-lg border p-3">
                <div className="text-muted-foreground flex justify-between font-mono text-[11px]">
                  <span>Nº: {receiptData.receipt.serialNumber}</span>
                  <span>Autenticação: {receiptData.receipt.authCode}</span>
                </div>
                <div className="text-foreground text-sm font-bold">
                  {receiptData.receipt.service.title}
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Realizado em: {receiptData.receipt.serviceDate}
                </div>
              </div>

              <div className="space-y-2 border-t pt-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prestador:</span>
                  <span className="font-semibold">{receiptData.receipt.provider.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente:</span>
                  <span className="font-semibold">{receiptData.receipt.client.name}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-sm font-bold">
                  <span>Valor Total Pago:</span>
                  <span className="text-emerald-600">
                    {receiptData.receipt.financials.formattedTotal}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-emerald-50 p-2.5 text-center text-[10px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                ✔ Recibo autenticado pela plataforma Severinno Marketplace SaaS
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
