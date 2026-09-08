"use client"

/**
 * PixCheckout — Dynamic PIX checkout component with QR code display,
 * copy-paste, countdown timer, and automatic payment confirmation.
 *
 * Features:
 *   - Inline QR code display (image from Lytex)
 *   - "Copiar código PIX" button with clipboard feedback
 *   - 24h countdown timer with progress bar
 *   - Auto-polling every 5s for payment confirmation
 *   - Visual state machine: generating → awaiting → confirmed → expired
 *   - Subtle coin sound on payment confirmation
 *   - Fully responsive (mobile-first)
 */

import * as React from "react"
import {
  QrCode,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Smartphone,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { apiGet, apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { playCoinSound } from "@/lib/sounds"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PixCheckoutProps = {
  bookingId: string
  amount: number
  onPaymentConfirmed?: () => void
  className?: string
}

type PixCheckoutState = "idle" | "generating" | "awaiting" | "confirmed" | "expired" | "error"

type PayResponse = {
  paymentMethod: string
  status: string
  lytexStatus?: string
  qrCode?: string
  qrCodeImage?: string
  lytexId?: string
  expiresAt?: string
}

type StatusResponse = {
  paymentStatus: string
  payment?: {
    status: string
    lytexStatus?: string
    paidAt?: string
    qrCode?: string
    qrCodeImage?: string
  } | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PixCheckout({
  bookingId,
  amount,
  onPaymentConfirmed,
  className,
}: PixCheckoutProps) {
  const [state, setState] = React.useState<PixCheckoutState>("idle")
  const [qrCode, setQrCode] = React.useState<string | null>(null)
  const [qrCodeImage, setQrCodeImage] = React.useState<string | null>(null)
  const [timeLeft, setTimeLeft] = React.useState<string>("")
  const [progressPct, setProgressPct] = React.useState(100)
  const [copied, setCopied] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const confirmedRef = React.useRef(false)

  // ── Cleanup ──
  React.useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // ── Polling for payment confirmation ──
  const startPolling = React.useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)

    pollRef.current = setInterval(async () => {
      if (confirmedRef.current) {
        if (pollRef.current) clearInterval(pollRef.current)
        return
      }

      try {
        const status = await apiGet<StatusResponse>(`/api/bookings/${bookingId}/pay/status`)

        if (status.paymentStatus === "PAID" || status.payment?.status === "PAID") {
          confirmedRef.current = true
          setState("confirmed")
          playCoinSound({ vibrate: true })
          toast.success("Pagamento PIX confirmado! 🎉")
          onPaymentConfirmed?.()

          if (pollRef.current) clearInterval(pollRef.current)
          if (timerRef.current) clearInterval(timerRef.current)
        }
      } catch {
        // Best effort — continue polling
      }
    }, 5000)
  }, [bookingId, onPaymentConfirmed])

  // ── Countdown timer ──
  const startCountdown = React.useCallback((expires: Date) => {
    if (timerRef.current) clearInterval(timerRef.current)

    const totalMs = expires.getTime() - Date.now()

    const tick = () => {
      const now = Date.now()
      const remaining = expires.getTime() - now

      if (remaining <= 0) {
        setTimeLeft("Expirado")
        setProgressPct(0)
        setState((prev) => (prev === "awaiting" ? "expired" : prev))
        if (timerRef.current) clearInterval(timerRef.current)
        if (pollRef.current) clearInterval(pollRef.current)
        return
      }

      const hours = Math.floor(remaining / 3_600_000)
      const minutes = Math.floor((remaining % 3_600_000) / 60_000)
      const seconds = Math.floor((remaining % 60_000) / 1000)

      if (hours > 0) {
        setTimeLeft(`${hours}h ${String(minutes).padStart(2, "0")}m`)
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}m ${String(seconds).padStart(2, "0")}s`)
      } else {
        setTimeLeft(`${seconds}s`)
      }

      setProgressPct(Math.max(0, (remaining / totalMs) * 100))
    }

    tick()
    timerRef.current = setInterval(tick, 1000)
  }, [])

  // ── Generate PIX charge ──
  const generatePix = React.useCallback(async () => {
    setState("generating")
    setErrorMsg(null)
    confirmedRef.current = false

    try {
      const res = await apiPost<PayResponse>(`/api/bookings/${bookingId}/pay`, {})

      if (res.qrCode) {
        setQrCode(res.qrCode)
        setQrCodeImage(res.qrCodeImage ?? null)

        const expires = res.expiresAt
          ? new Date(res.expiresAt)
          : new Date(Date.now() + 24 * 60 * 60 * 1000) // default 24h

        if (res.status === "PAID") {
          setState("confirmed")
          confirmedRef.current = true
          playCoinSound({ vibrate: true })
          onPaymentConfirmed?.()
          return
        }

        setState("awaiting")
        startPolling()
        startCountdown(expires)
      } else {
        throw new Error("QR Code não disponível")
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar PIX"
      setErrorMsg(msg)
      setState("error")
      toast.error(msg)
    }
  }, [bookingId, onPaymentConfirmed, startCountdown, startPolling])

  // ── Copy PIX code ──
  const handleCopy = React.useCallback(async () => {
    if (!qrCode) return
    try {
      await navigator.clipboard.writeText(qrCode)
      setCopied(true)
      toast.success("Código PIX copiado!")
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast.error("Não foi possível copiar. Selecione o código manualmente.")
    }
  }, [qrCode])

  // ── Render ──
  return (
    <div className={cn("space-y-4", className)}>
      {/* ── Idle: Start button ── */}
      {state === "idle" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/50 p-6 dark:border-emerald-800/40 dark:bg-emerald-950/20">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            <QrCode className="size-8 text-emerald-600" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold">Pagar com PIX</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Pagamento instantâneo e seguro via PIX
            </p>
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
            {formatBRL(amount)}
          </div>
          <Button onClick={generatePix} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Smartphone className="size-4" />
            Gerar QR Code PIX
          </Button>
        </div>
      )}

      {/* ── Generating ── */}
      {state === "generating" && (
        <div className="bg-muted/30 flex flex-col items-center gap-4 rounded-xl border p-8">
          <Loader2 className="size-10 animate-spin text-emerald-600" />
          <p className="text-muted-foreground text-sm">Gerando código PIX…</p>
        </div>
      )}

      {/* ── Awaiting Payment ── */}
      {state === "awaiting" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-5 dark:border-emerald-800/40 dark:from-emerald-950/30 dark:to-transparent">
          {/* Amount */}
          <div className="text-center">
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Valor a pagar
            </p>
            <p className="text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
              {formatBRL(amount)}
            </p>
          </div>

          {/* QR Code */}
          {qrCodeImage ? (
            <div className="rounded-xl border-2 border-emerald-100 bg-white p-3 shadow-sm dark:border-emerald-800/30 dark:bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCodeImage}
                alt="QR Code PIX"
                className="size-48 sm:size-56"
                width={224}
                height={224}
              />
            </div>
          ) : (
            <div className="flex size-48 items-center justify-center rounded-xl border-2 border-dashed border-emerald-200 bg-white dark:border-emerald-800/30 dark:bg-zinc-900">
              <QrCode className="text-muted-foreground size-16" />
            </div>
          )}

          {/* Instructions */}
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
            <Smartphone className="mt-0.5 size-4 shrink-0" />
            <span>
              Abra o app do seu banco, selecione <strong>Pagar com PIX</strong> e escaneie o QR code
              acima. Ou copie o código abaixo.
            </span>
          </div>

          {/* Copy PIX code */}
          <Button
            variant="outline"
            onClick={handleCopy}
            className={cn(
              "w-full gap-2 transition-colors",
              copied &&
                "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
            )}
          >
            {copied ? (
              <>
                <Check className="size-4" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copiar código PIX
              </>
            )}
          </Button>

          {/* Timer */}
          <div className="w-full space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Clock className="size-3" />
                Expira em
              </span>
              <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">
                {timeLeft}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-1000 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Polling indicator */}
          <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <Loader2 className="size-3 animate-spin" />
            Aguardando confirmação automática…
          </p>
        </div>
      )}

      {/* ── Confirmed ── */}
      {state === "confirmed" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-emerald-300 bg-gradient-to-b from-emerald-50 to-emerald-100/50 p-6 dark:border-emerald-700 dark:from-emerald-950/40 dark:to-emerald-950/20">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/40">
            <CheckCircle2 className="size-8 text-white" />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
              Pagamento confirmado!
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Seu pagamento PIX de{" "}
              <span className="font-semibold text-emerald-600">{formatBRL(amount)}</span> foi
              processado com sucesso.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-200/60 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Protegido pelo Severinno Escrow
          </div>
        </div>
      )}

      {/* ── Expired ── */}
      {state === "expired" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-amber-200 bg-amber-50/50 p-6 dark:border-amber-800/40 dark:bg-amber-950/20">
          <div className="flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <AlertTriangle className="size-7 text-amber-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-amber-800 dark:text-amber-300">QR Code expirado</p>
            <p className="text-muted-foreground mt-1 text-sm">
              O código PIX expirou. Gere um novo para continuar.
            </p>
          </div>
          <Button onClick={generatePix} variant="outline" className="gap-2">
            <RefreshCw className="size-4" />
            Gerar novo QR Code
          </Button>
        </div>
      )}

      {/* ── Error ── */}
      {state === "error" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-red-200 bg-red-50/50 p-6 dark:border-red-800/40 dark:bg-red-950/20">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
            <AlertTriangle className="size-7 text-red-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-red-800 dark:text-red-300">Erro ao gerar PIX</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {errorMsg || "Tente novamente em alguns instantes."}
            </p>
          </div>
          <Button onClick={generatePix} variant="outline" className="gap-2">
            <RefreshCw className="size-4" />
            Tentar novamente
          </Button>
        </div>
      )}
    </div>
  )
}

export default PixCheckout
