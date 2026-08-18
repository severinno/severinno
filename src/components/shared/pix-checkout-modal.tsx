"use client"

/**
 * PixCheckoutModal — inline PIX payment modal with QR code, copy-to-clipboard,
 * countdown timer, and automatic payment detection via polling.
 *
 * Flow:
 * 1. Calls POST /api/bookings/[id]/pay to generate PIX charge
 * 2. Displays QR Code (rendered client-side) + copia-e-cola text
 * 3. Polls GET /api/bookings/[id] every 5s to detect payment confirmation
 * 4. Shows success state with animation when paid
 */

import * as React from "react"
import { QRCodeSVG } from "qrcode.react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ClipboardCopy, Loader2, QrCode, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

import { apiGet, apiPost } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PixCountdown } from "@/components/shared/pix-countdown"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PixPayResponse = {
  paymentMethod: "PIX"
  status: string
  lytexStatus: string
  qrCode: string
  qrCodeImage?: string
  lytexId: string
  expiresAt?: string
}

type BookingPaymentCheck = {
  booking: {
    id: string
    paymentStatus: string
    status: string
  }
}

type PixCheckoutModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  amount: number
  /** Callback when payment is confirmed */
  onPaymentConfirmed?: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PixCheckoutModal({
  open,
  onOpenChange,
  bookingId,
  amount,
  onPaymentConfirmed,
}: PixCheckoutModalProps) {
  const qc = useQueryClient()
  const [copied, setCopied] = React.useState(false)
  const [isPaid, setIsPaid] = React.useState(false)
  const [isExpired, setIsExpired] = React.useState(false)
  const [fallbackExpiresAt] = React.useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  )

  // Step 1: Generate PIX charge
  const pixMutation = useMutation({
    mutationFn: () => apiPost<PixPayResponse>(`/api/bookings/${bookingId}/pay`),
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Erro ao gerar PIX. Tente novamente.")
    },
  })

  // Auto-trigger PIX generation when modal opens
  React.useEffect(() => {
    if (open && !pixMutation.data && !pixMutation.isPending) {
      pixMutation.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCopied(false)
      setIsPaid(false)
      setIsExpired(false)
    }
    onOpenChange(next)
  }

  // Step 2: Poll for payment confirmation every 5s
  const pixData = pixMutation.data
  useQuery<BookingPaymentCheck>({
    queryKey: ["booking-payment-check", bookingId],
    queryFn: () => apiGet<BookingPaymentCheck>(`/api/bookings/${bookingId}`),
    enabled: open && !!pixData && !isPaid && !isExpired,
    refetchInterval: 5_000,
    select: (data) => {
      if (data.booking.paymentStatus === "PAID" && !isPaid) {
        setIsPaid(true)
        toast.success("Pagamento confirmado! 🎉")
        qc.invalidateQueries({ queryKey: ["bookings"] })
        qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
        onPaymentConfirmed?.()
      }
      return data
    },
  })

  // Copy to clipboard
  const handleCopy = React.useCallback(async () => {
    if (!pixData?.qrCode) return
    try {
      await navigator.clipboard.writeText(pixData.qrCode)
      setCopied(true)
      toast.success("Código PIX copiado!")
      setTimeout(() => setCopied(false), 3_000)
    } catch {
      // Fallback for browsers without clipboard API
      const textarea = document.createElement("textarea")
      textarea.value = pixData.qrCode
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      setCopied(true)
      toast.success("Código PIX copiado!")
      setTimeout(() => setCopied(false), 3_000)
    }
  }, [pixData])

  const expiresAt = pixData?.expiresAt ?? fallbackExpiresAt

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-emerald-600" />
            Pagamento via PIX
          </DialogTitle>
          <DialogDescription>
            Escaneie o QR Code ou copie o código para pagar{" "}
            <span className="text-foreground font-semibold">{formatBRL(amount)}</span>
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {/* Loading state */}
          {pixMutation.isPending && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-3 py-10"
            >
              <Loader2 className="size-8 animate-spin text-emerald-600" />
              <p className="text-muted-foreground text-sm">Gerando QR Code PIX…</p>
            </motion.div>
          )}

          {/* Error state */}
          {pixMutation.isError && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 py-8"
            >
              <X className="size-10 text-red-500" />
              <p className="text-muted-foreground text-center text-sm">
                Não foi possível gerar o PIX. Tente novamente.
              </p>
              <Button variant="outline" onClick={() => pixMutation.mutate()} className="gap-2">
                <QrCode className="size-4" />
                Tentar novamente
              </Button>
            </motion.div>
          )}

          {/* Payment confirmed! */}
          {isPaid && (
            <motion.div
              key="paid"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="flex size-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40"
              >
                <Check className="size-10 text-emerald-600 dark:text-emerald-400" />
              </motion.div>
              <div className="text-center">
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  Pagamento confirmado!
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {formatBRL(amount)} recebido com sucesso.
                </p>
              </div>
              <Button onClick={() => onOpenChange(false)} className="gap-2">
                <Check className="size-4" />
                Fechar
              </Button>
            </motion.div>
          )}

          {/* Expired */}
          {isExpired && !isPaid && (
            <motion.div
              key="expired"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 py-8"
            >
              <X className="size-10 text-amber-500" />
              <p className="text-muted-foreground text-center text-sm">
                O QR Code PIX expirou. Gere um novo código.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setIsExpired(false)
                  pixMutation.mutate()
                }}
                className="gap-2"
              >
                <QrCode className="size-4" />
                Gerar novo PIX
              </Button>
            </motion.div>
          )}

          {/* QR Code display (main state) */}
          {pixData && !isPaid && !isExpired && !pixMutation.isPending && (
            <motion.div
              key="qrcode"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4"
            >
              {/* QR Code with countdown */}
              <div className="flex items-start gap-4">
                <div className="rounded-xl border-2 border-emerald-200 bg-white p-3 dark:border-emerald-800 dark:bg-zinc-900">
                  <QRCodeSVG
                    value={pixData.qrCode}
                    size={180}
                    level="M"
                    includeMargin={false}
                    bgColor="transparent"
                    fgColor="currentColor"
                    className="text-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <PixCountdown
                    expiresAt={expiresAt}
                    onExpired={() => setIsExpired(true)}
                    size={72}
                  />
                  <span className="text-muted-foreground text-[10px]">Expira em</span>
                </div>
              </div>

              {/* Amount badge */}
              <div className="rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {formatBRL(amount)}
              </div>

              {/* Copy button */}
              <Button
                onClick={handleCopy}
                variant={copied ? "default" : "outline"}
                className="w-full gap-2"
              >
                {copied ? (
                  <>
                    <Check className="size-4" />
                    Código copiado!
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="size-4" />
                    Copiar código PIX (copia e cola)
                  </>
                )}
              </Button>

              {/* PIX code preview (truncated) */}
              <div className="bg-muted/50 w-full rounded-lg p-3">
                <p className="text-muted-foreground text-center font-mono text-[10px] leading-relaxed break-all">
                  {pixData.qrCode.length > 120
                    ? `${pixData.qrCode.slice(0, 60)}...${pixData.qrCode.slice(-40)}`
                    : pixData.qrCode}
                </p>
              </div>

              {/* Security badge */}
              <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <ShieldCheck className="size-3.5 text-emerald-600" />
                Pagamento seguro via Lytex Pagamentos
              </div>

              {/* Waiting indicator */}
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Aguardando confirmação do pagamento…
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
