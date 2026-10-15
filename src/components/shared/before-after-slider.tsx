"use client"

/**
 * BeforeAfterSlider — Componente interativo de comparação visual Antes & Depois
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do estado (feedback tátil e visual ao arrastar o divisor).
 * - H6 Reconhecimento em vez de memorização (evidência visual direta da transformação).
 * - Acessibilidade total: suporta drag com mouse/touch e teclas de seta (ArrowLeft / ArrowRight).
 */

import * as React from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export type BeforeAfterSliderProps = {
  beforeImage: string
  afterImage: string
  beforeLabel?: string
  afterLabel?: string
  serviceTitle?: string
  aspectRatio?: "video" | "square" | "4/3"
  className?: string
}

export function BeforeAfterSlider({
  beforeImage,
  afterImage,
  beforeLabel = "Antes",
  afterLabel = "Depois",
  serviceTitle,
  aspectRatio = "video",
  className,
}: BeforeAfterSliderProps) {
  const [sliderPosition, setSliderPosition] = React.useState(50)
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const handleMove = React.useCallback((clientX: number) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPosition(percent)
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true)
    handleMove(e.clientX)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    handleMove(e.clientX)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignora se o ponteiro já foi liberado
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      setSliderPosition((prev) => Math.max(0, prev - 5))
    } else if (e.key === "ArrowRight") {
      setSliderPosition((prev) => Math.min(100, prev + 5))
    }
  }

  const aspectClass =
    aspectRatio === "square"
      ? "aspect-square"
      : aspectRatio === "4/3"
        ? "aspect-4/3"
        : "aspect-video"

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {serviceTitle ? (
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-foreground flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-500" />
            {serviceTitle}
          </span>
          <span className="text-muted-foreground text-[11px] font-normal">
            Arraste para comparar
          </span>
        </div>
      ) : null}

      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Controle de comparação Antes e Depois"
        aria-valuenow={Math.round(sliderPosition)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "border-border/60 relative w-full cursor-ew-resize overflow-hidden rounded-2xl border shadow-sm select-none",
          aspectClass,
        )}
      >
        {/* Imagem "Depois" (fundo completo) */}
        <Image
          src={afterImage}
          alt={afterLabel}
          fill
          sizes="(max-width: 768px) 100vw, 600px"
          className="pointer-events-none object-cover"
          priority={false}
        />

        {/* Badge "Depois" (canto superior direito) */}
        <div className="bg-foreground/80 text-background pointer-events-none absolute top-3 right-3 z-10 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase backdrop-blur-xs">
          {afterLabel}
        </div>

        {/* Imagem "Antes" (recortada via clip-path) */}
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
        >
          <Image
            src={beforeImage}
            alt={beforeLabel}
            fill
            sizes="(max-width: 768px) 100vw, 600px"
            className="pointer-events-none object-cover"
            priority={false}
          />
          {/* Badge "Antes" (canto superior esquerdo) */}
          <div className="bg-foreground/80 text-background absolute top-3 left-3 z-10 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase backdrop-blur-xs">
            {beforeLabel}
          </div>
        </div>

        {/* Linha Divisória com Alça de Arraste */}
        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]"
          style={{ left: `${sliderPosition}%` }}
        >
          <div className="bg-foreground text-background absolute top-1/2 -left-4 flex size-8.5 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-lg transition-transform hover:scale-105 active:scale-95">
            <ChevronLeft className="size-3.5" />
            <ChevronRight className="size-3.5" />
          </div>
        </div>
      </div>
    </div>
  )
}
