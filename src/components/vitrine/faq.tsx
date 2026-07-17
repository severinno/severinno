"use client"

/**
 * FAQ — Frequently Asked Questions accordion section.
 *
 * Trust-building element common in marketplaces. Addresses visitor concerns
 * about safety, payment, scheduling, and provider verification.
 *
 * Features:
 *   - Accordion with smooth expand/collapse (shadcn/ui Accordion)
 *   - Two-column layout on desktop: heading column + accordion column
 *   - "Still have questions?" CTA at the bottom
 *   - Search/filter FAQs by keyword (client-side)
 *   - Scroll-reveal animation when section enters viewport
 *   - Category badges for each FAQ group
 *   - Dark mode fully supported
 */

import * as React from "react"
import {
  HelpCircle,
  Search,
  MessageCircle,
  ShieldCheck,
  CreditCard,
  Calendar,
  UserCheck,
  RefreshCw,
  ChevronDown,
} from "lucide-react"
import { motion } from "framer-motion"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useScrollReveal } from "@/hooks/use-animation"
import { useUIStore } from "@/store"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// FAQ data — curated for a service marketplace
// ---------------------------------------------------------------------------

type FAQCategory = "general" | "payment" | "scheduling" | "providers" | "safety"

type FAQItem = {
  id: string
  question: string
  answer: string
  category: FAQCategory
}

const FAQS: FAQItem[] = [
  {
    id: "faq-1",
    category: "general",
    question: "Como funciona o Severinno?",
    answer:
      "O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.",
  },
  {
    id: "faq-2",
    category: "general",
    question: "Preciso pagar para me cadastrar?",
    answer:
      "Não. O cadastro como cliente é 100% gratuito. Você só paga pelo serviço que contratar, diretamente com o prestador, através da plataforma. Não há taxas escondidas nem mensalidades.",
  },
  {
    id: "faq-3",
    category: "providers",
    question: "Como os prestadores são verificados?",
    answer:
      "Todos os prestadores passam por um processo de verificação que inclui validação de documento de identidade (RG/CPF/CNPJ), comprovante de endereço e confirmação de telefone. O selo “Verificado” no perfil indica que essa validação foi concluída. Prestadores não verificados não aparecem na vitrine pública.",
  },
  {
    id: "faq-4",
    category: "providers",
    question: "Posso me tornar um prestador no Severinno?",
    answer:
      "Sim! Se você é um profissional de serviços (encanador, eletricista, pintor, diarista, etc.), cadastre-se como prestador, envie seus documentos para verificação e comece a receber solicitações de orçamento e agendamentos de clientes na sua região.",
  },
  {
    id: "faq-5",
    category: "scheduling",
    question: "Como faço para agendar um serviço?",
    answer:
      "Após encontrar o prestador ideal, clique em “Agendar” no card ou perfil. Escolha o serviço, a data e o horário disponíveis, e confirme. Você receberá uma confirmação imediata e poderá acompanhar o status do agendamento pelo painel do cliente.",
  },
  {
    id: "faq-6",
    category: "scheduling",
    question: "Posso remarcar ou cancelar um agendamento?",
    answer:
      "Sim. Agendamentos podem ser remarcardos ou cancelados pelo painel do cliente com até 24 horas de antecedência, sem custo. Para cancelamentos em prazo menor, entre em contato diretamente com o prestador pela plataforma.",
  },
  {
    id: "faq-7",
    category: "payment",
    question: "Como funciona o pagamento?",
    answer:
      "O pagamento é feito pela plataforma após a conclusão do serviço. Você pode pagar com cartão de crédito, PIX ou boleto. O valor só é repassado ao prestador depois que você marca o serviço como concluído — garantindo sua satisfação.",
  },
  {
    id: "faq-8",
    category: "payment",
    question: "O orçamento tem compromisso?",
    answer:
      "Não. Pedir orçamento é grátis e sem compromisso. Você recebe a proposta do prestador com o preço estimado e decide se quer prosseguir com o agendamento. Não há cobrança por solicitar orçamento.",
  },
  {
    id: "faq-9",
    category: "safety",
    question: "E se o serviço não for bem-feito?",
    answer:
      "Se houver algum problema com o serviço, você pode abrir uma disputa pelo painel do cliente em até 7 dias após a conclusão. Nossa equipe de suporte mediará a situação e, se aplicável, o pagamento será retido até a resolução. Avaliações públicas também ajudam a manter a qualidade.",
  },
  {
    id: "faq-10",
    category: "safety",
    question: "Meus dados pessoais estão seguros?",
    answer:
      "Sim. Seguimos as diretrizes da LGPD (Lei Geral de Proteção de Dados). Seus dados de contato só são compartilhados com o prestador após a confirmação do agendamento. Não vendemos seus dados a terceiros.",
  },
]

const CATEGORY_META: Record<
  FAQCategory,
  { label: string; icon: React.ReactNode }
> = {
  general: {
    label: "Geral",
    icon: <HelpCircle className="size-3.5" />,
  },
  payment: {
    label: "Pagamento",
    icon: <CreditCard className="size-3.5" />,
  },
  scheduling: {
    label: "Agendamento",
    icon: <Calendar className="size-3.5" />,
  },
  providers: {
    label: "Prestadores",
    icon: <UserCheck className="size-3.5" />,
  },
  safety: {
    label: "Segurança",
    icon: <ShieldCheck className="size-3.5" />,
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FAQ() {
  const [query, setQuery] = React.useState("")
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const openAuth = useUIStore((s) => s.openAuth)

  const filtered = React.useMemo(() => {
    if (!query.trim()) return FAQS
    const q = query.toLowerCase()
    return FAQS.filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q),
    )
  }, [query])

  // Group filtered FAQs by category for badges
  const categoriesUsed = React.useMemo(() => {
    const set = new Set<FAQCategory>()
    filtered.forEach((f) => set.add(f.category))
    return Array.from(set)
  }, [filtered])

  return (
    <section
      id="faq"
      className="relative scroll-mt-20 bg-gradient-to-b from-background to-muted/30 py-16 sm:py-20"
    >
      {/* Decorative dot pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <div
        ref={ref}
        className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          {/* ============ LEFT: heading + search + CTA ============ */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={visible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5 }}
            >
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50">
                <HelpCircle className="size-3.5" />
                Perguntas frequentes
              </span>
              <h2 className="mt-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                Tire suas dúvidas antes de{" "}
                <span className="text-emerald-600 dark:text-emerald-400">
                  contratar
                </span>
              </h2>
              <p className="mt-3 text-pretty text-muted-foreground">
                Reunimos as perguntas mais comuns sobre como o Severinno
                funciona — do cadastro ao pagamento. Não encontrou o que
                procurava? Nossa equipe está pronta para ajudar.
              </p>
            </motion.div>

            {/* Search */}
            <div className="relative mt-6">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nas dúvidas…"
                className="pl-9"
                aria-label="Buscar nas perguntas frequentes"
              />
            </div>

            {/* Active category badges */}
            {categoriesUsed.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {categoriesUsed.map((cat) => (
                  <Badge
                    key={cat}
                    variant="secondary"
                    className="gap-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {CATEGORY_META[cat].icon}
                    {CATEGORY_META[cat].label}
                  </Badge>
                ))}
              </div>
            )}

            {/* CTA */}
            <div className="mt-8 rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <MessageCircle className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Ainda tem dúvidas?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cadastre-se grátis e converse diretamente com prestadores
                    verificados. Sem compromisso.
                  </p>
                  <Button
                    onClick={() => openAuth("register", "CLIENT")}
                    className="mt-3 h-9 gap-1.5"
                    size="sm"
                  >
                    Cadastrar grátis
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* ============ RIGHT: accordion ============ */}
          <div>
            {filtered.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 text-center">
                <Search className="size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Nenhuma dúvida encontrada para “{query}”.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  onClick={() => setQuery("")}
                >
                  <RefreshCw className="size-3.5" />
                  Limpar busca
                </Button>
              </div>
            ) : (
              <Accordion
                type="single"
                collapsible
                defaultValue={filtered[0]?.id}
                className="space-y-3"
              >
                {filtered.map((faq, idx) => (
                  <motion.div
                    key={faq.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={
                      visible ? { opacity: 1, y: 0 } : {}
                    }
                    transition={{ duration: 0.4, delay: idx * 0.05 }}
                  >
                    <AccordionItem
                      value={faq.id}
                      className="overflow-hidden rounded-xl border bg-card px-5 shadow-sm transition-colors hover:border-emerald-200 data-[state=open]:border-emerald-300 data-[state=open]:shadow-md dark:hover:border-emerald-800/50 dark:data-[state=open]:border-emerald-700"
                    >
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-start gap-3 py-1 text-left">
                          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <span className="flex-1 text-base font-semibold">
                            {faq.question}
                          </span>
                          <Badge
                            variant="outline"
                            className="ml-1 hidden shrink-0 gap-1 sm:inline-flex"
                          >
                            {CATEGORY_META[faq.category].icon}
                            {CATEGORY_META[faq.category].label}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-5 pt-1 text-sm leading-relaxed text-muted-foreground">
                        <div className="pl-10">
                          {faq.answer}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </motion.div>
                ))}
              </Accordion>
            )}

            <p className="mt-6 text-center text-xs text-muted-foreground">
              {filtered.length} de {FAQS.length} dúvidas
              {query && ` encontradas para “${query}”`}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
