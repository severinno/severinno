"use client"

import * as React from "react"
import { ShieldCheck, Lock, CheckCircle2, ChevronRight, HelpCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface EscrowPopoverProps {
  className?: string
  align?: "start" | "center" | "end"
  side?: "top" | "bottom" | "left" | "right"
  children?: React.ReactNode
}

export function EscrowPopover({
  className,
  align = "start",
  side = "top",
  children,
}: EscrowPopoverProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
            className={cn(
              "group inline-flex cursor-pointer items-center gap-1 transition-opacity hover:opacity-90",
              className,
            )}
            aria-label="Ver detalhes da garantia Escrow PIX e 90 dias"
          >
            {children}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
            className={cn(
              "group inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-emerald-700 transition-colors hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300",
              className,
            )}
            aria-label="Como funciona o Escrow PIX"
          >
            <ShieldCheck className="size-3.5 text-emerald-600/90" />
            <span>Escrow PIX</span>
            <span>·</span>
            <span>Garantia 90d</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        className="bg-background/98 z-50 w-80 rounded-2xl border border-emerald-500/20 p-4 shadow-xl backdrop-blur-md"
      >
        <div className="border-border/50 flex items-center gap-2 border-b pb-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <h4 className="text-foreground text-xs font-bold">Custódia Segura PIX</h4>
            <p className="text-muted-foreground text-[10px]">Proteção total do seu pagamento</p>
          </div>
        </div>

        <div className="mt-3 space-y-2.5 text-xs">
          <div className="flex items-start gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800">
              1
            </span>
            <div className="min-w-0">
              <p className="text-foreground font-semibold">Você paga via PIX protegido</p>
              <p className="text-muted-foreground text-[11px] leading-tight">
                O valor fica retido na conta de custódia oficial — o prestador NÃO recebe adiantado.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800">
              2
            </span>
            <div className="min-w-0">
              <p className="text-foreground font-semibold">O serviço é executado</p>
              <p className="text-muted-foreground text-[11px] leading-tight">
                Profissional atende no endereço com cobertura e garantia legal de 90 dias.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800">
              3
            </span>
            <div className="min-w-0">
              <p className="text-foreground font-semibold">Você libera em 1-clique</p>
              <p className="text-muted-foreground text-[11px] leading-tight">
                Após conferir o trabalho, autorize a liberação instantânea pelo WhatsApp ou App.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3.5 rounded-xl border border-emerald-500/15 bg-emerald-50/60 p-2 text-center text-[10px] text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          🛡️ Reembolso integral em caso de não comparecimento · Mediação Severinno GV
        </div>
      </PopoverContent>
    </Popover>
  )
}
export default EscrowPopover
