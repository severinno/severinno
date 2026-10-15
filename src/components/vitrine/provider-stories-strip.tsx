"use client"

import * as React from "react"
import { Star, BadgeCheck, X, MessageCircle, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ProviderStory = {
  id: string
  providerId: string
  providerName: string
  district: string
  avatarLetter: string
  rating: number
  specialty: string
  mediaTitle: string
  mediaDescription: string
  beforeAfterBadge: string
  accentColor: string
}

const STORIES_DATA: ProviderStory[] = [
  {
    id: "story-1",
    providerId: "prov-gv-estofados-10",
    providerName: "Camila Estofados",
    district: "Ilha dos Araújos",
    avatarLetter: "C",
    rating: 5.0,
    specialty: "Extratora & Sofás",
    mediaTitle: "Higienização Profunda de Sofá Retrátil",
    mediaDescription:
      "Remoção completa de ácaros e manchas de café com extratora industrial e secagem rápida em 2h.",
    beforeAfterBadge: "Transformação Real",
    accentColor: "from-blue-600 to-indigo-700",
  },
  {
    id: "story-2",
    providerId: "prov-gv-eletrica-01",
    providerName: "Carlos Silva",
    district: "Centro",
    avatarLetter: "C",
    rating: 5.0,
    specialty: "Elétrica & Quadros",
    mediaTitle: "Troca de Quadro Elétrico & Disjuntores DIN",
    mediaDescription:
      "Eliminação total de sobrecarga e risco de incêndio. Organização técnica dos circuitos com laudo.",
    beforeAfterBadge: "Segurança 100%",
    accentColor: "from-amber-500 to-orange-600",
  },
  {
    id: "story-3",
    providerId: "cmv9c7mp70077smw4r5mqavu8",
    providerName: "Mariana Santos",
    district: "Grã-Duquesa",
    avatarLetter: "M",
    rating: 5.0,
    specialty: "Limpeza Pós-Obra",
    mediaTitle: "Entrega de Apartamento Pós-Reforma",
    mediaDescription:
      "Remoção de respingos de tinta em vidros e porcelanatos sem arranhar. Chaves entregues no prazo.",
    beforeAfterBadge: "Brilho Impecável",
    accentColor: "from-emerald-500 to-teal-700",
  },
  {
    id: "story-4",
    providerId: "cmv1lndqd06svsmfqdwjfn79i",
    providerName: "Diego Lima",
    district: "Vila Isa",
    avatarLetter: "D",
    rating: 4.9,
    specialty: "Ar-Condicionado",
    mediaTitle: "Higienização e Bactericida de Split 12.000 BTUs",
    mediaDescription:
      "Desmontagem completa da carenagem, limpeza da turbina e aplicação de anti-mofo hospitalar.",
    beforeAfterBadge: "Ar Puro em Casa",
    accentColor: "from-cyan-500 to-blue-600",
  },
  {
    id: "story-5",
    providerId: "cmv1lndqb06rpsmfqiltmplgt",
    providerName: "André Araújo",
    district: "São Pedro",
    avatarLetter: "A",
    rating: 5.0,
    specialty: "Pintura Airless",
    mediaTitle: "Pintura de Fachada com Tinta Emborrachada",
    mediaDescription:
      "Vedação total contra umidade e trincas. Cobertura uniforme sem marcas de rolo.",
    beforeAfterBadge: "Zero Infiltração",
    accentColor: "from-purple-600 to-pink-600",
  },
]

const SUPPORT_WHATSAPP = "5533999999999"

export type ProviderStoriesStripProps = {
  onQuoteProvider: (providerId: string) => void
  className?: string
}

export function ProviderStoriesStrip({ onQuoteProvider, className }: ProviderStoriesStripProps) {
  const [activeStory, setActiveStory] = React.useState<ProviderStory | null>(null)
  const [progress, setProgress] = React.useState(0)

  // Story progress timer
  React.useEffect(() => {
    if (!activeStory) return

    const interval = 100 // update every 100ms
    const totalDuration = 8000 // 8 seconds per story
    const step = (interval / totalDuration) * 100

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          // Go to next story
          const currentIndex = STORIES_DATA.findIndex((s) => s.id === activeStory.id)
          if (currentIndex < STORIES_DATA.length - 1) {
            setActiveStory(STORIES_DATA[currentIndex + 1])
            return 0
          } else {
            setActiveStory(null)
            return 0
          }
        }
        return prev + step
      })
    }, interval)

    return () => clearInterval(timer)
  }, [activeStory])

  const handleNextStory = () => {
    if (!activeStory) return
    const currentIndex = STORIES_DATA.findIndex((s) => s.id === activeStory.id)
    if (currentIndex < STORIES_DATA.length - 1) {
      setActiveStory(STORIES_DATA[currentIndex + 1])
      setProgress(0)
    } else {
      setActiveStory(null)
    }
  }

  const handlePrevStory = () => {
    if (!activeStory) return
    const currentIndex = STORIES_DATA.findIndex((s) => s.id === activeStory.id)
    if (currentIndex > 0) {
      setActiveStory(STORIES_DATA[currentIndex - 1])
      setProgress(0)
    }
  }

  const handleWhatsAppDirect = (story: ProviderStory) => {
    const text = `Olá! Vi o trabalho de *${story.providerName}* (${story.mediaTitle}) nos Stories da Severinno em Governador Valadares e gostaria de solicitar um orçamento com Garantia de Custódia.`
    const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <section className={cn("bg-background border-border/40 border-b py-6", className)}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex size-2.5 rounded-full bg-rose-500"></span>
            </span>
            <span className="text-foreground flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
              <span>Serviços Entregues em GV (Stories dos Prestadores)</span>
            </span>
          </div>
          <span className="text-muted-foreground hidden text-[11px] sm:inline">
            Clique no círculo para ver a transformação
          </span>
        </div>

        {/* Stories Horizontal Strip */}
        <div className="no-scrollbar flex items-center gap-4 overflow-x-auto py-2">
          {STORIES_DATA.map((story) => (
            <button
              key={story.id}
              type="button"
              onClick={() => {
                setActiveStory(story)
                setProgress(0)
              }}
              className="group flex shrink-0 cursor-pointer flex-col items-center gap-1.5 focus:outline-none"
            >
              {/* Ring Container */}
              <div className="relative rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-emerald-500 p-0.5 shadow-md transition-transform duration-200 group-hover:scale-105">
                <div className="bg-card flex size-16 items-center justify-center overflow-hidden rounded-full p-0.5 sm:size-18">
                  <div
                    className={cn(
                      "flex size-full items-center justify-center rounded-full bg-gradient-to-br text-xl font-black text-white shadow-inner",
                      story.accentColor,
                    )}
                  >
                    {story.avatarLetter}
                  </div>
                </div>

                <div
                  title="Verificado"
                  className="ring-card absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white ring-2"
                >
                  <BadgeCheck className="size-3.5" />
                </div>
              </div>

              {/* Name & Specialty */}
              <div className="max-w-[80px] text-center">
                <p className="text-foreground group-hover:text-primary truncate text-[11px] font-bold transition-colors">
                  {story.providerName.split(" ")[0]}
                </p>
                <p className="text-muted-foreground truncate text-[9px]">{story.specialty}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Story Modal */}
      {activeStory && (
        <Dialog open={Boolean(activeStory)} onOpenChange={() => setActiveStory(null)}>
          <DialogContent className="max-w-md overflow-hidden rounded-3xl border-zinc-800 bg-zinc-950 p-0 text-white shadow-2xl">
            <DialogTitle className="sr-only">Story de {activeStory.providerName}</DialogTitle>

            {/* Progress Bars */}
            <div className="absolute inset-x-3 top-3 z-30 flex items-center gap-1.5">
              {STORIES_DATA.map((s, idx) => {
                const currentIdx = STORIES_DATA.findIndex((it) => it.id === activeStory.id)
                const isPast = idx < currentIdx
                const isCurrent = idx === currentIdx
                return (
                  <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full bg-white transition-all duration-100 ease-linear"
                      style={{
                        width: isPast ? "100%" : isCurrent ? `${progress}%` : "0%",
                      }}
                    />
                  </div>
                )
              })}
            </div>

            {/* Header inside story */}
            <div className="absolute inset-x-4 top-6 z-30 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-md",
                    activeStory.accentColor,
                  )}
                >
                  {activeStory.avatarLetter}
                </div>
                <div>
                  <div className="flex items-center gap-1 font-bold text-white">
                    <span>{activeStory.providerName}</span>
                    <BadgeCheck className="size-3.5 text-emerald-400" />
                  </div>
                  <p className="text-[10px] text-white/70">{activeStory.district}, GV</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveStory(null)}
                className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Main Visual Display */}
            <div
              className={cn(
                "relative flex h-[480px] w-full flex-col justify-end bg-gradient-to-b p-6",
                activeStory.accentColor,
              )}
            >
              {/* Tap navigation zones */}
              <div
                className="absolute inset-y-0 left-0 z-20 w-1/3 cursor-pointer"
                onClick={handlePrevStory}
              />
              <div
                className="absolute inset-y-0 right-0 z-20 w-2/3 cursor-pointer"
                onClick={handleNextStory}
              />

              {/* Decorative visual content */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-15">
                <Sparkles className="size-64" />
              </div>

              {/* Story Content Overlay */}
              <div className="relative z-30 space-y-3">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/20 px-3 py-1 text-xs font-extrabold tracking-wider text-white uppercase backdrop-blur">
                  <Sparkles className="size-3 text-amber-300" />
                  {activeStory.beforeAfterBadge}
                </span>

                <h3 className="text-xl leading-tight font-black text-white sm:text-2xl">
                  {activeStory.mediaTitle}
                </h3>

                <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-white/90 backdrop-blur">
                  {activeStory.mediaDescription}
                </p>

                <div className="flex items-center gap-1 text-xs font-bold text-amber-300">
                  <Star className="size-3.5 fill-amber-300" />
                  <span>{activeStory.rating.toFixed(1)} de satisfação comprovada no laudo</span>
                </div>

                {/* Direct Actions inside Story */}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Button
                    size="sm"
                    onClick={() => {
                      onQuoteProvider(activeStory.providerId)
                      setActiveStory(null)
                    }}
                    className="flex-1 bg-white font-bold text-zinc-950 shadow-lg hover:bg-white/90"
                  >
                    <span>Pedir Orçamento</span>
                  </Button>

                  <button
                    type="button"
                    onClick={() => handleWhatsAppDirect(activeStory)}
                    className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow-md transition-all hover:bg-emerald-500"
                  >
                    <MessageCircle className="size-3.5" />
                    <span>WhatsApp Direto</span>
                  </button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
export default ProviderStoriesStrip
