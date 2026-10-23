"use client"

import * as React from "react"
import { SUPPORT_WHATSAPP } from "@/lib/constants"
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Zap,
  Droplets,
  Wind,
  Home,
  MessageCircle,
} from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export type QuestionOption = {
  id: string
  label: string
  sublabel: string
  points: number
  isRisk?: boolean
}

export type QuizQuestion = {
  id: string
  category: string
  pillar: "eletrica" | "hidraulica" | "ar" | "estrutura"
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  options: QuestionOption[]
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "eletrica",
    category: "Elétrica & Segurança",
    pillar: "eletrica",
    icon: Zap,
    title: "Qual o estado da instalação elétrica e disjuntores da sua casa?",
    subtitle:
      "A maioria dos incêndios e queima de aparelhos começa em tomadas e disjuntores antigos.",
    options: [
      {
        id: "eletrica-otimo",
        label: "Quadro novo com disjuntores DIN e fiação revisada",
        sublabel: "Proteção contra surtos e sem aquecimento",
        points: 25,
      },
      {
        id: "eletrica-medio",
        label: "Mais de 4 anos sem revisão, mas raramente desarma",
        sublabel: "Fiação antiga sem verificação recente de aperto",
        points: 15,
      },
      {
        id: "eletrica-risco",
        label: "Disjuntor chia/aquece ou chuveiro queima com frequência",
        sublabel: "Risco iminente de curto-circuito ou sobrecarga",
        points: 0,
        isRisk: true,
      },
    ],
  },
  {
    id: "hidraulica",
    category: "Hidráulica & Água",
    pillar: "hidraulica",
    icon: Droplets,
    title: "Quando foi feita a última checagem de vazamentos e caixa d'água?",
    subtitle: "Pequenos gotejamentos silenciosos encarecem a conta da SAAE em até 40%.",
    options: [
      {
        id: "hidro-otimo",
        label: "Limpeza de caixa e inspeção nos últimos 6 meses",
        sublabel: "Torneiras firmes e vasos sem vazamento na válvula",
        points: 25,
      },
      {
        id: "hidro-medio",
        label: "Entre 6 meses e 1 ano sem revisão completa",
        sublabel: "Sem vazamento aparente, mas caixa d'água sem lavar",
        points: 15,
      },
      {
        id: "hidro-risco",
        label: "Mais de 1 ano ou barulho contínuo de água escorrendo",
        sublabel: "Possível vazamento subterrâneo ou desperdício contínuo",
        points: 0,
        isRisk: true,
      },
    ],
  },
  {
    id: "ar",
    category: "Climatização & Ar-Condicionado",
    pillar: "ar",
    icon: Wind,
    title: "O ar-condicionado ou ventiladores já passaram por higienização química?",
    subtitle: "Aparelhos sujos acumulam fungos respiratórios e gastam muito mais energia.",
    options: [
      {
        id: "ar-otimo",
        label: "Higienização profunda nos últimos 4 meses",
        sublabel: "Serpentina desbacterizada e gás medido",
        points: 25,
      },
      {
        id: "ar-medio",
        label: "Limpo apenas o filtro de tela por conta própria",
        sublabel: "Turbina interna e serpentina nunca foram desmontadas",
        points: 15,
      },
      {
        id: "ar-risco",
        label: "Nunca fiz limpeza profunda / pinga água ou tem cheiro de mofo",
        sublabel: "Ar forçando compressor e consumindo energia em excesso",
        points: 0,
        isRisk: true,
      },
    ],
  },
  {
    id: "estrutura",
    category: "Estrutura & Portas",
    pillar: "estrutura",
    icon: Home,
    title: "Como estão as fechaduras, portas, janelas e pintura das paredes?",
    subtitle: "Acabamentos preservados protegem contra umidade, cupins e travamentos inesperados.",
    options: [
      {
        id: "est-otimo",
        label: "Tudo regulado, fechaduras suaves e paredes sem mofo",
        sublabel: "Pintura conservada e trincos alinhados",
        points: 25,
      },
      {
        id: "est-medio",
        label: "Pequenos descascados ou porta arrastando de leve",
        sublabel: "Manutenção estética simples pendente",
        points: 15,
      },
      {
        id: "est-risco",
        label: "Manchas de umidade, trincos duros ou fechadura travando",
        sublabel: "Risco de infiltração na alvenaria ou ficar trancado para fora",
        points: 0,
        isRisk: true,
      },
    ],
  },
]

export type HomeHealthScoreQuizProps = {
  onScheduleCheckup?: (recommendation: string) => void
  className?: string
}

export function HomeHealthScoreQuiz({ onScheduleCheckup, className }: HomeHealthScoreQuizProps) {
  const [currentStep, setCurrentStep] = React.useState<number>(0)
  const [answers, setAnswers] = React.useState<Record<string, QuestionOption>>({})
  const [isCompleted, setIsCompleted] = React.useState<boolean>(false)

  const currentQuestion = QUIZ_QUESTIONS[currentStep]

  const handleSelectOption = (option: QuestionOption) => {
    const updatedAnswers = { ...answers, [currentQuestion.id]: option }
    setAnswers(updatedAnswers)

    if (currentStep < QUIZ_QUESTIONS.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      setIsCompleted(true)
    }
  }

  const handleReset = () => {
    setAnswers({})
    setCurrentStep(0)
    setIsCompleted(false)
  }

  // Calculate score
  const totalScore = React.useMemo(() => {
    return Object.values(answers).reduce((acc, curr) => acc + curr.points, 0)
  }, [answers])

  // Critical alerts list
  const criticalPoints = React.useMemo(() => {
    return Object.entries(answers)
      .filter(([_, opt]) => opt.isRisk)
      .map(([qId]) => QUIZ_QUESTIONS.find((q) => q.id === qId)?.category)
      .filter((cat): cat is string => Boolean(cat))
  }, [answers])

  const scoreTier = React.useMemo(() => {
    if (totalScore >= 85) {
      return {
        label: "Casa Blindada & Protegida",
        badge: "Excelente (85-100)",
        color: "text-emerald-700 dark:text-emerald-400",
        bgColor: "bg-emerald-500/15 border-emerald-500/30",
        ringColor: "ring-emerald-500/30",
        gaugeColor: "#10b981",
        description:
          "Parabéns! Sua residência está em ótimo estado de conservação. Mantenha apenas o check-up preventivo periódico.",
      }
    }
    if (totalScore >= 55) {
      return {
        label: "Atenção Recomendada",
        badge: "Risco Moderado (55-84)",
        color: "text-amber-700 dark:text-amber-400",
        bgColor: "bg-amber-500/15 border-amber-500/30",
        ringColor: "ring-amber-500/30",
        gaugeColor: "#f59e0b",
        description:
          "Sua casa tem itens com desgaste acumulado que podem gerar contas mais altas de água/luz ou quebras inesperadas em breve.",
      }
    }
    return {
      label: "Alerta Vermelho de Prejuízo",
      badge: "Risco Alto (0-54)",
      color: "text-rose-700 dark:text-rose-400",
      bgColor: "bg-rose-500/15 border-rose-500/30",
      ringColor: "ring-rose-500/30",
      gaugeColor: "#f43f5e",
      description:
        "Atenção urgente! Há riscos iminentes de curto-circuito, queima de aparelhos ou vazamentos silenciosos. Recomendamos um check-up imediato.",
    }
  }, [totalScore])

  const handleWhatsAppShare = () => {
    const text = `Fiz o Diagnóstico da minha casa na Severinno em Governador Valadares!\n*Score de Saúde da Residência:* ${totalScore}/100 (${scoreTier.label}).\n${
      criticalPoints.length > 0
        ? `Pontos de atenção identificados: ${criticalPoints.join(", ")}.`
        : "Casa em ótimo estado de manutenção preventiva!"
    }\nQuero solicitar um check-up com garantia de custódia.`
    const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <section
      className={cn("bg-muted/15 border-border/60 relative border-y py-12 sm:py-16", className)}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Banner Tag */}
        <div className="mb-8 text-center">
          <Badge
            variant="outline"
            className="mb-3 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-300"
          >
            <Activity className="size-3.5 animate-pulse text-emerald-600" />
            <span>Diagnóstico Rápido de Saúde da Casa</span>
          </Badge>
          <h2 className="text-foreground text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">
            Qual é o Score de Segurança da Sua Residência?
          </h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-sm sm:text-base">
            Responda 4 perguntas simples em 40 segundos e descubra se sua casa tem riscos ocultos de
            vazamento, curto-circuito ou quebra de aparelhos.
          </p>
        </div>

        {/* Card Main */}
        <div className="bg-card border-border/80 relative overflow-hidden rounded-3xl border p-6 shadow-xl backdrop-blur-md sm:p-10">
          {!isCompleted ? (
            <div>
              {/* Progress Bar & Counter */}
              <div className="mb-6">
                <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-bold">
                  <span className="text-primary flex items-center gap-1.5">
                    <Sparkles className="size-3.5" />
                    Etapa {currentStep + 1} de {QUIZ_QUESTIONS.length}
                  </span>
                  <span>
                    {Math.round(((currentStep + 1) / QUIZ_QUESTIONS.length) * 100)}% concluído
                  </span>
                </div>
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                  <motion.div
                    className="h-full bg-emerald-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentStep + 1) / QUIZ_QUESTIONS.length) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>

              {/* Question Header */}
              <div className="mb-6">
                <div className="bg-primary/10 text-primary mb-3 inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-bold">
                  <currentQuestion.icon className="size-3.5" />
                  <span>{currentQuestion.category}</span>
                </div>
                <h3 className="text-foreground text-lg font-bold sm:text-2xl">
                  {currentQuestion.title}
                </h3>
                <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                  {currentQuestion.subtitle}
                </p>
              </div>

              {/* Options */}
              <div className="space-y-3">
                {currentQuestion.options.map((option) => {
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleSelectOption(option)}
                      className={cn(
                        "group flex w-full cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 text-left transition-all sm:p-5",
                        "border-border/80 bg-background hover:border-primary/60 hover:bg-muted/40 hover:shadow-md",
                      )}
                    >
                      <div>
                        <p className="text-foreground group-hover:text-primary text-sm font-bold transition-colors">
                          {option.label}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">{option.sublabel}</p>
                      </div>
                      <span className="border-border group-hover:border-primary group-hover:bg-primary text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all group-hover:text-white">
                        →
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            /* Results Screen */
            <div className="py-2">
              <div className="mx-auto max-w-xl text-center">
                <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="size-4" />
                  Diagnóstico Concluído
                </span>

                <h3 className="text-foreground text-2xl font-extrabold sm:text-3xl">
                  Score de Saúde da Residência
                </h3>

                {/* Score Gauge Visual */}
                <div className="my-6 flex flex-col items-center justify-center">
                  <div
                    className={cn(
                      "flex size-36 flex-col items-center justify-center rounded-full border-4 shadow-lg ring-8 transition-all sm:size-44",
                      scoreTier.bgColor,
                      scoreTier.ringColor,
                    )}
                  >
                    <span className="text-foreground text-4xl font-black tracking-tight sm:text-5xl">
                      {totalScore}
                    </span>
                    <span className="text-muted-foreground mt-0.5 text-[11px] font-bold tracking-widest uppercase sm:text-xs">
                      de 100 pontos
                    </span>
                  </div>

                  <div className="mt-4">
                    <span className={cn("text-base font-black sm:text-lg", scoreTier.color)}>
                      {scoreTier.label}
                    </span>
                    <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs leading-relaxed sm:text-sm">
                      {scoreTier.description}
                    </p>
                  </div>
                </div>

                {/* Critical Pillars Identified */}
                {criticalPoints.length > 0 && (
                  <div className="mb-6 rounded-2xl border border-rose-300 bg-rose-50/50 p-4 text-left dark:border-rose-950 dark:bg-rose-950/20">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-rose-800 dark:text-rose-300">
                      <AlertTriangle className="size-4 shrink-0 text-rose-600" />
                      <span>Atenção prioritária requerida nestes setores:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {criticalPoints.map((cat) => (
                        <span
                          key={cat}
                          className="rounded-lg bg-rose-600/15 px-2.5 py-1 text-xs font-bold text-rose-800 dark:text-rose-200"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action CTAs */}
                <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Button
                    onClick={() => {
                      if (onScheduleCheckup) {
                        onScheduleCheckup(criticalPoints[0] || "Check-up da Casa")
                      }
                    }}
                    className="w-full cursor-pointer gap-2 bg-emerald-600 font-bold text-white shadow-md hover:bg-emerald-700 sm:w-auto"
                  >
                    <CheckCircle2 className="size-4" />
                    <span>Agendar Check-up Preventivo da Casa</span>
                    <ArrowRight className="size-4" />
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleWhatsAppShare}
                    className="w-full cursor-pointer gap-2 font-bold sm:w-auto"
                  >
                    <MessageCircle className="size-4 text-emerald-600" />
                    <span>Salvar Laudo no WhatsApp</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleReset}
                    title="Refazer Diagnóstico"
                    aria-label="Refazer Diagnóstico"
                    className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default HomeHealthScoreQuiz
