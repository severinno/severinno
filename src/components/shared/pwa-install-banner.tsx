"use client"

import * as React from "react"
import { Smartphone, Download, X, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePWAInstall } from "@/hooks/use-pwa-install"

export function PwaInstallBanner({ className }: { className?: string }) {
  const { canInstall, isInstalled, isIOS, isDismissed, promptInstall, dismiss } = usePWAInstall()
  const [showIosInstructions, setShowIosInstructions] = React.useState(false)

  if (isInstalled || isDismissed || (!canInstall && !isIOS)) {
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
    <div
      role="banner"
      aria-label="Instalar Aplicativo Severinno"
      className={cn(
        "bg-background/95 fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-md rounded-2xl border border-emerald-500/30 p-4 shadow-2xl backdrop-blur-md transition-all sm:right-6 sm:bottom-6 sm:left-auto",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* App Icon */}
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md">
          <Smartphone className="size-6" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-3" />
              <span>App Grátis para Celular</span>
            </span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Fechar aviso de instalação"
              className="text-muted-foreground hover:text-foreground -mr-1 p-1"
            >
              <X className="size-4" />
            </button>
          </div>

          <h4 className="text-foreground text-xs font-black sm:text-sm">
            Instalar o Severinno na sua Tela de Início
          </h4>
          <p className="text-muted-foreground text-[11px] leading-tight">
            Chame eletricista, encanador ou chaveiro em 1 toque. Funciona mesmo sem sinal de
            internet (PWA &lt; 2MB).
          </p>

          {showIosInstructions ? (
            <div className="bg-muted/60 text-foreground rounded-lg p-2 text-[11px] font-medium">
              Toque no botão de <strong>Compartilhar ⬆️</strong> no Safari e selecione{" "}
              <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>.
            </div>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleInstallClick}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-black text-white shadow-xs transition-all hover:bg-emerald-500 active:scale-95"
              >
                <Download className="size-3.5" />
                <span>Instalar Agora</span>
              </button>

              <button
                type="button"
                onClick={dismiss}
                className="text-muted-foreground hover:text-foreground px-2 py-1 text-[11px] font-semibold underline"
              >
                Depois
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
