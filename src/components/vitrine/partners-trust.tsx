"use client"

/**
 * PartnersTrust — "Trusted by" / "As seen in" section with press/media logos.
 *
 * A common trust-building pattern placed after HowItWorks to reinforce
 * credibility before the Testimonials section.
 *
 * Nielsen's Heuristics Applied:
 *   H4  Consistency & standards       → Consistent card styling across logos
 *   H6  Recognition over recall       → Recognizable brand names (G1, Folha, etc.)
 *   H8  Aesthetic & minimalist design → Minimal, clean design — just logos
 *   H9  Help users recover from errors→ Trust signals reduce anxiety and hesitation
 */

import * as React from "react"
import { useScrollReveal } from "@/hooks/use-animation"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Partner / press logo data — text-based logos (no images needed)
// ---------------------------------------------------------------------------

type PressLogo = {
  name: string
  /** Shorter display label for mobile */
  short?: string
}

const PRESS_LOGOS: PressLogo[] = [
  { name: "G1" },
  { name: "Folha de S.Paulo", short: "Folha" },
  { name: "Valor Econômico", short: "Valor" },
  { name: "Exame" },
  { name: "InfoMoney" },
  { name: "Startups" },
  { name: "Sebrae" },
  { name: "ABES" },
]

// ---------------------------------------------------------------------------
// Logo card — grayscale by default, emerald tint + slight scale on hover
// ---------------------------------------------------------------------------

function LogoCard({ logo }: { logo: PressLogo }) {
  return (
    <div
      className={cn(
        // Base: grayscale, muted opacity
        "flex shrink-0 items-center justify-center rounded-xl border px-5 py-3.5",
        "border-border/40 bg-card/30 backdrop-blur-sm",
        "grayscale opacity-50",
        // Hover: color tint + scale (H6: recognition, H4: consistent hover)
        "transition-all duration-300",
        "hover:grayscale-0 hover:opacity-100 hover:scale-105",
        "hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700",
        "dark:hover:border-emerald-800/50 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300",
      )}
      style={{ minWidth: 120 }}
    >
      {/* Desktop: full name; Mobile: short name if available */}
      <span className="hidden text-sm font-bold tracking-tight sm:inline">
        {logo.name}
      </span>
      <span className="text-sm font-bold tracking-tight sm:hidden">
        {logo.short ?? logo.name}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PartnersTrust() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  return (
    <section
      className="relative border-t border-border/30 bg-background py-12 sm:py-16"
      aria-label="Parceiros e imprensa"
    >
      <div ref={ref} className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header (H8: minimal, just a muted label) */}
        <div
          className={cn(
            "mb-8 text-center transition-all duration-500 ease-out",
            visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
          )}
        >
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Referência no mercado
          </p>
        </div>

        {/* Logos — horizontal scroll on mobile, centered grid on desktop */}
        <div
          className={cn("transition-opacity duration-500", visible ? "opacity-100" : "opacity-0")}
          style={{ transitionDelay: visible ? "150ms" : "0ms" }}
        >
          {/* Mobile: horizontal scroll */}
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:hidden scrollbar-thin">
            {PRESS_LOGOS.map((logo) => (
              <LogoCard key={logo.name} logo={logo} />
            ))}
          </div>

          {/* Desktop: centered grid */}
          <div className="hidden flex-wrap items-center justify-center gap-3 sm:flex lg:gap-4">
            {PRESS_LOGOS.map((logo, idx) => (
              <div
                key={logo.name}
                className={cn(
                  "transition-all duration-400 ease-out",
                  visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                )}
                style={{ transitionDelay: visible ? `${100 + idx * 50}ms` : "0ms" }}
              >
                <LogoCard logo={logo} />
              </div>
            ))}
          </div>
        </div>

        {/* Trust stat below logos (H9: trust reduces anxiety) */}
        <p
          className={cn(
            "mt-8 text-center text-sm text-muted-foreground transition-opacity duration-500",
            visible ? "opacity-100" : "opacity-0",
          )}
          style={{ transitionDelay: visible ? "400ms" : "0ms" }}
        >
          + de{" "}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            6.000
          </span>{" "}
          prestadores confiam no Severinno
        </p>
      </div>
    </section>
  )
}
