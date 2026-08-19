"use client"

/**
 * AiQuoteWizard — 100% Open Source AI-powered service request wizard.
 *
 * Steps:
 * 1. Problem Description: Text prompt (or voice/photo)
 * 2. Local AI Analysis: Llama 3.1 8B extracts category, severity, and price range
 * 3. Smart Match Recommendation: Displays matched providers and estimated costs
 */

import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { Bot, DollarSign, Loader2, Lock, MapPin, Send, Sparkles, Star, Wrench } from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

import { apiPost } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export type AiEstimationResponse = {
  ok: boolean
  estimation: {
    categoryId?: string
    categoryName: string
    suggestedTitle: string
    problemSeverity: "LOW" | "MEDIUM" | "HIGH"
    estimatedPriceRange: {
      min: number
      max: number
    }
    suggestedDescription: string
    confidenceScore: number
    source: "local-llama" | "keyword-fallback"
  }
  recommendedProviders: Array<{
    providerId: string
    name: string
    avatarUrl?: string | null
    verified: boolean
    avgRating: number
    reviewCount: number
    distanceKm: number
    basePrice: number
    serviceTitle: string
    matchScore: number
  }>
}

type AiQuoteWizardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userLat?: number
  userLng?: number
  onRequestQuoteWithAi?: (data: AiEstimationResponse["estimation"]) => void
}

export function AiQuoteWizard({
  open,
  onOpenChange,
  userLat,
  userLng,
  onRequestQuoteWithAi,
}: AiQuoteWizardProps) {
  const [description, setDescription] = React.useState("")
  const [step, setStep] = React.useState<"INPUT" | "RESULT">("INPUT")

  const estimateMutation = useMutation({
    mutationFn: () =>
      apiPost<AiEstimationResponse>("/api/quotes/ai-estimate", {
        description,
        lat: userLat,
        lng: userLng,
      }),
    onSuccess: () => {
      setStep("RESULT")
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Erro ao analisar com IA. Tente novamente.")
    },
  })

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDescription("")
      setStep("INPUT")
      estimateMutation.reset()
    }
    onOpenChange(next)
  }

  const result = estimateMutation.data

  const severityLabels = {
    LOW: {
      label: "Baixa complexidade",
      color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    },
    MEDIUM: {
      label: "Média complexidade",
      color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    },
    HIGH: {
      label: "Urgência / Alta complexidade",
      color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    },
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Bot className="size-6 text-emerald-600" />
            Assistente Inteligente de Orçamentos
          </DialogTitle>
          <DialogDescription>
            Descreva o que você precisa e nossa IA local identificará o serviço e a faixa de preço
            ideal.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "INPUT" && (
            <motion.div
              key="step-input"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4 pt-2"
            >
              <div className="space-y-2">
                <label className="text-foreground text-sm font-medium">
                  O que precisa ser feito?
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Minha pia da cozinha está vazando por baixo do sifão e molhando o armário..."
                  rows={4}
                  className="resize-none"
                />
              </div>

              {/* Suggestions chips */}
              <div className="space-y-1.5">
                <span className="text-muted-foreground text-xs">Exemplos comuns:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Vazamento no banheiro",
                    "Instalação de tomada 220V",
                    "Pintura de quarto 12m²",
                    "Limpeza pós-obra",
                  ].map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setDescription(example)}
                      className="border-border bg-muted/40 text-muted-foreground rounded-full border px-3 py-1 text-xs transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              {/* Privacy badge */}
              <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg border p-3 text-xs">
                <Lock className="size-4 shrink-0 text-emerald-600" />
                <span>
                  <strong>IA 100% Local & Privada:</strong> Seus dados são processados por
                  inteligência artificial local (Llama 3.1) e nunca são compartilhados externamente.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => estimateMutation.mutate()}
                  disabled={description.trim().length < 5 || estimateMutation.isPending}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {estimateMutation.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Analisando com IA…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Analisar Problema
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "RESULT" && result && (
            <motion.div
              key="step-result"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4 pt-1"
            >
              {/* Category card */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <Wrench className="size-3.5" />
                      Categoria Identificada
                    </span>
                    <h3 className="text-foreground mt-0.5 text-lg font-bold">
                      {result.estimation.categoryName}
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      severityLabels[result.estimation.problemSeverity].color
                    }`}
                  >
                    {severityLabels[result.estimation.problemSeverity].label}
                  </span>
                </div>

                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  {result.estimation.suggestedDescription}
                </p>

                {/* Price range box */}
                <div className="mt-3 flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm dark:bg-zinc-900">
                  <div className="flex items-center gap-2">
                    <DollarSign className="size-4 text-emerald-600" />
                    <span className="text-muted-foreground text-xs font-medium">
                      Estimativa Média de Mercado:
                    </span>
                  </div>
                  <span className="text-sm font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                    {formatBRL(result.estimation.estimatedPriceRange.min)} —{" "}
                    {formatBRL(result.estimation.estimatedPriceRange.max)}
                  </span>
                </div>
              </div>

              {/* Matched Providers */}
              {result.recommendedProviders?.length > 0 && (
                <div className="space-y-2">
                  <span className="text-muted-foreground flex items-center gap-1 text-xs font-semibold">
                    <Sparkles className="size-3.5 text-emerald-600" />
                    Melhores Prestadores Disponíveis Próximos:
                  </span>
                  <div className="grid gap-2">
                    {result.recommendedProviders.map((p) => (
                      <div
                        key={p.providerId}
                        className="bg-card flex items-center justify-between rounded-lg border p-2.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-9 border">
                            {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                              {p.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-xs font-semibold">{p.name}</p>
                            <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                              <span className="flex items-center gap-0.5 font-bold text-amber-500">
                                <Star className="size-3 fill-amber-400" />
                                {p.avgRating.toFixed(1)}
                              </span>
                              <span>·</span>
                              <span className="flex items-center gap-0.5">
                                <MapPin className="size-3" />
                                {p.distanceKm} km
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold text-emerald-600">
                            a partir de {formatBRL(p.basePrice)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between border-t pt-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("INPUT")}>
                  Refazer Análise
                </Button>
                <Button
                  onClick={() => {
                    onRequestQuoteWithAi?.(result.estimation)
                    onOpenChange(false)
                  }}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Send className="size-4" />
                  Solicitar Orçamento com Estes Dados
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
