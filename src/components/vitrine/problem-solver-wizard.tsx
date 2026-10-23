"use client"

import * as React from "react"
import { SUPPORT_WHATSAPP } from "@/lib/constants"
import {
  Zap,
  Droplets,
  Wind,
  Key,
  Hammer,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  Clock,
  CheckCircle2,
  HelpCircle,
  X,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

export interface ProblemItem {
  id: string
  title: string
  problemText: string
  categoryName: string
  searchTerm: string
  icon: React.ComponentType<{ className?: string }>
  badgeText: string
  badgeColor: string
  estimatedTime: string
  estimatedPrice: string
  solutionSummary: string
  checklist: string[]
}

const COMMON_PROBLEMS: ProblemItem[] = [
  {
    id: "prob-chuveiro",
    title: "Chuveiro Queimou",
    problemText: "Água gelada ou resistência estourada",
    categoryName: "Eletricista Residencial",
    searchTerm: "Chuveiro Elétrico",
    icon: Zap,
    badgeText: "Alta Urgência",
    badgeColor: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    estimatedTime: "Em até 35 min",
    estimatedPrice: "R$ 70 a R$ 130",
    solutionSummary:
      "Troca rápida de resistência, teste de fiação e conector cerâmico para evitar novo curto.",
    checklist: [
      "Troca de resistência e conector",
      "Teste de tensão com multímetro",
      "Sem risco de curto-circuito",
    ],
  },
  {
    id: "prob-vazamento",
    title: "Vazamento ou Cano Furado",
    problemText: "Água escorrendo na parede ou piso",
    categoryName: "Encanador & Hidráulica",
    searchTerm: "Encanador Vazamento",
    icon: Droplets,
    badgeText: "Emergência Hidráulica",
    badgeColor: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    estimatedTime: "Em até 40 min",
    estimatedPrice: "R$ 90 a R$ 160",
    solutionSummary:
      "Localização precisa do vazamento, troca de tubulação PVC/PPR e vedação profissional.",
    checklist: [
      "Estanca vazamento imediato",
      "Substituição de conexões com garantia",
      "Teste de estanqueidade",
    ],
  },
  {
    id: "prob-entupimento",
    title: "Ralo, Pia ou Vaso Entupido",
    problemText: "Água não desce ou volta com mau cheiro",
    categoryName: "Desentupidora",
    searchTerm: "Desentupimento",
    icon: Droplets,
    badgeText: "Desentupimento Imediato",
    badgeColor: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
    estimatedTime: "Em até 45 min",
    estimatedPrice: "R$ 110 a R$ 190",
    solutionSummary:
      "Desobstrução mecânica especializada sem quebrar pisos ou danificar o encanamento.",
    checklist: ["Sem quebra-quebra", "Elimina mau cheiro", "Garantia de fluxo contínuo"],
  },
  {
    id: "prob-ar",
    title: "Ar Não Gela ou Pinga Água",
    problemText: "Aparelho fraco ou vazando dentro do quarto",
    categoryName: "Climatização & Refrigeração",
    searchTerm: "Ar Condicionado Manutenção",
    icon: Wind,
    badgeText: "Conforto Térmico",
    badgeColor: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
    estimatedTime: "Em até 60 min",
    estimatedPrice: "R$ 140 a R$ 230",
    solutionSummary:
      "Limpeza de filtros, desobstrução do dreno e verificação de carga de gás refrigerante.",
    checklist: [
      "Higienização antibacteriana",
      "Desobstrução do dreno",
      "Medição de gás e eficiência",
    ],
  },
  {
    id: "prob-chaveiro",
    title: "Trancado Fora / Fechadura Travada",
    problemText: "Chave quebrou dentro ou porta bateu",
    categoryName: "Chaveiro 24h",
    searchTerm: "Chaveiro Emergência",
    icon: Key,
    badgeText: "Plantão 24h",
    badgeColor: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
    estimatedTime: "Em até 25 min",
    estimatedPrice: "R$ 80 a R$ 150",
    solutionSummary:
      "Abertura técnica sem danificar a folha da porta, troca de segredo e cópias na hora.",
    checklist: ["Abertura não-destrutiva", "Atendimento dia e noite", "Troca de miolo opcional"],
  },
  {
    id: "prob-instalacao",
    title: "Instalar TV, Cortina ou Varão",
    problemText: "Furos em alvenaria ou montagem pendente",
    categoryName: "Marido de Aluguel",
    searchTerm: "Instalação Suporte TV Varão",
    icon: Hammer,
    badgeText: "Pequenos Reparos",
    badgeColor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    estimatedTime: "Em até 40 min",
    estimatedPrice: "R$ 60 a R$ 120",
    solutionSummary:
      "Nivelamento a laser, buchas adequadas ao tipo de tijolo e fixação firme sem sujeira.",
    checklist: ["Nivelamento com laser", "Buchas e parafusos corretos", "Limpeza após os furos"],
  },
  {
    id: "prob-disjuntor",
    title: "Quadro Desarmando / Cheiro de Queimado",
    problemText: "Luzes piscando ou tomada sem funcionar",
    categoryName: "Eletricista de Emergência",
    searchTerm: "Quadro de Luz Disjuntor",
    icon: ShieldAlert,
    badgeText: "Segurança Elétrica",
    badgeColor: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    estimatedTime: "Em até 30 min",
    estimatedPrice: "R$ 100 a R$ 180",
    solutionSummary:
      "Diagnóstico de sobrecarga, substituição de disjuntor defeituoso e aperto de barramento.",
    checklist: ["Prevenção contra incêndio", "Equilíbrio de fases", "Laudo rápido de segurança"],
  },
  {
    id: "prob-estofado",
    title: "Sofá Sujo / Manchas e Odores",
    problemText: "Necessita de higienização profunda a seco",
    categoryName: "Higienização de Estofados",
    searchTerm: "Lavagem de Sofá Estofados",
    icon: Sparkles,
    badgeText: "Higienização Completa",
    badgeColor: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
    estimatedTime: "Em até 90 min",
    estimatedPrice: "R$ 130 a R$ 220",
    solutionSummary:
      "Extração por sucção profunda, bactericida atóxico e secagem rápida sem manchar o tecido.",
    checklist: [
      "Elimina ácaros e bactérias",
      "Produtos hipoalergênicos",
      "Secagem em poucas horas",
    ],
  },
]

interface ProblemSolverWizardProps {
  onSelectProblem: (searchTerm: string) => void
  className?: string
}

export function ProblemSolverWizard({ onSelectProblem, className }: ProblemSolverWizardProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"
  const [selectedProblem, setSelectedProblem] = React.useState<ProblemItem | null>(null)

  const handleOpenProblem = (problem: ProblemItem) => {
    setSelectedProblem(problem)
  }

  const handleConfirm = (searchTerm: string) => {
    setSelectedProblem(null)
    onSelectProblem(searchTerm)
  }

  const whatsappMessage = selectedProblem
    ? encodeURIComponent(
        `Olá Severinno! Estou com um problema de "${selectedProblem.title}" aqui em ${city}. Podem me indicar um especialista com orçamento rápido?`,
      )
    : ""

  return (
    <section
      aria-label="Resolva em 3 Cliques - Guia Visual de Problemas"
      className={cn(
        "border-primary/20 bg-card relative rounded-2xl border p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      {/* Cabeçalho */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="border-primary/20 bg-primary/5 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
            <HelpCircle className="size-3.5" />
            <span>Resolva em 3 Cliques</span>
          </div>
          <h2 className="text-foreground mt-1 text-lg font-bold tracking-tight sm:text-xl">
            Qual é o seu problema hoje em {city}?
          </h2>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Não sabe o nome do profissional? Selecione o que aconteceu e nós achamos quem resolve.
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            ⚡ Atendimento com garantia e preço justo
          </span>
        </div>
      </div>

      {/* Grid de problemas comuns */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {COMMON_PROBLEMS.map((prob) => {
          const Icon = prob.icon
          return (
            <button
              key={prob.id}
              type="button"
              onClick={() => handleOpenProblem(prob)}
              className="group border-border/70 bg-background/80 hover:border-primary hover:bg-card focus-visible:ring-primary flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none active:scale-[0.98]"
            >
              <div className="flex w-full items-start justify-between gap-1.5">
                <span className="bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors">
                  <Icon className="size-4" />
                </span>
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] leading-tight font-semibold",
                    prob.badgeColor,
                  )}
                >
                  {prob.badgeText}
                </span>
              </div>

              <div className="mt-2.5 w-full">
                <h3 className="text-foreground group-hover:text-primary line-clamp-1 text-xs font-semibold sm:text-sm">
                  {prob.title}
                </h3>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">
                  {prob.problemText}
                </p>
              </div>

              <div className="border-border/50 text-muted-foreground mt-3 flex w-full items-center justify-between border-t pt-2 text-[10px] font-medium">
                <span className="truncate">{prob.estimatedTime}</span>
                <span className="text-primary font-semibold group-hover:underline">Resolver →</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Modal / Sheet de Diagnóstico Rápido */}
      {selectedProblem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="problem-modal-title"
          className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm duration-200"
        >
          <div className="border-border bg-card animate-in zoom-in-95 relative w-full max-w-lg rounded-2xl border p-6 shadow-2xl duration-200">
            <button
              type="button"
              onClick={() => setSelectedProblem(null)}
              aria-label="Fechar diagnóstico"
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-primary absolute top-4 right-4 rounded-full p-1.5 focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-5" />
            </button>

            <div className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
                {React.createElement(selectedProblem.icon, { className: "size-6" })}
              </span>
              <div>
                <span
                  className={cn(
                    "inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                    selectedProblem.badgeColor,
                  )}
                >
                  {selectedProblem.badgeText}
                </span>
                <h3 id="problem-modal-title" className="text-foreground text-lg font-bold">
                  {selectedProblem.title}
                </h3>
              </div>
            </div>

            <div className="border-primary/15 bg-primary/5 mt-4 rounded-xl border p-3.5">
              <div className="text-primary flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  {selectedProblem.estimatedTime} em {city}
                </span>
                <span>Preço Estimado: {selectedProblem.estimatedPrice}</span>
              </div>
              <p className="text-foreground/80 mt-2 text-xs leading-relaxed">
                {selectedProblem.solutionSummary}
              </p>
            </div>

            <div className="mt-4 space-y-1.5">
              <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                O que está incluso no atendimento:
              </h4>
              <ul className="text-foreground/90 space-y-1 text-xs">
                {selectedProblem.checklist.map((item, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => handleConfirm(selectedProblem.searchTerm)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition-transform active:scale-[0.98]"
              >
                <span>Ver Prestadores Próximos</span>
                <ArrowRight className="size-4" />
              </button>

              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${whatsappMessage}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
              >
                <MessageCircle className="size-4" />
                <span>Pedir no WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
