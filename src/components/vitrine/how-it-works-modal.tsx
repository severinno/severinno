import { SUPPORT_WHATSAPP } from "@/lib/constants"
;("use client")

import * as React from "react"
import {
  X,
  Search,
  Clock,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  MessageCircle,
  Play,
  Award,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface HowItWorksModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExploreServices?: () => void
}

interface StepItem {
  number: string
  title: string
  subtitle: string
  description: string
  duration: string
  icon: React.ComponentType<{ className?: string }>
  badgeText: string
  points: string[]
}

const STEPS: StepItem[] = [
  {
    number: "01",
    title: "Escolha o Serviço ou Profissional",
    subtitle: "Antecedentes criminais checados e avaliações reais",
    description:
      "Navegue pelas categorias, veja fotos de serviços reais concluídos no seu bairro e consulte a nota de quem já contratou.",
    duration: "10 seg",
    icon: Search,
    badgeText: "100% Verificados",
    points: [
      "Documentos e CPF/CNPJ validados",
      "Antecedentes criminais conferidos",
      "Fotos e laudos de serviços anteriores",
    ],
  },
  {
    number: "02",
    title: "Atendimento Pontual na Sua Casa",
    subtitle: "Preço justo combinado antes de começar",
    description:
      "O profissional chega no horário combinado. Se precisar de peças ou orçamento detalhado, tudo é aprovado por você antes.",
    duration: "15 seg",
    icon: Clock,
    badgeText: "Sem Surpresas",
    points: [
      "Rastreamento de chegada em tempo real",
      "Orçamento transparente sem taxas ocultas",
      "Chat seguro integrado e WhatsApp oficial",
    ],
  },
  {
    number: "03",
    title: "Pagamento 100% Blindado em Custódia",
    subtitle: "Risco ZERO: o prestador só recebe após o seu OK",
    description:
      "Seu dinheiro não vai direto para a conta do prestador. Ele fica protegido na Severinno e só é liberado depois que você conferir o serviço pronto.",
    duration: "10 seg",
    icon: ShieldCheck,
    badgeText: "Garantia Escrow",
    points: [
      "R$ 0 adiantado para desconhecidos",
      "Liberação do valor somente após sua aprovação",
      "Parcelamento no cartão ou Pix seguro",
    ],
  },
  {
    number: "04",
    title: "Garantia de 90 Dias & Suporte Severinno",
    subtitle: "Sua casa e seu bolso totalmente protegidos",
    description:
      "Qualquer imprevisto com o reparo em até 90 dias é resolvido sem custo adicional com nosso suporte prioritário.",
    duration: "5 seg",
    icon: Award,
    badgeText: "90 Dias de Garantia",
    points: [
      "Retorno gratuito se o problema persistir",
      "Proteção e seguro contra imprevistos",
      "Nota fiscal e recibo simplificado",
    ],
  },
]

export function HowItWorksModal({ open, onOpenChange, onExploreServices }: HowItWorksModalProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"
  const [activeStep, setActiveStep] = React.useState<number>(0)

  if (!open) return null

  const current = STEPS[activeStep] || STEPS[0]
  const Icon = current.icon

  const handleNext = () => {
    if (activeStep < STEPS.length - 1) {
      setActiveStep(activeStep + 1)
    } else {
      onOpenChange(false)
      onExploreServices?.()
    }
  }

  const handlePrev = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1)
    }
  }

  const defaultWhatsappMsg = encodeURIComponent(
    `Olá Severinno! Vi a explicação de como funciona a plataforma em ${city} e quero contratar um serviço com pagamento protegido. Como faço?`,
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-it-works-title"
      className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm duration-200"
    >
      <div className="border-border bg-card animate-in zoom-in-95 relative w-full max-w-2xl rounded-2xl border p-6 shadow-2xl duration-200 sm:p-8">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Fechar guia de como funciona"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-primary absolute top-4 right-4 rounded-full p-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-5" />
        </button>

        {/* Header do Modal */}
        <div className="flex items-center gap-2.5">
          <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
            <Play className="fill-primary size-4" />
          </span>
          <div>
            <div className="text-primary inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <Sparkles className="size-3" />
              <span>Entenda em 40 Segundos</span>
            </div>
            <h2
              id="how-it-works-title"
              className="text-foreground text-xl font-bold tracking-tight sm:text-2xl"
            >
              Como a Severinno protege você em {city}
            </h2>
          </div>
        </div>

        {/* Barra de Progresso dos 4 Passos */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          {STEPS.map((step, idx) => (
            <button
              key={step.number}
              type="button"
              onClick={() => setActiveStep(idx)}
              className="group flex flex-col items-start text-left focus-visible:outline-none"
            >
              <div
                className={cn(
                  "h-1.5 w-full rounded-full transition-all duration-300",
                  idx === activeStep
                    ? "bg-primary"
                    : idx < activeStep
                      ? "bg-emerald-600 dark:bg-emerald-400"
                      : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "mt-2 text-[11px] font-semibold transition-colors sm:text-xs",
                  idx === activeStep ? "text-primary font-bold" : "text-muted-foreground",
                )}
              >
                Passo {step.number}
              </span>
            </button>
          ))}
        </div>

        {/* Card do Passo Ativo */}
        <div className="border-primary/20 bg-primary/5 mt-6 rounded-2xl border p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-md">
                <Icon className="size-6" />
              </span>
              <div>
                <span className="border-primary/20 bg-background text-primary inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold">
                  {current.badgeText} • {current.duration}
                </span>
                <h3 className="text-foreground mt-1 text-base font-bold sm:text-lg">
                  {current.title}
                </h3>
                <p className="text-muted-foreground text-xs sm:text-sm">{current.subtitle}</p>
              </div>
            </div>
          </div>

          <p className="text-foreground/90 mt-3 text-xs leading-relaxed sm:text-sm">
            {current.description}
          </p>

          <div className="border-primary/10 mt-4 border-t pt-3">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {current.points.map((pt, i) => (
                <li
                  key={i}
                  className="text-foreground/80 flex items-center gap-2 text-xs font-medium"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Controles de Navegação e CTAs */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {activeStep > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl border px-4 py-2.5 text-xs font-semibold"
              >
                ← Anterior
              </button>
            )}
            <span className="text-muted-foreground text-xs">
              Passo {activeStep + 1} de {STEPS.length}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${defaultWhatsappMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              <MessageCircle className="size-3.5" />
              <span>Dúvidas no WhatsApp</span>
            </a>

            <button
              type="button"
              onClick={handleNext}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold shadow-sm transition-all active:scale-[0.98]"
            >
              <span>
                {activeStep === STEPS.length - 1 ? "Buscar Profissionais Agora" : "Próximo Passo"}
              </span>
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
