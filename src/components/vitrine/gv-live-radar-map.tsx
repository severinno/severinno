"use client"

import * as React from "react"
import { MapPin, Clock, ArrowRight, MessageCircle, LocateFixed, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type DistrictRadarData = {
  id: string
  name: string
  region: string
  activeCount: number
  avgEtaMinutes: number
  topSpecialties: string[]
  surgeStatus: "normal" | "alta_demanda" | "plantao_rapido"
  highlightProvider: {
    name: string
    specialty: string
    rating: number
    badge: string
  }
}

const GV_DISTRICTS_RADAR: DistrictRadarData[] = [
  {
    id: "ilha",
    name: "Ilha dos Araújos",
    region: "Zona Leste / Ilha",
    activeCount: 5,
    avgEtaMinutes: 12,
    topSpecialties: ["Eletricista", "Pintor", "Climatização"],
    surgeStatus: "plantao_rapido",
    highlightProvider: {
      name: "Carlos M.",
      specialty: "Eletricista Residencial NBR 5410",
      rating: 5.0,
      badge: "A 800m de você",
    },
  },
  {
    id: "centro",
    name: "Centro",
    region: "Região Central",
    activeCount: 8,
    avgEtaMinutes: 8,
    topSpecialties: ["Encanador", "Eletricista", "Montador de Móveis"],
    surgeStatus: "normal",
    highlightProvider: {
      name: "Robson H.",
      specialty: "Encanador Especialista em Vazamento",
      rating: 4.9,
      badge: "Em rota na Av. Minas Gerais",
    },
  },
  {
    id: "morada",
    name: "Morada do Vale",
    region: "Zona Sul",
    activeCount: 4,
    avgEtaMinutes: 15,
    topSpecialties: ["Climatização", "Pedreiro", "Gesseiro"],
    surgeStatus: "normal",
    highlightProvider: {
      name: "Valadares Clima",
      specialty: "Limpeza de Ar Split & Carga de Gás",
      rating: 5.0,
      badge: "Disponível para hoje",
    },
  },
  {
    id: "gra_duquesa",
    name: "Grã-Duquesa",
    region: "Zona Norte",
    activeCount: 6,
    avgEtaMinutes: 14,
    topSpecialties: ["Pintor", "Montador", "Eletricista"],
    surgeStatus: "alta_demanda",
    highlightProvider: {
      name: "Juliano Acabamentos",
      specialty: "Pintura & Correção de Infiltração",
      rating: 4.9,
      badge: "Atendendo no bairro",
    },
  },
  {
    id: "vila_isa",
    name: "Vila Isa / São Pedro",
    region: "Margem do Rio Doce",
    activeCount: 5,
    avgEtaMinutes: 16,
    topSpecialties: ["Eletricista", "Encanador", "Serralheiro"],
    surgeStatus: "normal",
    highlightProvider: {
      name: "Marcos Elétrica",
      specialty: "Troca de Quadro & Tomadas",
      rating: 4.8,
      badge: "Veículo de plantão",
    },
  },
  {
    id: "esplanada",
    name: "Esplanada",
    region: "Zona Nobre Central",
    activeCount: 4,
    avgEtaMinutes: 10,
    topSpecialties: ["Chaveiro", "Encanador", "Montador"],
    surgeStatus: "plantao_rapido",
    highlightProvider: {
      name: "Chaveiro 24h Express",
      specialty: "Abertura de Portas & Fechaduras Digitais",
      rating: 5.0,
      badge: "Chegada em 10 min",
    },
  },
]

export type GvLiveRadarMapProps = {
  onSelectDistrict?: (districtName: string) => void
  className?: string
}

export function GvLiveRadarMap({ onSelectDistrict, className }: GvLiveRadarMapProps) {
  const [selectedId, setSelectedId] = React.useState<string>("ilha")
  const activeDistrict =
    GV_DISTRICTS_RADAR.find((d) => d.id === selectedId) || GV_DISTRICTS_RADAR[0]

  const totalActiveInGv = React.useMemo(() => {
    return GV_DISTRICTS_RADAR.reduce((acc, curr) => acc + curr.activeCount, 0)
  }, [])

  const whatsappMessage = encodeURIComponent(
    `Olá! Vi pelo Radar Ao Vivo do Severinno que há técnicos de plantão no bairro ${activeDistrict.name} (Governador Valadares). Preciso de um atendimento para hoje, pode me passar os disponíveis?`,
  )

  return (
    <section
      aria-label="Radar Ao Vivo de Técnicos em Governador Valadares"
      className={cn(
        "relative mx-auto my-10 w-full max-w-full overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 text-white shadow-2xl sm:p-8 md:p-10",
        className,
      )}
    >
      {/* Background radial sweep animation */}
      <div className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 -bottom-40 size-96 rounded-full bg-teal-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3.5 py-1 text-xs font-bold text-emerald-400">
            <Radio className="size-3.5 animate-pulse text-emerald-400" />
            <span>Radar de Proximidade em Tempo Real • Governador Valadares</span>
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
            Veja Quem Está em Rota no Seu Bairro Agora
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-white/70 sm:text-sm">
            Monitore a densidade de profissionais disponíveis com tempo de deslocamento em tempo
            real pela malha urbana de GV.
          </p>
        </div>

        {/* Live Ticker Metric */}
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-white/5 p-3.5 backdrop-blur-md">
          <div className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
          </div>
          <div>
            <span className="text-xs font-black text-emerald-400">
              {totalActiveInGv} Profissionais Livres
            </span>
            <span className="block text-[10px] text-white/60">
              Prontos para atendimento em GV hoje
            </span>
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: Interactive Radar Canvas */}
        <div className="relative flex min-h-[340px] flex-col justify-between overflow-hidden rounded-2xl border border-white/15 bg-black/40 p-5 backdrop-blur-md lg:col-span-7">
          {/* Radar Sweep Rings */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="size-80 rounded-full border border-emerald-500/20" />
            <div className="size-56 rounded-full border border-emerald-500/30" />
            <div className="size-32 rounded-full border border-emerald-500/40" />
            <div className="absolute size-2 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/80" />
          </div>

          {/* Radar Header */}
          <div className="relative z-10 flex items-center justify-between text-xs text-white/80">
            <span className="flex items-center gap-1.5 font-bold">
              <LocateFixed className="size-4 text-emerald-400" />
              <span>Malha Geográfica de GV • Clique no seu bairro</span>
            </span>
            <span className="font-mono text-[10px] text-emerald-400">SCAN: ATIVO</span>
          </div>

          {/* Interactive District Pins */}
          <div className="relative z-10 my-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {GV_DISTRICTS_RADAR.map((district) => {
              const active = district.id === selectedId
              return (
                <button
                  key={district.id}
                  type="button"
                  onClick={() => setSelectedId(district.id)}
                  className={cn(
                    "flex flex-col items-start rounded-xl border p-3 text-left transition-all duration-200",
                    active
                      ? "border-emerald-400 bg-emerald-500/25 shadow-lg ring-2 shadow-emerald-500/20 ring-emerald-400/50"
                      : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10",
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-xs font-bold text-white">{district.name}</span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      {district.activeCount}
                    </span>
                  </div>
                  <span className="mt-1 text-[10px] text-white/60">
                    ~{district.avgEtaMinutes} min de chegada
                  </span>
                </button>
              )
            })}
          </div>

          {/* Radar Footer Status */}
          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-white/70">
            <span>Lat: -18.8511° • Long: -41.9542°</span>
            <span className="font-semibold text-emerald-400">
              Cobertura 100% no Perímetro Urbano de GV
            </span>
          </div>
        </div>

        {/* Right Column: Active District Dossier */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/15 bg-gradient-to-b from-white/10 to-white/5 p-6 backdrop-blur-md lg:col-span-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
                <MapPin className="size-3.5" />
                <span>{activeDistrict.region}</span>
              </span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                {activeDistrict.activeCount} Técnicos Livres
              </span>
            </div>

            <h3 className="mt-2 text-xl font-black text-white sm:text-2xl">
              {activeDistrict.name}
            </h3>

            {/* Arrival estimate */}
            <div className="mt-3 flex items-center gap-2 text-xs text-white/80">
              <Clock className="size-4 text-emerald-400" />
              <span>
                Tempo estimado de chegada:{" "}
                <strong className="text-white">{activeDistrict.avgEtaMinutes} minutos</strong>
              </span>
            </div>

            {/* Specialties available */}
            <div className="mt-4">
              <span className="block text-[11px] font-bold tracking-wider text-white/70 uppercase">
                Especialidades Atendendo Agora:
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeDistrict.topSpecialties.map((spec) => (
                  <span
                    key={spec}
                    className="rounded-lg border border-white/15 bg-black/30 px-2.5 py-1 text-xs font-semibold text-white/90"
                  >
                    {spec}
                  </span>
                ))}
              </div>
            </div>

            {/* Highlighted Provider Card */}
            <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
              <span className="text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
                Profissional de Plantão Mais Próximo:
              </span>
              <div className="mt-1 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">
                    {activeDistrict.highlightProvider.name}
                  </h4>
                  <p className="text-xs text-white/70">
                    {activeDistrict.highlightProvider.specialty}
                  </p>
                </div>
                <span className="rounded-md bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-black">
                  ★ {activeDistrict.highlightProvider.rating.toFixed(1)}
                </span>
              </div>
              <span className="mt-2 inline-block text-[11px] font-semibold text-emerald-300">
                📍 {activeDistrict.highlightProvider.badge}
              </span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="mt-6 space-y-2.5">
            <a
              href={`https://wa.me/5533999999999?text=${whatsappMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black text-black shadow-lg shadow-emerald-500/30 transition-colors hover:bg-emerald-400"
            >
              <MessageCircle className="size-4" />
              <span>Chamar Plantão em {activeDistrict.name}</span>
            </a>

            {onSelectDistrict && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectDistrict(activeDistrict.name)}
                className="w-full border-white/20 bg-white/5 text-xs font-bold text-white hover:bg-white/15"
              >
                <span>Ver Prestadores de {activeDistrict.name}</span>
                <ArrowRight className="ml-1 size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
export default GvLiveRadarMap
