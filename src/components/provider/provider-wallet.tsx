"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownLeft,
  Banknote,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react"

import { apiGet, apiPost } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types (mirroring API response — avoids cross-layer import)
// ---------------------------------------------------------------------------

type SimulatedWallet = {
  balance: number
  pendingBalance: number
  totalReceived: number
  totalBookings: number
  avgTicket: number
  totalWithdrawn: number
  transactions: Array<{
    id: string
    bookingId: string
    amount: number
    fee: number
    netAmount: number
    status: "paid" | "pending" | "refunded" | "withdrawn"
    description: string
    clientName: string
    date: string
  }>
}

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"
import { TransactionRow } from "./wallet-row"
import { TransactionHistory } from "./transaction-history"

// ---------------------------------------------------------------------------
// Wallet stat card — Nielsen #8 (Aesthetic and minimalist design)
// ---------------------------------------------------------------------------

function WalletStatCard({
  label,
  value,
  icon: Icon,
  accent,
  subtitle,
}: {
  label: string
  value: string
  icon: typeof Wallet
  accent: "emerald" | "amber" | "blue" | "violet"
  subtitle?: string
}) {
  return (
    <div className="group border-border/60 bg-card/70 hover:border-border relative flex flex-col justify-between rounded-2xl border p-4.5 shadow-2xs backdrop-blur-xs transition-all duration-200 hover:shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          {label}
        </span>
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
            accent === "emerald" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            accent === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            accent === "blue" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
            accent === "violet" && "bg-violet-500/10 text-violet-600 dark:text-violet-400",
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>

      <div className="mt-3">
        <p className="text-foreground truncate text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
          {value}
        </p>
        {subtitle && <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">{subtitle}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Withdraw dialog
// ---------------------------------------------------------------------------

function WithdrawDialog({
  open,
  onOpenChange,
  balance,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  balance: number
  onSuccess: () => void
}) {
  const [amount, setAmount] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (value: number) => apiPost("/api/provider/wallet/withdraw", { amount: value }),
    onSuccess: () => {
      toast.success("Saque realizado com sucesso!")
      setAmount("")
      setError(null)
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: Error) => {
      const msg = err?.message ?? "Erro ao realizar saque. Tente novamente."
      setError(msg)
      toast.error(msg)
    },
  })

  const numericAmount = Number.parseFloat(amount.replace(",", "."))
  const isValid = !Number.isNaN(numericAmount) && numericAmount > 0 && numericAmount <= balance

  const handlePreset = (value: number) => {
    setAmount(value.toFixed(2))
    setError(null)
  }

  const handleSubmit = () => {
    setError(null)
    if (!isValid) {
      setError("Valor inválido. Verifique o saldo disponível.")
      return
    }
    mutation.mutate(numericAmount)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Zap className="size-4" />
            </div>
            Solicitar Saque PIX Instantâneo
          </DialogTitle>
          <DialogDescription className="text-xs">
            O valor selecionado será transferido via PIX para sua chave cadastrada. Saldo
            disponível: <strong className="text-foreground">{formatBRL(balance)}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {[50, 100, 200, 500].map((v) => (
              <Button
                key={v}
                variant="outline"
                size="sm"
                disabled={v > balance}
                onClick={() => handlePreset(v)}
                className="h-8 rounded-lg text-xs font-medium"
              >
                R$ {v}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={balance <= 0}
              onClick={() => handlePreset(balance)}
              className="h-8 rounded-lg text-xs font-semibold"
            >
              Saldo total
            </Button>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <Label htmlFor="withdraw-amount" className="text-xs font-medium">
              Valor do saque
            </Label>
            <div className="relative">
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-semibold">
                R$
              </span>
              <Input
                id="withdraw-amount"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(null)
                }}
                className="h-11 rounded-xl pl-10 text-lg font-bold tabular-nums"
                autoFocus
              />
            </div>
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>

          <div className="border-border/50 bg-muted/40 text-muted-foreground rounded-xl border p-3 text-[11px] leading-relaxed">
            <div className="text-foreground flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              Transferência imediata sem taxa de saque
            </div>
            O PIX é liquidado automaticamente na conta bancária de sua titularidade.
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            className="rounded-xl text-xs"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending}
            className="rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-xs hover:bg-emerald-500"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Processando PIX…
              </>
            ) : (
              `Confirmar saque de ${formatBRL(numericAmount || 0)}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProviderWallet() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [withdrawOpen, setWithdrawOpen] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  const { data, isLoading } = useQuery<SimulatedWallet>({
    queryKey: ["provider", "wallet", user?.id],
    queryFn: () => apiGet("/api/provider/wallet"),
    enabled: !!user,
  })

  const handleWithdrawSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["provider", "wallet", user?.id] })
    queryClient.invalidateQueries({ queryKey: ["provider", "wallet"] })
  }

  if (isLoading) {
    return (
      <div className="grid animate-pulse gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-muted/30 h-28 rounded-2xl border" />
        ))}
      </div>
    )
  }

  if (!data) return null

  const recentTransactions = data.transactions.slice(0, 8)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Wallet className="size-5" />
          </div>
          <div>
            <h3 className="text-foreground text-base font-bold tracking-tight sm:text-lg">
              Carteira Virtual
            </h3>
            <p className="text-muted-foreground text-xs">
              Gestão de recebíveis, custódia escrow e saques instantâneos via PIX
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data.transactions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              className="h-9 gap-1.5 rounded-xl text-xs font-medium"
            >
              <History className="text-muted-foreground size-3.5" />
              Extrato completo
            </Button>
          )}

          <Button
            size="sm"
            className={cn(
              "h-9 gap-1.5 rounded-xl font-semibold shadow-xs transition-all",
              data.balance > 0
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "border-border/50 bg-muted text-muted-foreground hover:bg-muted border",
            )}
            disabled={data.balance <= 0}
            onClick={() => setWithdrawOpen(true)}
            title={
              data.balance <= 0
                ? "Saldo insuficiente para saque"
                : "Solicitar transferência PIX imediata"
            }
          >
            <ArrowDownLeft className="size-3.5" />
            Solicitar Saque PIX
          </Button>
        </div>
      </div>

      {/* Stat cards — 4 Clean minimalist KPI cards (Image 2 Redesign) */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <WalletStatCard
          label="Saldo disponível"
          value={formatBRL(data.balance)}
          icon={Wallet}
          accent="emerald"
          subtitle={
            data.totalWithdrawn > 0
              ? `Total sacado: ${formatBRL(data.totalWithdrawn)}`
              : "Disponível para saque PIX"
          }
        />
        <WalletStatCard
          label="Em Custódia (Escrow)"
          value={formatBRL(data.pendingBalance)}
          icon={Clock}
          accent="amber"
          subtitle="Liberado após aprovação do cliente"
        />
        <WalletStatCard
          label="Total recebido"
          value={formatBRL(data.totalReceived)}
          icon={TrendingUp}
          accent="blue"
          subtitle="Bruto (antes da taxa)"
        />
        <WalletStatCard
          label="Serviços realizados"
          value={String(data.totalBookings)}
          icon={Banknote}
          accent="violet"
          subtitle={`Ticket médio: ${formatBRL(data.avgTicket)}`}
        />
      </div>

      {/* Recent transactions */}
      <Card className="border-border/60 bg-card/70 rounded-2xl border shadow-2xs backdrop-blur-xs">
        <CardHeader className="border-border/40 border-b px-4 py-3.5">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="text-muted-foreground size-4" />
              Últimas transações
            </CardTitle>
            {data.transactions.length > 8 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary h-7 gap-1 px-2 text-xs font-medium"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="size-3" />
                Ver extrato completo
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentTransactions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-2xl">
                <Wallet className="size-5" />
              </div>
              <p className="text-foreground text-sm font-medium">Nenhuma transação ainda</p>
              <p className="text-muted-foreground max-w-xs text-xs">
                Conclua atendimentos de serviços para visualizar seus rendimentos aqui.
              </p>
            </div>
          ) : (
            <div className="divide-border/40 divide-y">
              {recentTransactions.map((t) => (
                <TransactionRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Withdraw dialog */}
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        balance={data.balance}
        onSuccess={handleWithdrawSuccess}
      />

      {/* Transaction history dialog */}
      <TransactionHistory open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  )
}

export default ProviderWallet
