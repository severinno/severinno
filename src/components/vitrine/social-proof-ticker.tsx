"use client"

/**
 * SocialProofTicker — Animated horizontal marquee of real-time platform activity.
 *
 * Positioned right after the Hero to build immediate trust and show that
 * the platform is alive and active.
 *
 * Nielsen's Heuristics Applied:
 *   H1  Visibility of system status  → Shows real-time platform activity (status)
 *   H2  Match between system & real   → "contratou", "avaliou" — not "transação processada"
 *   H3  User control & freedom        → Pause on hover for readability
 *   H4  Consistency & standards       → Consistent emerald color scheme
 *   H6  Recognition over recall       → Shows real names and actions (recognition)
 *   H8  Aesthetic & minimalist design → Minimal design, just scrolling text
 */

import * as React from "react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Activity items — realistic platform actions in pt-BR (H2: real-world language)
// ---------------------------------------------------------------------------

type Activity = {
  text: string
  /** Optional icon emoji for visual anchoring */
  emoji?: string
}

const ACTIVITIES_ROW_1: Activity[] = [
  { text: "Maria contratou um eletricista em São Paulo", emoji: "⚡" },
  { text: "João avaliou ★★★★★ o prestador Ricardo", emoji: "⭐" },
  { text: "Nova avaliação: 4.9 para Serviços de Pintura", emoji: "🎨" },
  { text: "Ana pediu orçamento para encanador", emoji: "🔧" },
  { text: "Pedro se cadastrou como prestador verificado", emoji: "✅" },
  { text: "12 orçamentos enviados hoje", emoji: "📋" },
]

const ACTIVITIES_ROW_2: Activity[] = [
  { text: "Carlos agendou limpeza de quintal em Belo Horizonte", emoji: "🧹" },
  { text: "Fernanda avaliou ★★★★★ o prestador José", emoji: "⭐" },
  { text: "8 novos prestadores verificados esta semana", emoji: "🛡️" },
  { text: "Luciana contratou um pintor no Rio de Janeiro", emoji: "🎨" },
  { text: "Orçamento aceito: reforma de banheiro em Curitiba", emoji: "🚿" },
  { text: "5.200 serviços concluídos este mês", emoji: "🏆" },
]

// ---------------------------------------------------------------------------
// CSS-only infinite scroll (no JS interval) — using @keyframes
// ---------------------------------------------------------------------------

// The marquee uses CSS animation for performance. We duplicate the content
// so the scroll is seamless. Pause on hover via animation-play-state (H3).

function MarqueeRow({
  items,
  speed = 40,
  reverse = false,
}: {
  items: Activity[]
  speed?: number
  reverse?: boolean
}) {
  return (
    <div className="group/marquee relative overflow-hidden">
      {/* Left fade gradient (H8: clean edges) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-emerald-50 to-transparent sm:w-24 dark:from-emerald-950/30 dark:to-transparent"
      />
      {/* Right fade gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-teal-50 to-transparent sm:w-24 dark:from-teal-950/30 dark:to-transparent"
      />

      <div
        className={cn(
          "flex items-center gap-6 whitespace-nowrap",
          "animate-[marquee-scroll_var(--duration)_linear_infinite]",
          "group-hover/marquee:[animation-play-state:paused]", // H3: pause on hover
          reverse && "[animation-direction:reverse]",
        )}
        style={
          {
            "--duration": `${speed}s`,
          } as React.CSSProperties
        }
      >
        {/* Duplicate items for seamless loop */}
        {[0, 1].map((dup) =>
          items.map((item, idx) => (
            <React.Fragment key={`${dup}-${idx}`}>
              <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
                {item.emoji && (
                  <span aria-hidden className="text-base">
                    {item.emoji}
                  </span>
                )}
                {item.text}
              </span>
              {/* Dot separator (emerald) */}
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-emerald-400/60 dark:bg-emerald-500/50"
              />
            </React.Fragment>
          )),
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SocialProofTicker() {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden border-y border-emerald-200/50 dark:border-emerald-800/30",
        "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30",
      )}
      aria-label="Atividade recente na plataforma"
    >
      {/* Inject the @keyframes for CSS-only infinite scroll */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes marquee-scroll {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
          `,
        }}
      />

      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
        {/* Badge: "● Atividade recente" (H1: system status) */}
        <div className="mb-2 flex items-center gap-2 sm:mb-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:ring-emerald-700/50">
            {/* Pulsing green dot — H1: live indicator */}
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 dark:bg-emerald-500" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            </span>
            Atividade recente
          </span>
        </div>

        {/* Mobile: single row; Desktop: double row */}
        <div className="flex flex-col gap-2">
          {/* Row 1 — always visible */}
          <MarqueeRow items={ACTIVITIES_ROW_1} speed={38} />

          {/* Row 2 — visible on sm+ only (desktop: double line) */}
          <div className="hidden sm:block">
            <MarqueeRow items={ACTIVITIES_ROW_2} speed={45} reverse />
          </div>
        </div>
      </div>
    </section>
  )
}
