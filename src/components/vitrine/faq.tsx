"use client"

/**
 * FAQ — Clean accordion with category filtering.
 * Minimal, no animation over-engineering.
 */

import * as React from "react"
import { useUIStore } from "@/store/ui"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type FAQItem = {
  id: string
  question: string
  answer: string
  category: "general" | "payment" | "scheduling" | "providers" | "safety"
}

const FAQS: FAQItem[] = [
  {
    id: "faq-1",
    category: "general",
    question: "Como funciona o Severinno?",
    answer:
      "O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca, compara avaliações reais, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.",
  },
  {
    id: "faq-2",
    category: "general",
    question: "Preciso pagar para me cadastrar?",
    answer:
      "Não. O cadastro como cliente é 100% gratuito. Você só paga pelo serviço que contratar, diretamente pela plataforma. Não há taxas escondidas nem mensalidades.",
  },
  {
    id: "faq-3",
    category: "providers",
    question: "Como os prestadores são verificados?",
    answer:
      "Todos os prestadores passam por verificação de identidade (RG/CPF/CNPJ), comprovante de endereço e confirmação de telefone. O selo 'Verificado' indica que essa validação foi concluída pela nossa equipe.",
  },
  {
    id: "faq-4",
    category: "providers",
    question: "Posso me tornar um prestador na plataforma?",
    answer:
      "Sim! Cadastre-se como prestador, envie seus documentos para verificação e comece a receber solicitações de orçamento e agendamentos de clientes na sua região.",
  },
  {
    id: "faq-5",
    category: "scheduling",
    question: "Como faço para agendar um serviço?",
    answer:
      "Após encontrar o prestador ideal, clique em 'Agendar'. Escolha o serviço, data e horário disponíveis, confirme e pronto. Você receberá confirmação imediata e acompanhará o status pelo painel do cliente.",
  },
  {
    id: "faq-6",
    category: "scheduling",
    question: "Posso remarcar ou cancelar um agendamento?",
    answer:
      "Sim. Agendamentos podem ser remarcados ou cancelados com até 24 horas de antecedência, sem custo. Para prazos menores, entre em contato diretamente com o prestador pela plataforma.",
  },
  {
    id: "faq-7",
    category: "payment",
    question: "Como funciona o pagamento?",
    answer:
      "O valor é retido pela plataforma e repassado ao prestador apenas após você confirmar a conclusão do serviço. Aceitamos cartão de crédito, PIX e boleto.",
  },
  {
    id: "faq-8",
    category: "payment",
    question: "O orçamento tem compromisso?",
    answer:
      "Não. Pedir orçamento é gratuito e sem compromisso. Você recebe a proposta e decide se deseja prosseguir. Não há cobrança por solicitar orçamento.",
  },
  {
    id: "faq-9",
    category: "safety",
    question: "E se o serviço não for bem executado?",
    answer:
      "Você pode abrir uma disputa pelo painel em até 7 dias após a conclusão. Nossa equipe mediará e, se aplicável, o pagamento ficará retido até a resolução.",
  },
  {
    id: "faq-10",
    category: "safety",
    question: "Meus dados pessoais estão seguros?",
    answer:
      "Sim. Seguimos as diretrizes da LGPD. Seus dados de contato são compartilhados com o prestador apenas após a confirmação do agendamento. Nunca vendemos seus dados a terceiros.",
  },
]

const CATEGORIES = [
  { value: "all", label: "Todas" },
  { value: "general", label: "Geral" },
  { value: "payment", label: "Pagamento" },
  { value: "scheduling", label: "Agendamento" },
  { value: "providers", label: "Prestadores" },
  { value: "safety", label: "Segurança" },
] as const

export default function FAQ() {
  const [activeCategory, setActiveCategory] = React.useState<string>("all")
  const openAuth = useUIStore((s) => s.openAuth)

  const filtered =
    activeCategory === "all" ? FAQS : FAQS.filter((f) => f.category === activeCategory)

  return (
    <section className="border-border/40 bg-muted/20 border-t py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-10 text-center">
          <p className="text-primary mb-3 text-xs font-semibold tracking-widest uppercase">FAQ</p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Dúvidas frequentes</h2>
        </div>

        {/* Category Filter Pills */}
        <div className="no-scrollbar mb-8 flex items-center gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setActiveCategory(cat.value)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-all",
                activeCategory === cat.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/50 bg-card text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Accordion */}
        <Accordion type="single" collapsible className="space-y-2">
          {filtered.map((faq) => (
            <AccordionItem
              key={faq.id}
              value={faq.id}
              className="border-border/50 bg-card data-[state=open]:border-primary/30 overflow-hidden rounded-xl border px-5"
            >
              <AccordionTrigger className="py-4 text-sm font-medium hover:no-underline">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground pb-4 text-sm leading-relaxed">{faq.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/* Bottom CTA */}
        <div className="border-border/40 bg-card mt-12 rounded-2xl border p-6 text-center">
          <p className="text-muted-foreground mb-4 text-sm">
            Ainda tem dúvidas? Nossa equipe está pronta para ajudar.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="border-primary/40 text-primary hover:bg-primary/5 rounded-full"
            onClick={() => openAuth("register", "CLIENT")}
          >
            Falar com suporte
          </Button>
        </div>
      </div>
    </section>
  )
}
