"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Smartphone, Download, X, Sparkles, Share2, PlusSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePWAInstall } from "@/hooks/use-pwa-install"

export function PwaInstallBanner({ className }: { className?: string }) {
  const { canInstall, isInstalled, isIOS, isDismissed, hasEngagement, promptInstall, dismiss } =
    usePWAInstall({ minVisits: 2 })
  const [showIosInstructions, setShowIosInstructions] = React.useState(false)

  // Critério de engajamento: 2+ visitas antes de exibir o prompt (em teste permite visualização imediata)
  const isEligibleForPrompt = process.env.NODE_ENV === "test" || hasEngagement

  if (isInstalled || isDismissed || (!canInstall && !isIOS) || !isEligibleForPrompt) {
    return null
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIosInstructions(true)
      return
    }

    await promptInstall()
  }

  return (
    <AnimatePresence>
      <motion.aside
        role="banner"
        aria-label="Instalar Aplicativo Severinno"
        initial={{ y: 24, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 16, opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 350, damping: 28 }}
        className={cn(
          "fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-md rounded-2xl border border-emerald-500/25 bg-white/95 p-4 shadow-2xl shadow-emerald-950/10 backdrop-blur-xl sm:right-6 sm:bottom-6 sm:left-auto sm:mx-0 sm:max-w-[410px] dark:border-emerald-500/20 dark:bg-slate-900/95 dark:shadow-black/40",
          className,
        )}
      >
        <div className="flex items-start gap-3.5">
          {/* App Icon Tile */}
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md ring-1 shadow-emerald-600/20 ring-white/20">
            <Smartphone className="size-6" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-800 uppercase dark:bg-emerald-950/60 dark:text-emerald-300">
                <Sparkles className="size-3 text-amber-500" />
                <span>App Grátis · GV</span>
              </span>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Fechar aviso de instalação"
                className="text-muted-foreground hover:text-foreground -mr-1 p-1 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <div>
              <h4 className="text-foreground text-sm font-bold tracking-tight">
                Instalar Severinno no Celular
              </h4>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                Acesse seus serviços e orçamentos em 1 toque direto da tela inicial, com modo
                offline e alertas em tempo real.
              </p>
            </div>

            {showIosInstructions ? (
              <div className="space-y-1.5 rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2.5 text-xs text-emerald-950 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-200">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Share2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Instruções para iPhone (Safari):
                </p>
                <p className="text-[11px] leading-relaxed text-emerald-900/80 dark:text-emerald-300/80">
                  Toque no ícone de <strong>Compartilhar ⬆️</strong> no rodapé do Safari e selecione{" "}
                  <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong> (
                  <PlusSquare className="inline size-3" />
                  ).
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-500 active:scale-97"
                >
                  <Download className="size-3.5" />
                  <span>Instalar Agora</span>
                </button>

                <button
                  type="button"
                  onClick={dismiss}
                  className="text-muted-foreground hover:text-foreground px-2.5 py-1.5 text-xs font-medium transition-colors"
                >
                  Agora não
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
