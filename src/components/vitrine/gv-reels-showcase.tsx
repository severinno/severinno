"use client"

import * as React from "react"
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
  CheckCircle2,
  Sparkles,
  MapPin,
  Star,
  Eye,
  Clock,
  ArrowRight,
  MessageCircle,
  BadgeCheck,
  Flame,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ReelItem = {
  id: string
  title: string
  service: string
  neighborhood: string
  duration: string
  views: string
  providerName: string
  providerRating: number
  providerReviewsCount: number
  description: string
  beforeAfterSummary: string
  whatsappPreFill: string
  accentColor: string
}

const REELS_DATA: ReelItem[] = [
  {
    id: "reel-1",
    title: "Transformação Completa de Quadro Antigo para DIN",
    service: "Eletricista Residencial",
    neighborhood: "Ilha dos Araújos",
    duration: "0:38",
    views: "2.8k",
    providerName: "Carlos Elétrica GV",
    providerRating: 5.0,
    providerReviewsCount: 94,
    description:
      "Quadro de energia antigo de fusível pegando aquecimento. Substituído por padrão moderno com DR contra choques e DPS anti-raio.",
    beforeAfterSummary: "Segurança total contra curto-circuito em 3h de serviço.",
    whatsappPreFill:
      "Olá Carlos! Vi seu vídeo no Severinno sobre a troca do quadro de disjuntores na Ilha. Gostaria de um orçamento para a minha casa!",
    accentColor: "from-amber-500/20 to-orange-500/30",
  },
  {
    id: "reel-2",
    title: "Desentupimento Noturno sem Quebrar o Porcelanato",
    service: "Encanador Especialista",
    neighborhood: "Centro",
    duration: "0:42",
    views: "3.4k",
    providerName: "Robson Hidráulica 24h",
    providerRating: 4.9,
    providerReviewsCount: 112,
    description:
      "Vaso e ralo transbordando à noite no Centro de GV. Solução rápida com sonda rotativa de alta precisão em 25 minutos.",
    beforeAfterSummary: "Zero sujeira e sem quebrar nada do piso.",
    whatsappPreFill:
      "Olá Robson! Vi seu serviço de desentupimento no Severinno. Preciso de atendimento em GV!",
    accentColor: "from-cyan-500/20 to-blue-500/30",
  },
  {
    id: "reel-3",
    title: "Higienização Profunda & Carga de Gás Split Inverter",
    service: "Climatização & Ar",
    neighborhood: "Morada do Vale",
    duration: "0:50",
    views: "4.1k",
    providerName: "Valadares Clima & Refrigeração",
    providerRating: 5.0,
    providerReviewsCount: 88,
    description:
      "Ar condicionado sem gelar com cheiro ruim. Higienização antibacteriana completa com vapor e recarga ecológica de gás R410a.",
    beforeAfterSummary: "Temperatura caiu de 28°C para 17°C em 10 minutos de teste.",
    whatsappPreFill:
      "Olá! Vi o vídeo da limpeza de ar no Morada do Vale pelo Severinno. Quero agendar para meu ar condicionado!",
    accentColor: "from-teal-500/20 to-emerald-500/30",
  },
  {
    id: "reel-4",
    title: "Pintura Geométrica Moderna em Parede com Infiltração",
    service: "Pintor Profissional",
    neighborhood: "Grã-Duquesa",
    duration: "0:35",
    views: "1.9k",
    providerName: "Juliano Acabamentos",
    providerRating: 4.9,
    providerReviewsCount: 76,
    description:
      "Tratamento com fundo preparador anti-mofo e pintura geométrica decorativa que valorizou a sala da cliente.",
    beforeAfterSummary: "Adeus umidade e estética digna de revista.",
    whatsappPreFill:
      "Olá Juliano! Adorei a parede geométrica que você postou no Severinno. Pode me passar uma estimativa para meu apartamento?",
    accentColor: "from-purple-500/20 to-indigo-500/30",
  },
  {
    id: "reel-5",
    title: "Montagem Expressa de Cozinha Planejada 6 Módulos",
    service: "Montador de Móveis",
    neighborhood: "Vila Bretas",
    duration: "0:45",
    views: "2.2k",
    providerName: "Anderson Montagens GV",
    providerRating: 5.0,
    providerReviewsCount: 130,
    description:
      "Caixas entregues pela transportadora e montadas com alinhamento a laser e fixação reforçada no mesmo dia.",
    beforeAfterSummary: "Cozinha 100% pronta para uso em menos de 5 horas.",
    whatsappPreFill:
      "Olá Anderson! Vi seu trabalho montando armários no Severinno. Tenho móveis para montar em GV, qual sua disponibilidade?",
    accentColor: "from-rose-500/20 to-pink-500/30",
  },
]

export type GvReelsShowcaseProps = {
  onQuoteProvider?: (providerName: string) => void
  className?: string
}

export function GvReelsShowcase({ onQuoteProvider, className }: GvReelsShowcaseProps) {
  const [activeReel, setActiveReel] = React.useState<ReelItem | null>(null)
  const [isPlaying, setIsPlaying] = React.useState(true)
  const [isMuted, setIsMuted] = React.useState(true)
  const [progress, setProgress] = React.useState(25)

  // Simula progresso quando modal está aberto e tocando
  React.useEffect(() => {
    if (!activeReel || !isPlaying) return
    const timer = setInterval(() => {
      setProgress((p) => (p >= 100 ? 0 : p + 2))
    }, 200)
    return () => clearInterval(timer)
  }, [activeReel, isPlaying])

  const openReel = (reel: ReelItem) => {
    setActiveReel(reel)
    setIsPlaying(true)
    setProgress(15)
  }

  const closeReel = () => {
    setActiveReel(null)
  }

  return (
    <section
      aria-label="Reels de Serviços Reais em Governador Valadares"
      className={cn("relative mx-auto my-10 w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-600 dark:text-rose-400">
            <Flame className="size-3.5" />
            <span>Vídeos & Transformações Reais em GV</span>
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
            Veja a Qualidade na Prática Antes de Contratar
          </h2>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            Mini-vídeos de 30 a 50 segundos gravados pelos próprios profissionais durante serviços
            nos bairros de GV.
          </p>
        </div>

        <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold">
          <Eye className="text-primary size-4" />
          <span>+14.000 visualizações este mês</span>
        </div>
      </div>

      {/* Reels Grid / Carrossel Horizontal */}
      <div className="mt-6 flex snap-x scrollbar-thin gap-4 overflow-x-auto pt-1 pb-4">
        {REELS_DATA.map((reel) => (
          <div
            key={reel.id}
            onClick={() => openReel(reel)}
            className="group border-border/80 hover:border-primary/60 relative h-[380px] w-[220px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-2xl border bg-slate-900 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
          >
            {/* Background simulated video glow */}
            <div
              className={cn(
                "absolute inset-0 bg-gradient-to-t via-black/40 to-transparent",
                reel.accentColor,
              )}
            />

            {/* Badges top */}
            <div className="absolute top-3 right-3 left-3 z-10 flex items-center justify-between">
              <span className="flex items-center gap-1 rounded-full bg-rose-600/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                <span className="size-1.5 animate-ping rounded-full bg-white" />
                AO VIVO
              </span>
              <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
                {reel.duration}
              </span>
            </div>

            {/* Play Button center */}
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="group-hover:bg-primary group-hover:text-primary-foreground flex size-12 items-center justify-center rounded-full bg-white/20 text-white shadow-lg backdrop-blur-md transition-transform duration-300 group-hover:scale-110">
                <Play className="ml-0.5 size-5 fill-current" />
              </div>
            </div>

            {/* Information bottom */}
            <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/80 to-transparent p-3.5 text-white">
              <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <MapPin className="size-3" />
                <span>{reel.neighborhood}</span>
              </div>
              <h3 className="group-hover:text-primary-foreground mt-1 line-clamp-2 text-xs font-bold text-white">
                {reel.title}
              </h3>
              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-white/80">
                <span className="max-w-[120px] truncate font-semibold">{reel.providerName}</span>
                <span className="flex items-center gap-0.5 font-bold text-amber-400">
                  <Star className="size-3 fill-amber-400 text-amber-400" />
                  {reel.providerRating.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reel Immersive Modal */}
      {activeReel && (
        <div
          role="dialog"
          aria-modal="true"
          className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md duration-200"
        >
          <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/20 bg-slate-950 text-white shadow-2xl">
            {/* Progress bar */}
            <div className="absolute inset-x-0 top-0 z-30 h-1 bg-white/20">
              <div
                className="bg-primary h-full transition-all duration-200 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Top controls */}
            <div className="absolute inset-x-3 top-3 z-30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-primary flex size-8 items-center justify-center rounded-full text-xs font-bold text-white">
                  {activeReel.providerName.slice(0, 1)}
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs font-bold text-white">
                    <span>{activeReel.providerName}</span>
                    <BadgeCheck className="size-3.5 fill-blue-400 text-blue-400" />
                  </div>
                  <span className="text-[10px] text-white/70">{activeReel.service}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsMuted(!isMuted)}
                  className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                >
                  {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                <button
                  type="button"
                  data-testid="close-reel-modal"
                  onClick={closeReel}
                  className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Video preview simulated canvas */}
            <div
              onClick={() => setIsPlaying(!isPlaying)}
              className={cn(
                "relative flex h-[380px] w-full cursor-pointer items-center justify-center bg-gradient-to-b via-slate-900 to-slate-950 p-6 text-center",
                activeReel.accentColor,
              )}
            >
              {!isPlaying && (
                <div className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
                  <Play className="ml-0.5 size-6 fill-current" />
                </div>
              )}

              <div className="absolute right-4 bottom-4 left-4 text-left">
                <div className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  <span>Resultado Comprovado em {activeReel.neighborhood}</span>
                </div>
                <h4 className="mt-2 text-sm font-black text-white">{activeReel.title}</h4>
                <p className="mt-1 line-clamp-2 text-xs text-white/80">{activeReel.description}</p>
              </div>
            </div>

            {/* Details & CTA Footer */}
            <div className="space-y-3 border-t border-white/10 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/70">Avaliação do Cliente:</span>
                <span className="flex items-center gap-1 font-bold text-amber-400">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  {activeReel.providerRating.toFixed(1)} ({activeReel.providerReviewsCount}{" "}
                  serviços)
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs text-white/90">
                <span className="text-primary font-bold">💡 Destaque do Serviço:</span>{" "}
                {activeReel.beforeAfterSummary}
              </div>

              <div className="flex gap-2 pt-1">
                <a
                  href={`https://wa.me/5533999999999?text=${encodeURIComponent(activeReel.whatsappPreFill)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white shadow-md transition-colors hover:bg-emerald-700"
                >
                  <MessageCircle className="size-4" />
                  <span>Contratar via WhatsApp</span>
                </a>

                {onQuoteProvider && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onQuoteProvider(activeReel.providerName)
                      closeReel()
                    }}
                    className="border-white/20 bg-white/10 text-xs font-bold text-white hover:bg-white/20"
                  >
                    Ver Perfil
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
export default GvReelsShowcase
