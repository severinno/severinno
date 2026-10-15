"use client"

import * as React from "react"
import { Flame, Sparkles, Volume2, SplitSquareVertical, Radar } from "lucide-react"
import { cn } from "@/lib/utils"
import { GvReelsShowcase } from "./gv-reels-showcase"
import BeforeAfterShowcase from "./before-after-showcase"
import { WhatsappAudioTestimonials } from "./whatsapp-audio-testimonials"
import { GvLiveRadarMap } from "./gv-live-radar-map"

export type VisualProofHubTab = "reels" | "before_after" | "audios" | "live_radar"

export type VisualProofHubProps = {
  onQuoteProvider?: (providerName: string) => void
  onQuoteService?: (serviceName: string, neighborhood: string) => void
  initialTab?: VisualProofHubTab
  className?: string
}

const TABS: { id: VisualProofHubTab; label: string; icon: React.ElementType; badge: string }[] = [
  {
    id: "reels",
    label: "Vídeos & Reels em GV",
    icon: Flame,
    badge: "Ao Vivo",
  },
  {
    id: "before_after",
    label: "Antes & Depois (Slider)",
    icon: SplitSquareVertical,
    badge: "Transformações",
  },
  {
    id: "audios",
    label: "Depoimentos em Áudio",
    icon: Volume2,
    badge: "WhatsApp Real",
  },
  {
    id: "live_radar",
    label: "Radar Ao Vivo (Bairros GV)",
    icon: Radar,
    badge: "GPS Ativo",
  },
]

export function VisualProofHub({
  onQuoteProvider,
  onQuoteService,
  initialTab = "reels",
  className,
}: VisualProofHubProps) {
  const [activeTab, setActiveTab] = React.useState<VisualProofHubTab>(initialTab)

  return (
    <section
      aria-label="Central de Prova Visual e Transformações Reais em Governador Valadares"
      className={cn("mx-auto my-12 w-full max-w-[95%] px-2 sm:px-4", className)}
    >
      {/* Header com Navegação em Abas */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-400">
          <Sparkles className="size-3.5" />
          <span>Galeria de Transformações & Prova Social • GV</span>
        </div>
        <h2 className="mt-2.5 text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">
          Veja a Qualidade na Prática Antes de Contratar
        </h2>
        <p className="text-muted-foreground mt-1.5 max-w-2xl text-xs sm:text-sm">
          Acompanhe mini-vídeos gravados nos bairros de GV, compare transformações reais com slider
          de arraste, ouça áudios de clientes e localize técnicos livres no radar ao vivo.
        </p>

        {/* Tab Switcher Pills */}
        <div className="border-border/80 bg-muted/40 mt-6 flex flex-wrap justify-center gap-2 rounded-2xl border p-1.5 backdrop-blur-xs">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all duration-200",
                  active
                    ? "scale-[1.02] bg-rose-600 text-white shadow-md ring-2 ring-rose-500/30"
                    : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "hidden rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase sm:inline-block",
                    active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {tab.badge}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Conteúdo Ativo */}
      <div className="relative">
        {activeTab === "reels" && (
          <div className="animate-in fade-in duration-300">
            <GvReelsShowcase onQuoteProvider={onQuoteProvider} className="my-0 max-w-full px-0" />
          </div>
        )}

        {activeTab === "before_after" && (
          <div className="animate-in fade-in duration-300">
            <BeforeAfterShowcase />
          </div>
        )}

        {activeTab === "audios" && (
          <div className="animate-in fade-in duration-300">
            <WhatsappAudioTestimonials
              onQuoteService={onQuoteService}
              className="my-0 max-w-full"
            />
          </div>
        )}

        {activeTab === "live_radar" && (
          <div className="animate-in fade-in duration-300">
            <GvLiveRadarMap
              onSelectDistrict={(districtName) =>
                onQuoteService?.("Profissional Disponível", districtName)
              }
              className="my-0 max-w-full px-0"
            />
          </div>
        )}
      </div>
    </section>
  )
}
export default VisualProofHub
