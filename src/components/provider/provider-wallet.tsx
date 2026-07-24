"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownLeft,
  Banknote,
  Clock,
  History,
  Loader2,
  TrendingUp,
  Wallet,
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
// Wallet stat card
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
    <Card className="overflow-hidden rounded-xl shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="p-0">
        <div className="flex items-center gap-4 p-4">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl",
              accent === "emerald" &&
                "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
              accent === "amber" &&
                "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
              accent === "blue" &&
                "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
              accent === "violet" &&
                "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
            )}
          >
            <Icon className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="truncate text-2xl font-bold tabular-nums tracking-tight">
              {value}
            </p>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {/* Accent bar */}
        <div
          className={cn(
            "h-1 w-full",
            accent === "emerald" && "bg-emerald-500",
            accent === "amber" && "bg-amber-500",
            accent === "blue" && "bg-blue-500",
            accent === "violet" && "bg-violet-500",
          )}
        />
      </CardContent>
    </Card>
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
    mutationFn: (value: number) =>
      apiPost("/api/provider/wallet/withdraw", { amount: value }),
    onSuccess: () => {
      toast.success("Saque realizado com sucesso!")
      setAmount("")
      setError(null)
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: any) => {
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
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownLeft className="size-4" />
            Simular Saque
          </DialogTitle>
          <DialogDescription>
            Digite o valor que deseja sacar da sua carteira virtual.
            Saldo disponível: <strong>{formatBRL(balance)}</strong>
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
                className="h-8 text-xs"
              >
                R$ {v}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={balance <= 0}
              onClick={() => handlePreset(balance)}
              className="h-8 text-xs"
            >
              Total
            </Button>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <Label htmlFor="withdraw-amount">Valor do saque</Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
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
                className="pl-8 text-lg font-semibold tabular-nums"
                autoFocus
              />
            </div>
            {error && (
              <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Processando…
              </>
            ) : (
              `Sacar ${formatBRL(numericAmount || 0)}`
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
    // Also invalidate dashboard wallet query
    queryClient.invalidateQueries({ queryKey: ["provider", "wallet"] })
  }

  if (isLoading) {
    return (
      <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    )
  }

  if (!data) return null

  const recentTransactions = data.transactions.slice(0, 8)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Wallet className="size-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              Carteira Virtual
            </h3>
            <p className="text-sm text-muted-foreground">
              Saldo simulado baseado em serviços realizados
            </p>
          </div>
        </div>
        <Button
          size="sm"
          className="h-9 gap-1.5"
          disabled={data.balance <= 0}
          onClick={() => setWithdrawOpen(true)}
        >
          <ArrowDownLeft className="size-3.5" />
          Simular Saque
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <WalletStatCard
          label="Saldo disponível"
          value={formatBRL(data.balance)}
          icon={Wallet}
          accent="emerald"
          subtitle={data.totalWithdrawn > 0 ? `Total sacado: ${formatBRL(data.totalWithdrawn)}` : "Disponível para saque"}
        />
        <WalletStatCard
          label="A receber"
          value={formatBRL(data.pendingBalance)}
          icon={Clock}
          accent="amber"
          subtitle="Serviços em andamento"
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
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="border-b py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              Últimas transações
            </CardTitle>
            {data.transactions.length > 8 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="size-3" />
                Ver extrato completo
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3">
          {recentTransactions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Wallet className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">
                Nenhuma transação ainda.
              </p>
              <p className="text-xs text-muted-foreground">
                Complete um agendamento para ver seu saldo.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
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
      <TransactionHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  )
}

export default ProviderWallet
