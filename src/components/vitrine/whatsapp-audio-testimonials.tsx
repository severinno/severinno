"use client"

import * as React from "react"
import {
  Play,
  Pause,
  CheckCheck,
  Star,
  MapPin,
  ArrowRight,
  ShieldCheck,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export type AudioStory = {
  id: string
  clientName: string
  neighborhood: string
  serviceName: string
  durationSec: number
  rating: number
  timeAgo: string
  transcription: string
}

const AUDIO_STORIES: AudioStory[] = [
  {
    id: "dona-maria",
    clientName: "Dona Maria de Fátima",
    neighborhood: "Ilha dos Araújos, GV",
    serviceName: "Elétrica • Chuveiro & Disjuntor",
    durationSec: 8,
    rating: 5.0,
    timeAgo: "Hoje às 11:42",
    transcription:
      "O Carlos da Severinno foi maravilhoso! Chegou aqui na Ilha em 20 minutos, trocou a fiação do chuveiro com todo cuidado e não deixou nenhuma sujeira. Recomendo demais!",
  },
  {
    id: "seu-geraldo",
    clientName: "Seu Geraldo Magela",
    neighborhood: "Grã-Duquesa, GV",
    serviceName: "Hidráulica • Vazamento Oculto",
    durationSec: 6,
    rating: 5.0,
    timeAgo: "Ontem às 16:15",
    transcription:
      "Gostei muito dessa garantia da Severinno. Não precisei adiantar nada no Pix antes de ver o cano consertado. O profissional foi muito honesto.",
  },
  {
    id: "dra-fernanda",
    clientName: "Dra. Fernanda Lima",
    neighborhood: "Centro, GV",
    serviceName: "Estofados • Higienização de Sofá",
    durationSec: 7,
    rating: 5.0,
    timeAgo: "Há 2 dias",
    transcription:
      "Mandei limpar dois sofás retráteis e uma poltrona. Ficaram impecáveis, com cheirinho maravilhoso e secou no mesmo dia. Nota mil!",
  },
  {
    id: "rodrigo",
    clientName: "Rodrigo Andrade",
    neighborhood: "Vila Bretas, GV",
    serviceName: "Pintura • Restauração de Cômodo",
    durationSec: 9,
    rating: 5.0,
    timeAgo: "Há 3 dias",
    transcription:
      "Precisava pintar o apartamento urgente para entregar à imobiliária. A equipe credenciada entregou tudo perfeito 1 dia antes do prazo. Muito top.",
  },
]

export type WhatsappAudioTestimonialsProps = {
  onQuoteService?: (serviceName: string, neighborhood: string) => void
  className?: string
}

export function WhatsappAudioTestimonials({
  onQuoteService,
  className,
}: WhatsappAudioTestimonialsProps) {
  const [playingId, setPlayingId] = React.useState<string | null>(null)
  const [progressMap, setProgressMap] = React.useState<Record<string, number>>({})
  const [expandedTextId, setExpandedTextId] = React.useState<string | null>(null)

  // Simulation timer for audio progress
  React.useEffect(() => {
    if (!playingId) return

    const story = AUDIO_STORIES.find((s) => s.id === playingId)
    if (!story) return

    const interval = setInterval(() => {
      setProgressMap((prev) => {
        const current = prev[playingId] || 0
        if (current >= story.durationSec) {
          setPlayingId(null)
          return { ...prev, [playingId]: 0 }
        }
        return { ...prev, [playingId]: current + 0.5 }
      })
    }, 500)

    return () => clearInterval(interval)
  }, [playingId])

  const togglePlay = (id: string) => {
    if (playingId === id) {
      setPlayingId(null)
    } else {
      setPlayingId(id)
      setProgressMap((prev) => ({ ...prev, [id]: 0 }))
    }
  }

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${mins}:${s < 10 ? "0" : ""}${s}`
  }

  return (
    <section className={cn("bg-muted/20 border-border/50 border-y py-10 sm:py-14", className)}>
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        {/* Header */}
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <Badge
            variant="outline"
            className="mb-3 gap-1.5 border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
          >
            <MessageCircle className="size-3.5 text-emerald-600" />
            <span>Áudios Reais do WhatsApp de Clientes de GV</span>
          </Badge>
          <h2 className="text-foreground text-2xl font-extrabold tracking-tight sm:text-3xl">
            Ouça o que os moradores de Valadares dizem:
          </h2>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Depoimentos espontâneos enviados diretamente no nosso suporte pós-atendimento.
          </p>
        </div>

        {/* Audio Cards Grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {AUDIO_STORIES.map((story) => {
            const isPlaying = playingId === story.id
            const currentProg = progressMap[story.id] || 0
            const progressRatio = Math.min(1, currentProg / story.durationSec)
            const showText = expandedTextId === story.id

            return (
              <div
                key={story.id}
                className="bg-card flex flex-col justify-between rounded-2xl border border-emerald-500/25 p-5 shadow-sm transition-all hover:border-emerald-500/50"
              >
                <div>
                  {/* Top: Avatar, Name, Stars & Neighborhood */}
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-11 border-2 border-emerald-500/40">
                        <AvatarFallback className="bg-emerald-600 text-xs font-bold text-white">
                          {story.clientName.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-foreground text-sm leading-tight font-bold">
                            {story.clientName}
                          </h4>
                          <span title="Cliente Verificado com Serviço Concluído">
                            <ShieldCheck className="size-3.5 text-emerald-600" />
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                          <MapPin className="size-3 text-emerald-600" />
                          <span>{story.neighborhood}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end">
                      <div className="flex items-center gap-1 text-amber-500">
                        <Star className="size-3.5 fill-current" />
                        <span className="text-xs font-bold">{story.rating.toFixed(1)}</span>
                      </div>
                      <span className="text-muted-foreground mt-0.5 text-[10px]">
                        {story.serviceName}
                      </span>
                    </div>
                  </div>

                  {/* Audio Player Bubble */}
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 dark:bg-emerald-950/40">
                    {/* Play/Pause Button */}
                    <button
                      type="button"
                      onClick={() => togglePlay(story.id)}
                      aria-label={isPlaying ? "Pausar áudio" : "Tocar áudio de depoimento"}
                      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white shadow-md transition-transform hover:scale-105 hover:bg-emerald-700 active:scale-95"
                    >
                      {isPlaying ? (
                        <Pause className="size-4" />
                      ) : (
                        <Play className="ml-0.5 size-4" />
                      )}
                    </button>

                    {/* Waveform Visualization */}
                    <div className="flex-1">
                      <div className="flex h-7 items-center gap-1">
                        {Array.from({ length: 24 }).map((_, barIdx) => {
                          const barProgress = (barIdx + 1) / 24
                          const isFilled = barProgress <= progressRatio
                          const heights = [
                            "h-2",
                            "h-4",
                            "h-6",
                            "h-3",
                            "h-5",
                            "h-7",
                            "h-4",
                            "h-6",
                            "h-5",
                            "h-3",
                            "h-6",
                            "h-7",
                            "h-4",
                            "h-5",
                            "h-6",
                            "h-3",
                            "h-4",
                            "h-6",
                            "h-5",
                            "h-3",
                            "h-5",
                            "h-4",
                            "h-3",
                            "h-2",
                          ]
                          const hClass = heights[barIdx % heights.length]

                          return (
                            <span
                              key={barIdx}
                              className={cn(
                                "w-1 rounded-full transition-all duration-150",
                                hClass,
                                isFilled
                                  ? "bg-emerald-600 dark:bg-emerald-400"
                                  : "bg-emerald-200/80 dark:bg-emerald-900/60",
                                isPlaying && isFilled && "animate-pulse",
                              )}
                            />
                          )
                        })}
                      </div>

                      {/* Timers & double check */}
                      <div className="text-muted-foreground mt-1 flex items-center justify-between text-[10px]">
                        <span className="font-mono">
                          {isPlaying
                            ? formatSeconds(currentProg)
                            : formatSeconds(story.durationSec)}
                        </span>
                        <span className="flex items-center gap-1">
                          {story.timeAgo}
                          <CheckCheck className="size-3.5 text-blue-500" />
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Transcription Toggle */}
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedTextId(showText ? null : story.id)}
                      className="text-primary flex cursor-pointer items-center gap-1 text-xs font-semibold hover:underline"
                    >
                      <span>{showText ? "Ocultar transcrição" : "Ler o que ela(e) falou"}</span>
                    </button>
                    {showText && (
                      <p className="text-muted-foreground bg-muted/40 border-border/60 mt-2 rounded-xl border p-2.5 text-xs leading-relaxed italic">
                        "{story.transcription}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Direct Action */}
                <div className="border-border/50 mt-4 flex items-center justify-between border-t pt-3">
                  <span className="text-muted-foreground text-[11px]">Garantia Escrow Ativa</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (onQuoteService) {
                        onQuoteService(
                          story.serviceName.split("•")[0].trim(),
                          story.neighborhood.split(",")[0].trim(),
                        )
                      }
                    }}
                    className="h-7 gap-1 text-xs font-bold text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-300"
                  >
                    <span>Pedir Orçamento Igual</span>
                    <ArrowRight className="size-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default WhatsappAudioTestimonials
