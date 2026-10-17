"use client"

import * as React from "react"
import { CheckCircle2, CreditCard, QrCode, ShieldCheck, Wallet, Copy, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { RadioGroup } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { StepHeader, InfoCard } from "../step-wizard"
import { PaymentOption } from "./payment-option"
import {
  cardNameValid,
  cardNumberValid,
  cardExpiryValid,
  cardCvvValid,
  type Step3Props,
} from "./types"

export function Step3Payment({ state, set, markTouched, touched, selectedService }: Step3Props) {
  const amount = (selectedService?.basePrice ?? 0) * (state.quantity || 1)
  const fees = 0
  const total = amount + fees
  const [paid, setPaid] = React.useState(false)

  const fieldOk = (field: string, valid: boolean) => {
    if (!touched.has(field)) return null
    return valid
  }

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Wallet}
        title="Forma de pagamento"
        description="Escolha como pagar pelo serviço."
      />

      <InfoCard>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {selectedService?.title} × {state.quantity}
          </span>
          <span className="font-medium">{formatBRL(amount)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Taxa de serviço</span>
          <span className="font-medium">{formatBRL(fees)}</span>
        </div>
        <Separator className="my-1.5" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Total</span>
          <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
            {formatBRL(total)}
          </span>
        </div>
      </InfoCard>

      <div>
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">Forma de pagamento</p>
        <RadioGroup
          value={state.paymentMethod}
          onValueChange={(v) => set("paymentMethod", v as "CARD" | "PIX")}
          className="grid grid-cols-2 gap-2"
        >
          <PaymentOption
            value="PIX"
            title="PIX"
            description="Aprovação imediata"
            icon={QrCode}
            selected={state.paymentMethod === "PIX"}
          />
          <PaymentOption
            value="CARD"
            title="Cartão"
            description="Crédito"
            icon={CreditCard}
            selected={state.paymentMethod === "CARD"}
          />
        </RadioGroup>
      </div>

      {state.paymentMethod === "CARD" ? (
        <div className="bg-card grid gap-2.5 rounded-lg border px-3 py-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Dados do cartão</p>
            <Badge
              variant="outline"
              className="h-5 border-amber-400 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-600 dark:text-amber-400"
            >
              Demonstração
            </Badge>
          </div>

          <div className="grid gap-0.5">
            <Label htmlFor="cardName" className="text-xs">
              Nome impresso
            </Label>
            <div className="relative">
              <Input
                id="cardName"
                placeholder="NOME NO CARTÃO"
                value={state.cardName}
                onChange={(e) => set("cardName", e.target.value.toUpperCase())}
                onBlur={() => markTouched("cardName")}
                className={cn(
                  "h-8 pr-7 text-sm",
                  fieldOk("cardName", cardNameValid(state.cardName)) === false &&
                    "border-destructive",
                )}
              />
              {fieldOk("cardName", cardNameValid(state.cardName)) && (
                <CheckCircle2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-emerald-600" />
              )}
            </div>
          </div>

          <div className="grid gap-0.5">
            <Label htmlFor="cardNumber" className="text-xs">
              Número
            </Label>
            <div className="relative">
              <Input
                id="cardNumber"
                inputMode="numeric"
                placeholder="0000 0000 0000 0000"
                value={state.cardNumber}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 16)
                  const parts = digits.match(/.{1,4}/g)
                  set("cardNumber", parts ? parts.join(" ") : "")
                }}
                onBlur={() => markTouched("cardNumber")}
                className={cn(
                  "h-8 pr-7 text-sm",
                  fieldOk("cardNumber", cardNumberValid(state.cardNumber)) === false &&
                    "border-destructive",
                )}
              />
              {fieldOk("cardNumber", cardNumberValid(state.cardNumber)) && (
                <CheckCircle2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-emerald-600" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-0.5">
              <Label htmlFor="cardExpiry" className="text-xs">
                Validade
              </Label>
              <div className="relative">
                <Input
                  id="cardExpiry"
                  inputMode="numeric"
                  placeholder="MM/AA"
                  maxLength={5}
                  value={state.cardExpiry}
                  onChange={(e) => {
                    let v = e.target.value.replace(/\D/g, "").slice(0, 4)
                    if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`
                    set("cardExpiry", v)
                  }}
                  onBlur={() => markTouched("cardExpiry")}
                  className={cn(
                    "h-8 pr-7 text-sm",
                    fieldOk("cardExpiry", cardExpiryValid(state.cardExpiry)) === false &&
                      "border-destructive",
                  )}
                />
                {fieldOk("cardExpiry", cardExpiryValid(state.cardExpiry)) && (
                  <CheckCircle2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-emerald-600" />
                )}
              </div>
            </div>
            <div className="grid gap-0.5">
              <Label htmlFor="cardCvv" className="text-xs">
                CVV
              </Label>
              <div className="relative">
                <Input
                  id="cardCvv"
                  inputMode="numeric"
                  placeholder="123"
                  maxLength={4}
                  value={state.cardCvv}
                  onChange={(e) => set("cardCvv", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onBlur={() => markTouched("cardCvv")}
                  className={cn(
                    "h-8 pr-7 text-sm",
                    fieldOk("cardCvv", cardCvvValid(state.cardCvv)) === false &&
                      "border-destructive",
                  )}
                />
                {fieldOk("cardCvv", cardCvvValid(state.cardCvv)) && (
                  <CheckCircle2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-emerald-600" />
                )}
              </div>
            </div>
          </div>

          <p className="text-muted-foreground flex items-start gap-1 text-[11px]">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
            Ambiente de demonstração — não use dados reais.
          </p>
        </div>
      ) : (
        <div className="bg-card space-y-3 rounded-xl border p-4 shadow-xs">
          {/* Escrow Guarantee Trust Banner */}
          <div className="flex items-start gap-3 rounded-xl border border-emerald-300/60 bg-emerald-50/80 p-3.5 dark:border-emerald-800/50 dark:bg-emerald-950/40">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-emerald-950 dark:text-emerald-100">
                  Custódia PIX Protegida
                </span>
                <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  Garantia 90 Dias
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-300/80">
                O valor fica 100% protegido e só é liberado ao profissional após a conclusão do
                serviço aprovada por você.
              </p>
            </div>
          </div>

          {/* QR Code Presentation */}
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/30 py-4 dark:border-emerald-800/40 dark:bg-emerald-950/10">
            <div className="rounded-2xl border-2 border-emerald-100 bg-white p-3 shadow-xs dark:border-emerald-900/40 dark:bg-slate-900">
              <QrCode className="size-28 text-emerald-700 dark:text-emerald-400" />
            </div>

            <div className="space-y-0.5 text-center">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Pague com qualquer app de banco
              </p>
              <p className="text-muted-foreground text-[11px]">
                Escaneie o QR Code ou copie o código PIX Copia e Cola
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-8 gap-1.5 text-xs font-semibold text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              onClick={() => {
                navigator.clipboard
                  .writeText(
                    "00020126580014br.gov.bcb.pix0136severinno@exemplo.com5204000053039865802BR",
                  )
                  .catch((err) => {
                    console.warn("[booking-modal] clipboard copy failed:", err)
                  })
                toast.success("Código PIX Copia e Cola copiado com sucesso!")
              }}
            >
              <Copy className="size-3.5" />
              Copiar código PIX
            </Button>
          </div>

          <Button
            type="button"
            className={cn(
              "h-10 w-full gap-2 font-semibold transition-all",
              paid
                ? "bg-emerald-600 text-white hover:bg-emerald-600"
                : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-98",
            )}
            onClick={() => {
              setPaid(true)
              toast.success("Pagamento confirmado via PIX! Pode concluir o agendamento.")
            }}
            disabled={paid}
          >
            {paid ? (
              <>
                <CheckCircle2 className="size-4" /> Pagamento confirmado na custódia
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Já realizei o pagamento PIX
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
