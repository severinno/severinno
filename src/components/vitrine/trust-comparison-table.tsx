"use client"

import * as React from "react"
import { Check, X, ShieldCheck, AlertTriangle, ArrowRight, Sparkles, Lock } from "lucide-react"
import { cn } from "@/lib/utils"

interface TrustComparisonTableProps {
  onCtaClick?: () => void
  className?: string
}

interface ComparisonCriterion {
  topic: string
  informalTitle: string
  informalDesc: string
  severinnoTitle: string
  severinnoDesc: string
}

const COMPARISON_CRITERIA: ComparisonCriterion[] = [
  {
    topic: "Pagamento & Sinal",
    informalTitle: "Pix Adiantado de 50%",
    informalDesc:
      "Você transfere antes e torce para o profissional aparecer e não sumir com seu dinheiro.",
    severinnoTitle: "Custódia Blindada (R$ 0 Adiantado)",
    severinnoDesc:
      "O valor fica retido na plataforma e só é pago ao técnico depois que você aprova o serviço pronto.",
  },
  {
    topic: "Se o Serviço Ficar Ruim",
    informalTitle: "Prejuízo e Bloqueio no Zap",
    informalDesc:
      "Se o cano vazar no dia seguinte ou o ar parar, o prestador não atende e você gasta o dobro.",
    severinnoTitle: "Garantia de 90 Dias ou Retorno Grátis",
    severinnoDesc:
      "A Severinno garante a reexecução imediata sem custos ou seu dinheiro de volta sem enrolação.",
  },
  {
    topic: "Segurança de Quem Entra na Casa",
    informalTitle: "Desconhecido sem Checagem",
    informalDesc:
      "Nenhum histórico verificado, sem documentação e sem suporte caso algo dê errado.",
    severinnoTitle: "Verificação Tripla com CPF & Facial",
    severinnoDesc:
      "Todos os profissionais passam por checagem de antecedentes, dados cadastrais e validação biométrica.",
  },
  {
    topic: "Pontualidade & Compromisso",
    informalTitle: "O 'Tô Chegando' que Não Vem",
    informalDesc:
      "Marca às 14h, não avisa, não comparece e faz você perder um dia inteiro de trabalho à toa.",
    severinnoTitle: "Rastreio GPS em Tempo Real",
    severinnoDesc:
      "Acompanhe o deslocamento do profissional no mapa até a sua porta, com aviso de chegada e horário.",
  },
  {
    topic: "Transparência de Preço",
    informalTitle: "Preço Cobrado 'No Olho'",
    informalDesc:
      "Valores variam conforme a cara do cliente ou o bairro, com cobranças surpresa no final.",
    severinnoTitle: "Simulador com Tabela de Referência",
    severinnoDesc:
      "Preços médios claros por tipo de serviço e bairro para você não pagar nem um centavo a mais.",
  },
]

export function TrustComparisonTable({ onCtaClick, className }: TrustComparisonTableProps) {
  return (
    <section
      aria-label="Comparativo de Segurança"
      className={cn("mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}
    >
      {/* Header */}
      <div className="space-y-3 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-4" />
          <span>Por Que Não Contratar no Escuro?</span>
        </div>
        <h2 className="text-foreground text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
          Contratar no &ldquo;Boca a Boca&rdquo; vs. Severinno com Proteção Total
        </h2>
        <p className="text-muted-foreground mx-auto max-w-2xl text-xs sm:text-sm">
          Veja a diferença clara entre arriscar seu dinheiro com profissionais avulsos sem garantia
          ou contratar com a tranquilidade da custódia segura da Severinno.
        </p>
      </div>

      {/* Comparison Grid / Table */}
      <div className="border-border/80 bg-card mt-8 overflow-hidden rounded-2xl border shadow-sm">
        {/* Table Header (Desktop) */}
        <div className="bg-muted/60 hidden grid-cols-12 border-b p-4 font-bold md:grid">
          <div className="text-muted-foreground col-span-3 text-xs tracking-wider uppercase">
            Critério
          </div>
          <div className="col-span-4 flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
            <X className="size-4 rounded-full bg-rose-500/10 p-0.5" />
            <span>No &ldquo;Boca a Boca&rdquo; Informal</span>
          </div>
          <div className="col-span-5 flex items-center gap-2 text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
            <Check className="size-4 rounded-full bg-emerald-500/10 p-0.5" />
            <span>Na Severinno com Custódia Blindada</span>
          </div>
        </div>

        {/* Rows */}
        <div className="divide-border/60 divide-y">
          {COMPARISON_CRITERIA.map((criterion, idx) => (
            <div
              key={idx}
              className="hover:bg-muted/20 grid grid-cols-1 gap-4 p-4 transition-colors sm:p-5 md:grid-cols-12 md:items-center md:gap-6"
            >
              {/* Topic Title */}
              <div className="md:col-span-3">
                <span className="text-primary md:text-foreground text-xs font-bold tracking-wider uppercase md:text-sm md:font-extrabold">
                  {criterion.topic}
                </span>
              </div>

              {/* Informal side (Bad) */}
              <div className="rounded-xl border border-rose-200/60 bg-rose-50/40 p-3 md:col-span-4 md:border-0 md:bg-transparent md:p-0 dark:border-rose-900/30 dark:bg-rose-950/20">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
                    <X className="size-3.5 stroke-[3]" />
                  </div>
                  <div>
                    <strong className="block text-xs font-bold text-rose-700 sm:text-sm dark:text-rose-300">
                      {criterion.informalTitle}
                    </strong>
                    <p className="text-muted-foreground mt-0.5 text-xs">{criterion.informalDesc}</p>
                  </div>
                </div>
              </div>

              {/* Severinno side (Good) */}
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-3 md:col-span-5 md:border-0 md:bg-transparent md:p-0 dark:border-emerald-900/40 dark:bg-emerald-950/30">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xs">
                    <Check className="size-3.5 stroke-[3]" />
                  </div>
                  <div>
                    <strong className="block text-xs font-black text-emerald-800 sm:text-sm dark:text-emerald-300">
                      {criterion.severinnoTitle}
                    </strong>
                    <p className="text-muted-foreground mt-0.5 text-xs font-medium">
                      {criterion.severinnoDesc}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Confidence Banner & CTA */}
      <div className="via-background mt-6 flex flex-col items-center justify-between gap-4 rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 p-5 sm:flex-row sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md">
            <Lock className="size-5" />
          </div>
          <div>
            <h4 className="text-foreground text-sm font-black sm:text-base">
              Seu dinheiro protegido do primeiro contato até o aperto de mão final
            </h4>
            <p className="text-muted-foreground text-xs">
              Milhares de clientes já economizaram tempo e evitaram dores de cabeça.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCtaClick}
          className="bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-extrabold shadow-md transition-all hover:scale-[1.02] active:scale-95 sm:text-sm"
        >
          <Sparkles className="size-4" />
          <span>Contratar com Proteção Total</span>
          <ArrowRight className="size-4" />
        </button>
      </div>
    </section>
  )
}
