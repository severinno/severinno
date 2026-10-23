"use client"

/**
 * SmartConsentCard / CookieConsent — Solução unificada e amigável para
 * permissão de localização (GPS) e consentimento de cookies (LGPD).
 *
 * Utiliza o padrão moderno "Permission Primer" (Soft Ask) com Floating Glass Card,
 * evitando o bloqueio agressivo do navegador e garantindo alta taxa de conversão
 * com copywriting acolhedor e direto focado em Governador Valadares.
 *
 * Heurísticas de Nielsen aplicadas:
 *   H1  Visibilidade do status do sistema  → Feedback imediato ao autorizar/recusar
 *   H2  Linguagem do mundo real           → Copywriting natural, sem juridiquês
 *   H3  Controle e liberdade              → Opções claras de aceitar, "Agora não" ou dispensar
 *   H5  Prevenção de erros                → Delay inicial de 2.5s para não interromper carregamento
 *   H8  Design estético e minimalista     → Floating glass card compacto com micro-blur
 */

import * as React from "react"
import { MapPin, ShieldCheck, X, Lock, Check } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useGeoStore } from "@/store/geo"

type ConsentState = "accepted" | "dismissed" | null

export function CookieConsent() {
  const [visible, setVisible] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const setFromGPS = useGeoStore((s) => s.setFromGPS)

  React.useEffect(() => {
    // Verifica se o usuário já fez sua escolha previamente
    try {
      const consent = localStorage.getItem("severinno:cookie-consent") as ConsentState
      if (!consent) {
        // Exibe o card após um delay amigável para não interromper a primeira impressão visual
        const timer = setTimeout(() => setVisible(true), 2500)
        return () => clearTimeout(timer)
      }
    } catch {
      // Ignora erro em ambientes sem localStorage disponível
    }
  }, [])

  const handleAllowAll = async () => {
    try {
      localStorage.setItem("severinno:cookie-consent", "accepted")
    } catch {
      // Fallback
    }

    setVisible(false)
    setDismissed(true)

    // Aciona a localização de forma natural e suave (o usuário clicou com intenção)
    try {
      await setFromGPS()
      toast.success("Localização e preferências ativadas com sucesso!")
    } catch {
      // Falha silenciosa de GPS ou recusa no prompt nativo
    }
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem("severinno:cookie-consent", "dismissed")
    } catch {
      // Fallback
    }
    setVisible(false)
    setDismissed(true)
  }

  if (dismissed) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          role="region"
          aria-label="Preferências de localização e privacidade"
          initial={{ y: 24, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 350, damping: 28 }}
          className="border-border/70 bg-background/95 dark:bg-card/95 fixed right-4 bottom-4 left-4 z-50 mx-auto max-w-md rounded-2xl border p-4 shadow-xl backdrop-blur-xl sm:right-6 sm:bottom-6 sm:left-auto sm:mx-0 sm:max-w-[400px]"
        >
          {/* Top header row: ícone + título + botão fechar */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
                <MapPin className="size-4.5" />
              </div>
              <div>
                <h3 className="text-foreground text-sm font-semibold tracking-tight">
                  Serviços perto de você em Valadares
                </h3>
                <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-medium">
                  <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                  Experiência local segura
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              className="text-muted-foreground hover:bg-muted hover:text-foreground -mt-1 -mr-1 rounded-lg p-1.5 transition-colors"
              aria-label="Dispensar aviso"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Copywriting direto, sutil e acolhedor (Opção B) */}
          <p className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
            Usamos sua localização para calcular distâncias reais de chegada e cookies essenciais
            para manter sua navegação rápida e segura.
          </p>

          {/* Micro-nota de privacidade LGPD */}
          <div className="text-muted-foreground/80 mt-2.5 flex items-center gap-1.5 text-[10px]">
            <Lock className="text-muted-foreground size-3 shrink-0" />
            <span>Seus dados são protegidos pela LGPD e nunca compartilhados.</span>
          </div>

          {/* Botões de ação — Alto nível de usabilidade */}
          <div className="border-border/40 mt-3.5 flex items-center justify-end gap-2 border-t pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground h-8 rounded-xl px-3 text-xs"
            >
              Agora não
            </Button>

            <Button
              size="sm"
              onClick={handleAllowAll}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-xs"
            >
              <Check className="size-3.5" />
              Permitir e continuar
            </Button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export default CookieConsent
