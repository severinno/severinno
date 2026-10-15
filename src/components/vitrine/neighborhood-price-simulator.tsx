"use client"

import * as React from "react"
import {
  Calculator,
  MapPin,
  Wrench,
  ShieldCheck,
  Clock,
  ArrowRight,
  MessageCircle,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type NeighborhoodPriceSimulatorProps = {
  onQuote: (serviceName: string, district: string) => void
  className?: string
}

const SUPPORT_WHATSAPP = "5533999999999"

const GV_NEIGHBORHOODS = [
  "Centro",
  "Ilha dos Araújos",
  "Grã-Duquesa",
  "São Pedro",
  "Vila Isa",
  "Santa Rita",
  "Esplanada",
  "Lourdes",
  "Morada do Vale",
  "Esperança",
  "Vila Bretas",
  "Altinópolis",
  "Biquinhas",
  "Castírio",
]

type ServiceEstimate = {
  id: string
  name: string
  category: string
  minPrice: number
  maxPrice: number
  unit: string
  etaMinutes: number
  description: string
}

const SERVICE_ESTIMATES: ServiceEstimate[] = [
  {
    id: "ar-condicionado",
    name: "Técnico de Ar-Condicionado",
    category: "Reparos e Instalações",
    minPrice: 130,
    maxPrice: 190,
    unit: "serviço / ponto",
    etaMinutes: 25,
    description: "Limpeza profunda, higienização com bactericida ou recarga de gás.",
  },
  {
    id: "eletricista",
    name: "Eletricista Residencial",
    category: "Reparos e Instalações",
    minPrice: 60,
    maxPrice: 130,
    unit: "ponto / reparo",
    etaMinutes: 20,
    description: "Troca de chuveiro, disjuntores, tomadas e conserto de curto-circuito.",
  },
  {
    id: "encanador",
    name: "Encanador / Desentupimento",
    category: "Reparos e Instalações",
    minPrice: 80,
    maxPrice: 160,
    unit: "reparo",
    etaMinutes: 20,
    description: "Vazamentos, troca de torneiras, reparo de caixa acoplada e sifão.",
  },
  {
    id: "pintor",
    name: "Pintor Residencial",
    category: "Reforma e Construção",
    minPrice: 180,
    maxPrice: 350,
    unit: "cômodo / dia",
    etaMinutes: 30,
    description: "Preparação de paredes, massa corrida e pintura premium.",
  },
  {
    id: "diarista",
    name: "Diarista / Faxina Residencial",
    category: "Limpeza e Casa",
    minPrice: 150,
    maxPrice: 190,
    unit: "diária padrão",
    etaMinutes: 35,
    description: "Limpeza completa, organização e faxina pós-evento com referências checadas.",
  },
  {
    id: "estofados",
    name: "Higienização de Sofás & Colchões",
    category: "Acabamento e Decoração",
    minPrice: 160,
    maxPrice: 220,
    unit: "sofá / colchão",
    etaMinutes: 30,
    description: "Lavagem profunda com extratora e secagem rápida no local.",
  },
  {
    id: "chaveiro",
    name: "Chaveiro 24 Horas",
    category: "Emergência 24h",
    minPrice: 70,
    maxPrice: 140,
    unit: "abertura / cópia",
    etaMinutes: 15,
    description: "Abertura emergencial residencial e automotiva sem danificar fechadura.",
  },
]

export function NeighborhoodPriceSimulator({
  onQuote,
  className,
}: NeighborhoodPriceSimulatorProps) {
  const [selectedNeighborhood, setSelectedNeighborhood] = React.useState("Centro")
  const [selectedServiceId, setSelectedServiceId] = React.useState("ar-condicionado")

  const currentService = React.useMemo(() => {
    return SERVICE_ESTIMATES.find((s) => s.id === selectedServiceId) || SERVICE_ESTIMATES[0]
  }, [selectedServiceId])

  const handleWhatsAppLockPrice = () => {
    const text = `Olá! Simulei na Severinno o serviço *${currentService.name}* no bairro *${selectedNeighborhood}* em Governador Valadares (faixa estimada de R$ ${currentService.minPrice} a R$ ${currentService.maxPrice}). Gostaria de travar este orçamento com a Garantia de Custódia.`
    const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div
      className={cn(
        "border-primary/30 bg-card relative rounded-3xl border p-6 shadow-xl backdrop-blur-md transition-all sm:p-8",
        className,
      )}
    >
      {/* Top Banner Tag */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="bg-primary/10 text-primary border-primary/20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold">
          <Calculator className="size-3.5" />
          <span>Simulador de Preço Médio em Governador Valadares</span>
        </div>
        <span className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          Valores baseados em atendimentos reais na cidade
        </span>
      </div>

      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
        {/* Left Inputs */}
        <div className="space-y-4 lg:col-span-7">
          <h3 className="text-foreground text-xl font-extrabold tracking-tight sm:text-2xl">
            Descubra quanto custa seu conserto no seu bairro:
          </h3>

          <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
            {/* Service Selector */}
            <div>
              <label className="text-muted-foreground mb-1.5 block flex items-center gap-1 text-xs font-bold tracking-wider uppercase">
                <Wrench className="text-primary size-3" />
                Qual serviço você precisa?
              </label>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="border-border/80 bg-background text-foreground focus:ring-primary h-11 w-full rounded-xl border px-3.5 text-sm font-semibold shadow-xs transition-all focus:ring-2 focus:outline-none"
              >
                {SERVICE_ESTIMATES.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Neighborhood Selector */}
            <div>
              <label className="text-muted-foreground mb-1.5 block flex items-center gap-1 text-xs font-bold tracking-wider uppercase">
                <MapPin className="text-primary size-3" />
                Em qual bairro de GV?
              </label>
              <select
                value={selectedNeighborhood}
                onChange={(e) => setSelectedNeighborhood(e.target.value)}
                className="border-border/80 bg-background text-foreground focus:ring-primary h-11 w-full rounded-xl border px-3.5 text-sm font-semibold shadow-xs transition-all focus:ring-2 focus:outline-none"
              >
                {GV_NEIGHBORHOODS.map((nh) => (
                  <option key={nh} value={nh}>
                    {nh}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-muted-foreground flex items-center gap-1.5 pt-1 text-xs">
            <Sparkles className="size-3.5 shrink-0 text-amber-500" />
            <span>{currentService.description}</span>
          </p>
        </div>

        {/* Right Output Card */}
        <div className="from-primary/10 via-background border-primary/30 flex flex-col justify-between rounded-2xl border bg-gradient-to-br to-emerald-500/10 p-5 shadow-md lg:col-span-5">
          <div>
            <div className="text-muted-foreground border-border/40 flex items-center justify-between border-b pb-2 text-xs">
              <span className="font-medium">Faixa estimada para {selectedNeighborhood}:</span>
              <span className="text-primary flex items-center gap-1 font-bold">
                <Clock className="size-3" /> ~{currentService.etaMinutes} min
              </span>
            </div>

            <div className="mt-3 text-center sm:text-left">
              <div className="flex items-baseline gap-1.5">
                <span className="text-foreground text-3xl font-black tracking-tight">
                  R$ {currentService.minPrice} — {currentService.maxPrice}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Estimativa por {currentService.unit}
              </p>
            </div>

            <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
              <span>Garantia Severinno: você só paga após o serviço entregue.</span>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={handleWhatsAppLockPrice}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-md transition-all hover:scale-[1.01] hover:bg-emerald-700 sm:text-sm"
            >
              <MessageCircle className="size-4" />
              <span>Travar Orçamento no WhatsApp</span>
            </button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onQuote(currentService.name, selectedNeighborhood)}
              className="flex w-full items-center justify-center gap-1 text-xs font-semibold"
            >
              <span>Ver Profissionais Disponíveis em {selectedNeighborhood}</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
export default NeighborhoodPriceSimulator
