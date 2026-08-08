"use client"

/**
 * PartnersSection — "Trusted by" / partner logos marquee for social proof.
 *
 * Heuristic mapping:
 *   H1  Visibility of system status  → "Empresas que confiam" badge, section header
 *   H2  Match real world             → Real-sounding company names (placeholder)
 *   H4  Consistency                  → Consistent card styles, emerald accents
 *   H6  Recognition > recall         → Recognizable logo shapes and colors
 *   H7  Flexibility/efficiency       → Auto-scrolling marquee, pause on hover
 *   H8  Aesthetic minimalism         → Minimal text, no overload
 */

import * as React from "react"

import { useScrollReveal } from "@/hooks/use-animation"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Partner data — placeholder companies
// ---------------------------------------------------------------------------

type Partner = {
  name: string
  color: string
  bg: string
}

const PARTNERS: Partner[] = [
  { name: "TechNova", color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  { name: "Constrular", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-950/40" },
  { name: "Hogárua", color: "text-sky-700 dark:text-sky-300", bg: "bg-sky-50 dark:bg-sky-950/40" },
  { name: "ServiPro", color: "text-rose-700 dark:text-rose-300", bg: "bg-rose-50 dark:bg-rose-950/40" },
  { name: "ReformMax", color: "text-violet-700 dark:text-violet-300", bg: "bg-violet-50 dark:bg-violet-950/40" },
  { name: "LarDoceLar", color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-50 dark:bg-orange-950/40" },
  { name: "FixAll", color: "text-teal-700 dark:text-teal-300", bg: "bg-teal-50 dark:bg-teal-950/40" },
  { name: "MãoDeObra+", color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-50 dark:bg-indigo-950/40" },
  { name: "CasaFácil", color: "text-lime-700 dark:text-lime-300", bg: "bg-lime-50 dark:bg-lime-950/40" },
  { name: "ObraCerta", color: "text-cyan-700 dark:text-cyan-300", bg: "bg-cyan-50 dark:bg-cyan-950/40" },
]

// ---------------------------------------------------------------------------
// Marquee item
// ---------------------------------------------------------------------------

function PartnerCard({ partner }: { partner: Partner }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border px-6 py-4 transition-colors",
        "border-border/50 bg-card/50",
        "hover:border-emerald-200 hover:shadow-sm dark:hover:border-emerald-800/50",
      )}
      style={{ minWidth: 160 }}
    >
      <span
        className={cn(
          "text-base font-bold tracking-tight",
          partner.color,
        )}
      >
        {partner.name}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Marquee animation — infinite horizontal scroll using CSS keyframes
// ---------------------------------------------------------------------------

const MARQUEE_KEYFRAMES = `@keyframes sev-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}`

function Marquee({
  children,
  speed = 30,
  className,
}: {
  children: React.ReactNode
  speed?: number
  className?: string
}) {
  const [hovered, setHovered] = React.useState(false)

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-hidden="true"
    >
      <style>{MARQUEE_KEYFRAMES}</style>
      <div
        className="flex w-max gap-4"
        style={{
          animation: `sev-marquee ${speed}s linear infinite`,
          animationPlayState: hovered ? "paused" : "running",
        }}
      >
        {children}
        {/* Duplicate for seamless loop */}
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PartnersSection() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  return (
    <section className="relative border-t border-border/40 bg-background py-12 sm:py-16">
      <div ref={ref} className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div
          className={cn(
            "mb-8 text-center transition-all duration-500 ease-out",
            visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50">
            Empresas que confiam
          </span>
          <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
            Empresas que confiam no{" "}
            <span className="text-emerald-600 dark:text-emerald-400">Severinno</span>
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Prestadores e empresas de todo o Brasil já usam nossa plataforma.
          </p>
        </div>

        {/* Marquee */}
        <div
          className={cn("transition-opacity duration-500", visible ? "opacity-100" : "opacity-0")}
          style={{ transitionDelay: visible ? "200ms" : "0ms" }}
        >
          <Marquee speed={35}>
            {PARTNERS.map((partner, idx) => (
              <PartnerCard key={`${partner.name}-${idx}`} partner={partner} />
            ))}
          </Marquee>
        </div>

        {/* Second row — reverse direction for visual interest */}
        <div
          className={cn("mt-4 transition-opacity duration-500", visible ? "opacity-100" : "opacity-0")}
          style={{ transitionDelay: visible ? "300ms" : "0ms" }}
        >
          <Marquee speed={40} className="[direction:rtl]">
            {[...PARTNERS].reverse().map((partner, idx) => (
              <PartnerCard key={`${partner.name}-rev-${idx}`} partner={partner} />
            ))}
          </Marquee>
        </div>
      </div>
    </section>
  )
}
