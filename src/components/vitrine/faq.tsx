"use client";

/**
 * FAQ — Frequently Asked Questions accordion section.
 *
 * Redesigned applying Jakob Nielsen's 10 Usability Heuristics:
 *   H1  Visibility of system status  → "X de Y dúvidas" counter, search result count, active category highlighted
 *   H2  Match real world             → Natural language Q&A, examples in answers ("Ex: João contratou…")
 *   H3  User control and freedom     → Clear search with easy clear, category filter chips, back-to-top, CTA
 *   H4  Consistency                  → Same accordion style, same badge colors, same emerald accents
 *   H5  Error prevention             → No empty search submission, popular questions if search empty
 *   H6  Recognition > recall         → Category icons, colored badges, visual hierarchy with numbers
 *   H7  Flexibility/efficiency       → Quick category filters, popular questions shortcuts, keyboard nav
 *   H8  Aesthetic minimalism         → Clean two-column layout, generous spacing, subtle borders
 *   H9  Error recovery               → "Nenhuma dúvida encontrada" with alternatives, clear search button
 *   H10 Help/documentation           → "Ainda tem dúvidas?" CTA card, contact options, register button
 */

import * as React from "react";
import {
  HelpCircle,
  Search,
  MessageCircle,
  ShieldCheck,
  CreditCard,
  Calendar,
  UserCheck,
  RefreshCw,
  X,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useScrollReveal } from "@/hooks/use-animation";
import { useUIStore } from "@/store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FAQ data — curated for a service marketplace
// ---------------------------------------------------------------------------

type FAQCategory = "general" | "payment" | "scheduling" | "providers" | "safety";

type FAQItem = {
  id: string;
  question: string;
  answer: string;
  category: FAQCategory;
  example?: string;
  popular?: boolean;
};

const FAQS: FAQItem[] = [
  {
    id: "faq-1",
    category: "general",
    question: "Como funciona o Severinno?",
    answer:
      "O Severinno conecta você a prestadores de serviço verificados próximos à sua localização. Você busca o serviço, compara avaliações reais de outros clientes, pede orçamento grátis e agenda — tudo pela plataforma. O pagamento só é liberado após você confirmar a conclusão do serviço.",
    example:
      "Ex: Maria precisava de um eletricista. Buscou na plataforma, comparou 3 profissionais e contratou o mais bem avaliado — tudo em 5 minutos.",
    popular: true,
  },
  {
    id: "faq-2",
    category: "general",
    question: "Preciso pagar para me cadastrar?",
    answer:
      "Não. O cadastro como cliente é 100% gratuito. Você só paga pelo serviço que contratar, diretamente com o prestador, através da plataforma. Não há taxas escondidas nem mensalidades.",
    popular: true,
  },
  {
    id: "faq-3",
    category: "providers",
    question: "Como os prestadores são verificados?",
    answer:
      "Todos os prestadores passam por um processo de verificação que inclui validação de documento de identidade (RG/CPF/CNPJ), comprovante de endereço e confirmação de telefone. O selo 'Verificado' no perfil indica que essa validação foi concluída. Prestadores não verificados não aparecem na vitrine pública.",
    example:
      "Ex: João contratou um encanador e viu o selo de verificação no perfil — sinal de que os documentos foram validados pela equipe.",
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
      "Após encontrar o prestador ideal, clique em 'Agendar' no card ou perfil. Escolha o serviço, a data e o horário disponíveis, e confirme. Você receberá uma confirmação imediata e poderá acompanhar o status do agendamento pelo painel do cliente.",
    popular: true,
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
    example:
      "Ex: Você paga R$ 150 pelo serviço. O valor fica retido até você confirmar que ficou satisfeito. Só então o prestador recebe.",
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
    popular: true,
  },
  {
    id: "faq-10",
    category: "safety",
    question: "Meus dados pessoais estão seguros?",
    answer:
      "Sim. Seguimos as diretrizes da LGPD (Lei Geral de Proteção de Dados). Seus dados de contato só são compartilhados com o prestador após a confirmação do agendamento. Não vendemos seus dados a terceiros.",
  },
];

const CATEGORY_META: Record<
  FAQCategory,
  { label: string; icon: React.ReactNode; color: string; activeColor: string }
> = {
  general: {
    label: "Geral",
    icon: <HelpCircle className="size-3.5" />,
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    activeColor:
      "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700",
  },
  payment: {
    label: "Pagamento",
    icon: <CreditCard className="size-3.5" />,
    color: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    activeColor:
      "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700",
  },
  scheduling: {
    label: "Agendamento",
    icon: <Calendar className="size-3.5" />,
    color: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    activeColor:
      "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700",
  },
  providers: {
    label: "Prestadores",
    icon: <UserCheck className="size-3.5" />,
    color: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    activeColor:
      "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700",
  },
  safety: {
    label: "Segurança",
    icon: <ShieldCheck className="size-3.5" />,
    color: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    activeColor:
      "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700",
  },
};

const ALL_CATEGORIES: FAQCategory[] = ["general", "payment", "scheduling", "providers", "safety"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FAQ() {
  const [query, setQuery] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState<FAQCategory | null>(null);
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const openAuth = useUIStore((s) => s.openAuth);

  const filtered = React.useMemo(() => {
    let result = FAQS;
    // Filter by category first
    if (activeCategory) {
      result = result.filter((f) => f.category === activeCategory);
    }
    // Then filter by search query
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
      );
    }
    return result;
  }, [query, activeCategory]);

  // Popular questions for quick links (H6, H7)
  const popularFaqs = React.useMemo(() => FAQS.filter((f) => f.popular), []);

  // Count by category in current filtered set (H1)
  const categoryCounts = React.useMemo(() => {
    const counts: Partial<Record<FAQCategory, number>> = {};
    for (const cat of ALL_CATEGORIES) {
      let subset = FAQS.filter((f) => f.category === cat);
      if (query.trim()) {
        const q = query.toLowerCase();
        subset = subset.filter(
          (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
        );
      }
      if (subset.length > 0) counts[cat] = subset.length;
    }
    return counts;
  }, [query]);

  const handleCategoryToggle = (cat: FAQCategory) => {
    setActiveCategory((prev) => (prev === cat ? null : cat));
  };

  const handlePopularClick = (faqId: string) => {
    // Clear filters and scroll to the accordion item
    setActiveCategory(null);
    setQuery("");
    // Small delay to let the accordion render
    setTimeout(() => {
      const el = document.getElementById(faqId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.click();
      }
    }, 100);
  };

  const handleClearSearch = () => {
    setQuery("");
    setActiveCategory(null);
  };

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
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <div ref={ref} className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          {/* ============ LEFT: heading + search + categories + popular + CTA ============ */}
          <div className="lg:sticky lg:top-24 lg:self-start space-y-6">
            {/* Heading */}
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
                <span className="text-emerald-600 dark:text-emerald-400">contratar</span>
              </h2>
              <p className="mt-3 text-pretty text-muted-foreground">
                Reunimos as perguntas mais comuns sobre como o Severinno funciona — do cadastro ao
                pagamento.
              </p>
            </motion.div>

            {/* Search — H7: Ctrl+F style, H5: clear button, H1: result count */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={visible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="relative"
            >
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nas dúvidas…"
                className={cn("pl-9 pr-10", query.trim() && "pr-20")}
                aria-label="Buscar nas perguntas frequentes"
              />
              {/* Clear button — H3: user control */}
              {query.trim() && (
                <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {filtered.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Limpar busca"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </motion.div>

            {/* Category filter chips — H7: quick filters, H6: icons for recognition */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={visible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Filtrar por categoria
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_CATEGORIES.map((cat) => {
                  const count = categoryCounts[cat];
                  if (count === undefined) return null;
                  const isActive = activeCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleCategoryToggle(cat)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                        isActive
                          ? CATEGORY_META[cat].activeColor
                          : CATEGORY_META[cat].color + " hover:opacity-80",
                      )}
                      aria-pressed={isActive}
                      aria-label={`Filtrar por ${CATEGORY_META[cat].label}`}
                    >
                      {CATEGORY_META[cat].icon}
                      {CATEGORY_META[cat].label}
                      <span className="ml-0.5 tabular-nums">({count})</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* Popular questions quick links — H6, H7 */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={visible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Perguntas mais frequentes
              </p>
              <ul className="space-y-1.5">
                {popularFaqs.map((faq) => (
                  <li key={faq.id}>
                    <button
                      type="button"
                      onClick={() => handlePopularClick(faq.id)}
                      className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ArrowRight className="size-3 shrink-0 text-emerald-500 transition-transform group-hover:translate-x-0.5" />
                      <span className="line-clamp-1">{faq.question}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* CTA — H10: Help & documentation, H3: user control */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={visible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="rounded-2xl border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <MessageCircle className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Ainda tem dúvidas?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cadastre-se grátis e converse diretamente com prestadores verificados. Sem
                    compromisso.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      onClick={() => openAuth("register", "CLIENT")}
                      className="h-9 gap-1.5"
                      size="sm"
                    >
                      Cadastrar grátis
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5" asChild>
                      <a href="#faq">
                        <MessageCircle className="size-3.5" />
                        Fale conosco
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* ============ RIGHT: accordion ============ */}
          <div>
            <AnimatePresence mode="wait">
              {filtered.length === 0 ? (
                /* H9: Error recovery — helpful alternatives */
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-16 text-center"
                >
                  <Search className="size-10 text-muted-foreground/50" />
                  <p className="mt-4 text-base font-semibold">
                    Nenhuma dúvida encontrada
                    {query && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        para {"“"}
                        {query}
                        {"”"}
                      </span>
                    )}
                  </p>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Tente usar palavras-chave diferentes, navegue pelas categorias acima ou entre em
                    contato com nosso suporte.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleClearSearch}
                    >
                      <RefreshCw className="size-3.5" />
                      Limpar filtros
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openAuth("register", "CLIENT")}
                    >
                      <MessageCircle className="size-3.5" />
                      Fale com suporte
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Accordion
                    type="single"
                    collapsible
                    defaultValue={filtered[0]?.id}
                    className="space-y-3"
                  >
                    {filtered.map((faq, idx) => (
                      <motion.div
                        key={faq.id}
                        id={faq.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={visible ? { opacity: 1, y: 0 } : {}}
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
                              <span className="flex-1 text-base font-semibold">{faq.question}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "ml-1 hidden shrink-0 gap-1 sm:inline-flex",
                                  CATEGORY_META[faq.category].color,
                                )}
                              >
                                {CATEGORY_META[faq.category].icon}
                                {CATEGORY_META[faq.category].label}
                              </Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-5 pt-1 text-sm leading-relaxed text-muted-foreground">
                            <div className="pl-10 space-y-3">
                              <p>{faq.answer}</p>
                              {faq.example && (
                                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground/80 dark:bg-muted/30">
                                  {faq.example}
                                </p>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </motion.div>
                    ))}
                  </Accordion>
                </motion.div>
              )}
            </AnimatePresence>

            {/* H1: Visibility of system status — counter */}
            <div className="mt-6 flex items-center justify-between">
              <p className="text-xs text-muted-foreground tabular-nums">
                {filtered.length} de {FAQS.length} dúvidas
                {query && ` encontradas`}
                {activeCategory && ` em ${CATEGORY_META[activeCategory].label}`}
              </p>
              <button
                type="button"
                onClick={() => {
                  const section = document.getElementById("faq");
                  if (section) section.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
                aria-label="Voltar ao topo da seção"
              >
                <ChevronUp className="size-3" />
                Topo
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
