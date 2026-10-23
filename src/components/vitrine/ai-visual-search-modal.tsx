"use client"

import * as React from "react"
import {
  Camera,
  Upload,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface AiVisualSearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectService?: (serviceName: string) => void
}

interface DiagnosticResult {
  id: string
  problemTitle: string
  category: string
  urgency: "baixa" | "media" | "alta" | "critica"
  confidence: number
  estimatedRange: string
  description: string
  suggestedAction: string
  recommendedProviders: Array<{
    name: string
    role: string
    rating: number
    etaMin: string
    neighborhood: string
  }>
}

const PRESET_SCENARIOS: Array<{
  label: string
  emoji: string
  previewImg: string
  result: DiagnosticResult
}> = [
  {
    label: "Vazamento na Tubulação / Pia",
    emoji: "💧",
    previewImg:
      "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=400&q=80",
    result: {
      id: "diag-hidraulica",
      problemTitle: "Vazamento em Tubulação de PVC / Sifão Trincado",
      category: "Reparos e Instalações (Hidráulica)",
      urgency: "alta",
      confidence: 96,
      estimatedRange: "R$ 130 - R$ 220",
      description:
        "Detectamos acúmulo de umidade e gotejamento ativo na junção da tubulação. Risco de infiltração na laje ou armário.",
      suggestedAction:
        "Troca do anel de vedação, reparo da junta ou substituição do sifão sanfonado.",
      recommendedProviders: [
        {
          name: "Cláudio H.",
          role: "Encanador Especialista",
          rating: 4.9,
          etaMin: "15 min",
          neighborhood: "Centro",
        },
        {
          name: "Marcos V.",
          role: "Técnico Hidráulico",
          rating: 5.0,
          etaMin: "25 min",
          neighborhood: "Ilha dos Araújos",
        },
      ],
    },
  },
  {
    label: "Disjuntor Desarmando / Cheiro de Queimado",
    emoji: "⚡",
    previewImg:
      "https://images.unsplash.com/photo-1544725176-7c40e5a71c5e?auto=format&fit=crop&w=400&q=80",
    result: {
      id: "diag-eletrica",
      problemTitle: "Sobrecarga de Circuito / Disjuntor Subdimensionado",
      category: "Reparos e Instalações (Elétrica)",
      urgency: "critica",
      confidence: 94,
      estimatedRange: "R$ 160 - R$ 280",
      description:
        "A imagem aponta superaquecimento nos bornes do disjuntor principal. Risco iminente de curto-circuito e derretimento da isolação.",
      suggestedAction:
        "Redimensionamento da fiação, troca de disjuntor bipolar e reaperto de conexões.",
      recommendedProviders: [
        {
          name: "Alexandre G.",
          role: "Eletricista Industrial/Predial",
          rating: 5.0,
          etaMin: "20 min",
          neighborhood: "Grã-Duquesa",
        },
        {
          name: "Carlos M.",
          role: "Eletrotécnico Credenciado",
          rating: 4.9,
          etaMin: "15 min",
          neighborhood: "Centro",
        },
      ],
    },
  },
  {
    label: "Ar-Condicionado Pingando Água / Sujo",
    emoji: "❄️",
    previewImg:
      "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=400&q=80",
    result: {
      id: "diag-ar",
      problemTitle: "Obstrução na Bandeja de Dreno e Filtros Saturados",
      category: "Reparos e Instalações (Refrigeração)",
      urgency: "media",
      confidence: 97,
      estimatedRange: "R$ 150 - R$ 250",
      description:
        "Evaporadora transbordando água devido a lodo no dreno e poeira acumulada na serpentina. Reduz o rendimento térmico e consome mais luz.",
      suggestedAction:
        "Desobstrução química do dreno, higienização com bactericida e limpeza completa das aletas.",
      recommendedProviders: [
        {
          name: "Roberto F.",
          role: "Técnico em Climatização",
          rating: 5.0,
          etaMin: "18 min",
          neighborhood: "São Pedro",
        },
        {
          name: "Juliana T.",
          role: "Especialista em Split & Inverter",
          rating: 4.9,
          etaMin: "30 min",
          neighborhood: "Vila Isa",
        },
      ],
    },
  },
]

export function AiVisualSearchModal({
  open,
  onOpenChange,
  onSelectService,
}: AiVisualSearchModalProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"

  const [analyzing, setAnalyzing] = React.useState(false)
  const [selectedPhoto, setSelectedPhoto] = React.useState<string | null>(null)
  const [activeDiagnostic, setActiveDiagnostic] = React.useState<DiagnosticResult | null>(null)

  const handleSelectScenario = (scenario: (typeof PRESET_SCENARIOS)[0]) => {
    setSelectedPhoto(scenario.previewImg)
    setAnalyzing(true)
    setActiveDiagnostic(null)

    setTimeout(() => {
      setAnalyzing(false)
      setActiveDiagnostic(scenario.result)
    }, 1200)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setSelectedPhoto(reader.result as string)
      setAnalyzing(true)
      setActiveDiagnostic(null)

      // Simulated IA recognition
      setTimeout(() => {
        setAnalyzing(false)
        setActiveDiagnostic(PRESET_SCENARIOS[0].result)
      }, 1500)
    }
    reader.readAsDataURL(file)
  }

  const handleReset = () => {
    setSelectedPhoto(null)
    setActiveDiagnostic(null)
    setAnalyzing(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
              <Camera className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black tracking-tight sm:text-xl">
                Diagnóstico Visual com Inteligência Artificial
              </DialogTitle>
              <DialogDescription className="text-xs">
                Tire uma foto ou envie uma imagem do problema. Nossa IA identifica o serviço exato
                em {city}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {!selectedPhoto && (
            <>
              {/* File Upload Dropzone */}
              <label
                htmlFor="photo-upload"
                className="group border-border/80 hover:border-primary/50 hover:bg-primary/5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all"
              >
                <div className="bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary flex size-14 items-center justify-center rounded-2xl transition-transform group-hover:scale-110">
                  <Upload className="size-7" />
                </div>
                <h4 className="text-foreground mt-4 text-sm font-bold">
                  Clique para tirar uma foto ou enviar imagem
                </h4>
                <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                  Aponte para o vazamento, disjuntor, rachadura ou aparelho com defeito. (JPG, PNG
                  ou foto direta da câmera)
                </p>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Instant Try Scenarios */}
              <div className="space-y-2.5">
                <span className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                  Ou teste com um exemplo real em 1 clique:
                </span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {PRESET_SCENARIOS.map((sc) => (
                    <button
                      key={sc.label}
                      type="button"
                      onClick={() => handleSelectScenario(sc)}
                      className="border-border/80 bg-card hover:border-primary/50 hover:bg-muted/40 flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all active:scale-95"
                    >
                      <span className="text-xl">{sc.emoji}</span>
                      <span className="text-foreground line-clamp-2 text-xs font-bold">
                        {sc.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Analyzing State */}
          {analyzing && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="bg-primary/10 text-primary relative flex size-16 items-center justify-center rounded-2xl">
                <Loader2 className="size-8 animate-spin" />
                <Sparkles className="absolute -top-1 -right-1 size-5 animate-bounce text-amber-500" />
              </div>
              <h4 className="text-foreground mt-4 text-base font-bold">
                Analisando imagem com visão computacional...
              </h4>
              <p className="text-muted-foreground mt-1 max-w-md text-xs">
                Identificando componentes, nível de urgência e estimativa de reparo em {city}.
              </p>
            </div>
          )}

          {/* Diagnostic Result Card */}
          {activeDiagnostic && !analyzing && (
            <div className="space-y-4">
              <div className="border-primary/30 bg-card overflow-hidden rounded-2xl border shadow-sm">
                {/* Result Header */}
                <div className="bg-muted/40 flex items-start justify-between border-b p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        <span>Identificado com {activeDiagnostic.confidence}% de certeza</span>
                      </span>
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold text-rose-600 uppercase">
                        Urgência: {activeDiagnostic.urgency}
                      </span>
                    </div>
                    <h3 className="text-foreground text-base font-black sm:text-lg">
                      {activeDiagnostic.problemTitle}
                    </h3>
                    <span className="text-primary text-xs font-bold">
                      {activeDiagnostic.category}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-semibold"
                  >
                    <RefreshCw className="size-3.5" />
                    <span>Outra Foto</span>
                  </button>
                </div>

                {/* Details */}
                <div className="space-y-3 p-4">
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {activeDiagnostic.description}
                  </p>

                  <div className="border-border/80 bg-muted/30 rounded-xl border p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-semibold">Ação Recomendada:</span>
                      <strong className="font-bold text-emerald-600 dark:text-emerald-400">
                        Faixa estimada: {activeDiagnostic.estimatedRange}
                      </strong>
                    </div>
                    <p className="text-foreground mt-1 text-xs font-medium">
                      {activeDiagnostic.suggestedAction}
                    </p>
                  </div>
                </div>

                {/* Recommended Professionals */}
                <div className="bg-muted/20 space-y-2.5 border-t p-4">
                  <span className="text-muted-foreground block text-xs font-bold tracking-wider uppercase">
                    Profissionais recomendados para este conserto em {city}:
                  </span>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {activeDiagnostic.recommendedProviders.map((provider, idx) => (
                      <div
                        key={idx}
                        className="border-border/80 bg-background flex items-center justify-between rounded-xl border p-2.5 shadow-2xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-foreground truncate text-xs font-bold">
                              {provider.name}
                            </span>
                            <ShieldCheck className="size-3 text-emerald-500" />
                          </div>
                          <span className="text-muted-foreground block truncate text-[10px]">
                            {provider.role}
                          </span>
                          <span className="text-primary block text-[10px] font-semibold">
                            📍 {provider.neighborhood} • Chegada: ~{provider.etaMin}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            onSelectService?.(activeDiagnostic.problemTitle)
                            onOpenChange(false)
                          }}
                          className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold shadow-xs transition-all active:scale-95"
                        >
                          Chamar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Action */}
              <button
                type="button"
                onClick={() => {
                  onSelectService?.(activeDiagnostic.problemTitle)
                  onOpenChange(false)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/95 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-black shadow-md transition-all active:scale-95 sm:text-sm"
              >
                <span>Ver Todos os Profissionais para este Problema em {city}</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
