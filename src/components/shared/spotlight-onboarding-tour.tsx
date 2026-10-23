"use client"

/**
 * SpotlightOnboardingTour — Tour Guiado Interativo de Primeiro Acesso.
 *
 * Apresenta em 3 passos concisos as principais inovações do Severinno:
 * 1. Central de Comando & Acesso Rápido
 * 2. Inteligência Regional de Governador Valadares
 * 3. Proteção Escrow & Garantia de 90 Dias
 */

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Check, Compass, ShieldCheck, Sparkles, X, Zap } from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"
import { Button } from "@/components/ui/button"

export interface TourStep {
  title: string
  subtitle: string
  description: string
  badge: string
  icon: React.ComponentType<{ className?: string }>
  highlight: string
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Central de Comando & Acesso Rápido",
    subtitle: "Tudo ao alcance de 1 clique",
    description:
      "Acesse instantaneamente todos os recursos essenciais através dos novos cards inteligentes de atalho no topo do seu painel.",
    badge: "Produtividade",
    icon: Zap,
    highlight: "Navegação ágil com suporte a atalhos rápidos e feedback tátil.",
  },
  {
    title: "Cobertura & Inteligência Regional GV",
    subtitle: "20 bairros atendidos com rotas otimizadas",
    description:
      "Nossa tecnologia mapeia a demanda em tempo real em Governador Valadares, reduzindo o tempo de trânsito e aproximando prestadores e clientes.",
    badge: "Governador Valadares",
    icon: Compass,
    highlight: "Geofencing automático com raio de precisão e cálculo de deslocamento.",
  },
  {
    title: "Custódia Escrow & Garantia de 90 Dias",
    subtitle: "Seu dinheiro e serviço 100% protegidos",
    description:
      "O pagamento via PIX fica retido em custódia segura até que o cliente confirme a conclusão do serviço, com cobertura total de 90 dias.",
    badge: "Segurança Total",
    icon: ShieldCheck,
    highlight: "Liberação instantânea com garantia contra defeitos ou disputas.",
  },
]

interface SpotlightOnboardingTourProps {
  open: boolean
  onClose: () => void
  role?: string
}

export function SpotlightOnboardingTour({
  open,
  onClose,
  role = "user",
}: SpotlightOnboardingTourProps) {
  const [currentStep, setCurrentStep] = React.useState(0)
  const storageKey = `sev_tour_seen_${role.toLowerCase()}`

  const markTourCompleted = React.useCallback(() => {
    try {
      localStorage.setItem(storageKey, "true")
    } catch {}
  }, [storageKey])

  const handleNext = () => {
    triggerHaptic("selection")
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      triggerHaptic("success")
      try {
        playCoinSound({ vibrate: true })
      } catch {}
      markTourCompleted()
      onClose()
      setCurrentStep(0)
    }
  }

  const handlePrev = () => {
    triggerHaptic("selection")
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  const handleSkip = () => {
    triggerHaptic("selection")
    markTourCompleted()
    onClose()
    setCurrentStep(0)
  }

  if (!open) return null

  const step = TOUR_STEPS[currentStep]
  const Icon = step.icon
  const isLast = currentStep === TOUR_STEPS.length - 1

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tour guiado do sistema"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.2 }}
          className="border-border/80 bg-card relative w-full max-w-md overflow-hidden rounded-2xl border p-6 shadow-2xl"
        >
          {/* Header & Close */}
          <div className="flex items-center justify-between pb-3">
            <span className="border-primary/25 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              <Sparkles className="size-3" />
              <span>{step.badge}</span>
            </span>
            <button
              type="button"
              onClick={handleSkip}
              aria-label="Fechar tour"
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-1 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Animated Card Body */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-3.5">
              <div className="bg-primary text-primary-foreground shadow-primary/25 flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-md">
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-foreground text-base font-bold tracking-tight">{step.title}</h3>
                <p className="text-muted-foreground text-xs">{step.subtitle}</p>
              </div>
            </div>

            <p className="text-foreground/90 text-xs leading-relaxed">{step.description}</p>

            <div className="border-primary/20 bg-primary/5 text-primary rounded-xl border p-3 text-xs leading-snug font-medium">
              💡 {step.highlight}
            </div>

            {/* Stepper Dots */}
            <div className="flex items-center justify-center gap-1.5 pt-2">
              {TOUR_STEPS.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentStep(idx)}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === currentStep ? "bg-primary w-6" : "bg-muted-foreground/30 w-1.5"
                  }`}
                  aria-label={`Ir para passo ${idx + 1}`}
                />
              ))}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between gap-3 pt-2">
              {currentStep > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  className="h-8.5 rounded-xl px-3 text-xs"
                >
                  Voltar
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="text-muted-foreground hover:text-foreground h-8.5 rounded-xl px-3 text-xs"
                >
                  Pular tour
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                onClick={handleNext}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-8.5 gap-1.5 rounded-xl px-4 text-xs font-bold shadow-xs active:scale-95"
              >
                {isLast ? (
                  <>
                    <Check className="size-3.5" /> Concluir
                  </>
                ) : (
                  <>
                    Próximo <ArrowRight className="size-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
