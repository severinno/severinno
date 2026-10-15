"use client"

import * as React from "react"
import { Mic, MessageCircle, Sparkles, CheckCircle2, ShieldCheck, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface WhatsappAudioQuoteCardProps {
  className?: string
}

export function WhatsappAudioQuoteCard({ className }: WhatsappAudioQuoteCardProps) {
  const { context } = useRegionalContext()
  const { city, neighborhoods } = context
  const primaryNeighborhood = neighborhoods[0] || "Centro"

  const defaultWhatsappMessage = encodeURIComponent(
    `Olá Severinno! Quero pedir um orçamento rápido por áudio para um serviço em ${city} (bairro ${primaryNeighborhood}). Pode me orientar?`,
  )

  const whatsappUrl = `https://wa.me/5533999999999?text=${defaultWhatsappMessage}`

  return (
    <div
      aria-label="Orçamento por Áudio no WhatsApp"
      className={cn(
        "via-background relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 p-5 shadow-md sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: icon + copy + waveform */}
        <div className="flex items-start gap-4">
          <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 sm:size-14">
            <Mic className="size-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400">
                <Sparkles className="size-3 text-emerald-500" />
                <span>Zero Digitação • IA com Transcrição Direta</span>
              </span>
              <span className="text-muted-foreground text-xs font-semibold">
                Atendimento em {city}
              </span>
            </div>

            <h3 className="text-base font-black tracking-tight sm:text-lg">
              Prefere explicar o problema mandando um áudio?
            </h3>
            <p className="text-muted-foreground max-w-xl text-xs sm:text-sm">
              Não sabe o nome técnico da peça ou do defeito? Sem problemas! Mande um áudio no nosso
              WhatsApp e nossa IA compreende sua necessidade e aciona os melhores técnicos da sua
              região.
            </p>

            {/* Simulated audio waveform visual */}
            <div className="flex items-center gap-1.5 pt-1">
              {[40, 65, 30, 85, 55, 95, 45, 70, 35, 90, 60, 45, 80, 50, 30, 75, 40].map(
                (h, idx) => (
                  <span
                    key={idx}
                    style={{ height: `${h * 0.22}px` }}
                    className="w-1 rounded-full bg-emerald-500/40 dark:bg-emerald-400/50"
                  />
                ),
              )}
              <span className="text-muted-foreground pl-2 text-[11px] font-bold">
                Resposta média: ~45 seg
              </span>
            </div>
          </div>
        </div>

        {/* Right CTA */}
        <div className="flex flex-col gap-2 sm:shrink-0">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 px-5 py-3 text-xs font-black text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-emerald-500/25 active:scale-95 sm:text-sm"
          >
            <MessageCircle className="size-4 fill-white" />
            <span>Mandar Áudio no WhatsApp</span>
          </a>

          <div className="text-muted-foreground flex items-center justify-center gap-3 text-[11px] font-semibold">
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
              100% Gratuito
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Zap className="size-3 text-amber-500" />
              Sem Compromisso
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
