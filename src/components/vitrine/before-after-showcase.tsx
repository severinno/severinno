"use client"

/**
 * BeforeAfterShowcase — Seção da Vitrine com Comparação Antes & Depois
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do estado do sistema: O usuário interage dinamicamente com o slider.
 * - H6 Reconhecimento em vez de memorização: Prova visual tangível do serviço prestado.
 * - H7 Flexibilidade e eficiência de uso: Navegação rápida entre especialidades.
 */

import * as React from "react"
import { Sparkles, ArrowRight, CheckCircle } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

import { BeforeAfterSlider } from "@/components/shared/before-after-slider"
import { EscrowGuaranteeBadge } from "@/components/shared/escrow-guarantee-badge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useUIStore } from "@/store/ui"

type ShowcaseItem = {
  id: string
  category: string
  title: string
  neighborhood: string
  providerName: string
  beforeImage: string
  afterImage: string
  description: string
  rating: number
  price: string
}

const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "eletrica-1",
    category: "Elétrica & Segurança",
    title: "Reforma do Quadro de Distribuição & Disjuntores",
    neighborhood: "Centro, GV",
    providerName: "Carlos Eletricista Pro",
    beforeImage: "https://picsum.photos/seed/elec-before/800/600",
    afterImage: "https://picsum.photos/seed/elec-after/800/600",
    description:
      "Eliminação total de aquecimento excessivo e fiação exposta, com novo barramento pente e disjuntores DIN certificados.",
    rating: 5.0,
    price: "R$ 420,00",
  },
  {
    id: "hidraulica-1",
    category: "Hidráulica & Reparos",
    title: "Contenção de Vazamento Oculto & Nova Tubulação",
    neighborhood: "Ilha dos Araújos, GV",
    providerName: "Marcos Encanador",
    beforeImage: "https://picsum.photos/seed/hydro-before/800/600",
    afterImage: "https://picsum.photos/seed/hydro-after/800/600",
    description:
      "Localização precisa do cano rompido com geofone sem quebrar a parede toda, troca de registros e acabamento.",
    rating: 4.9,
    price: "R$ 350,00",
  },
  {
    id: "pintura-1",
    category: "Pintura & Restauração",
    title: "Tratamento de Umidade & Pintura Acrílica Premium",
    neighborhood: "Grã-Duquesa, GV",
    providerName: "Silva Pinturas & Acabamentos",
    beforeImage: "https://picsum.photos/seed/paint-before/800/600",
    afterImage: "https://picsum.photos/seed/paint-after/800/600",
    description:
      "Aplicação de fundo preparador anti-mofo, massa acrílica impermeável e duas demãos de tinta lavável de alta cobertura.",
    rating: 5.0,
    price: "R$ 680,00",
  },
]

export default function BeforeAfterShowcase() {
  const [activeId, setActiveId] = React.useState<string>(SHOWCASE_ITEMS[0].id)
  const openQuote = useUIStore((s) => s.openQuote)

  const activeItem = SHOWCASE_ITEMS.find((it) => it.id === activeId) ?? SHOWCASE_ITEMS[0]

  return (
    <section className="bg-muted/30 border-border/60 relative border-y py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Cabeçalho da Seção */}
        <div className="mx-auto max-w-3xl text-center">
          <Badge
            variant="outline"
            className="mb-3 border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
          >
            <Sparkles className="mr-1.5 size-3.5 text-emerald-500" />
            Resultados Comprovados
          </Badge>
          <h2 className="text-foreground text-3xl font-extrabold tracking-tight sm:text-4xl">
            Transformações Reais: Antes & Depois
          </h2>
          <p className="text-muted-foreground mt-3 text-base sm:text-lg">
            Veja o padrão de excelência dos profissionais verificados em Governador Valadares.
            Arraste o divisor para comparar a transformação de cada serviço.
          </p>

          {/* Abas de Navegação das Categorias */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {SHOWCASE_ITEMS.map((item) => {
              const isSelected = item.id === activeId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveId(item.id)}
                  className={`rounded-full px-4 py-2 text-xs font-medium transition-all ${
                    isSelected
                      ? "bg-foreground text-background scale-105 shadow-md"
                      : "bg-background text-muted-foreground hover:text-foreground border-border/80 hover:border-foreground/30 border"
                  }`}
                >
                  {item.category}
                </button>
              )
            })}
          </div>
        </div>

        {/* Card Principal Interativo */}
        <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          {/* Slider Interativo (7 colunas em telas grandes) */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeItem.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
              >
                <BeforeAfterSlider
                  beforeImage={activeItem.beforeImage}
                  afterImage={activeItem.afterImage}
                  beforeLabel="Antes do Serviço"
                  afterLabel="Resultado Final"
                  serviceTitle={activeItem.title}
                  aspectRatio="video"
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Detalhes do Serviço & Selo Escrow (5 colunas) */}
          <div className="bg-card border-border/70 flex flex-col justify-between rounded-2xl border p-6 shadow-sm sm:p-8 lg:col-span-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">
                  {activeItem.neighborhood}
                </span>
                <span className="flex items-center gap-1 text-xs font-bold text-amber-500">
                  ★ {activeItem.rating.toFixed(1)}
                </span>
              </div>

              <h3 className="text-foreground mt-2 text-xl font-bold">{activeItem.title}</h3>

              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {activeItem.description}
              </p>

              <div className="border-border/60 mt-5 space-y-2 border-t pt-4 text-xs">
                <div className="text-muted-foreground flex items-center justify-between">
                  <span>Profissional Responsável:</span>
                  <span className="text-foreground flex items-center gap-1 font-semibold">
                    <CheckCircle className="size-3.5 text-emerald-600" />
                    {activeItem.providerName}
                  </span>
                </div>
                <div className="text-muted-foreground flex items-center justify-between">
                  <span>Investimento do Cliente:</span>
                  <span className="text-foreground text-sm font-bold">{activeItem.price}</span>
                </div>
              </div>

              {/* Escrow Guarantee Trust Banner */}
              <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
                <EscrowGuaranteeBadge variant="compact" />
                <p className="text-muted-foreground mt-2 text-[11px] leading-tight">
                  O valor de {activeItem.price} ficou 100% retido em custódia segura pela plataforma
                  e só foi repassado ao profissional após o cliente inspecionar e aprovar a
                  conclusão.
                </p>
              </div>
            </div>

            {/* Ação: Pedir Orçamento Semelhante */}
            <div className="border-border/60 mt-6 border-t pt-4">
              <Button onClick={() => openQuote()} className="w-full gap-2 font-semibold shadow-sm">
                Solicitar Orçamento com Proteção Escrow
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
