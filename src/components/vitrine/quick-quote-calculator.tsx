"use client"

/**
 * QuickQuoteCalculator — interactive price estimate section.
 *
 * 3-step flow:
 *   1. Select service type (category buttons with icons)
 *   2. Describe scope (Pequeno / Médio / Grande)
 *   3. See estimated price range (animated counter)
 *
 * Nielsen's Heuristics:
 *   H1 — Clear step indicator, price estimate visible
 *   H2 — Concrete service examples and scope descriptions
 *   H3 — Can go back to previous steps
 *   H5 — Disclaimer about estimate accuracy
 *   H6 — Recognizable category icons
 *   H7 — Quick 3-step flow
 *   H8 — Clean, focused interface
 *   H10 — Disclaimer explains the estimate nature
 */

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Zap,
  Droplets,
  Paintbrush,
  BrickWall,
  Square,
  SprayCan,
  Home,
  ChevronRight,
  ChevronLeft,
  Calculator,
  AlertTriangle,
  ArrowRight,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useUIStore } from "@/store/ui"

// ---------------------------------------------------------------------------
// Price data (hardcoded)
// ---------------------------------------------------------------------------

type ScopeKey = "small" | "medium" | "large"

const PRICE_DATA: Record<string, Record<ScopeKey, [number, number]>> = {
  eletrica: { small: [80, 150], medium: [200, 450], large: [500, 1200] },
  hidraulica: { small: [100, 200], medium: [250, 500], large: [600, 1500] },
  pintura: { small: [150, 300], medium: [400, 800], large: [1000, 2500] },
  alvenaria: { small: [120, 250], medium: [300, 600], large: [800, 2000] },
  pisos: { small: [200, 400], medium: [500, 1000], large: [1200, 3000] },
  "pos-obra": { small: [150, 300], medium: [350, 700], large: [800, 1800] },
  residencial: { small: [100, 200], medium: [250, 500], large: [600, 1500] },
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

type CategoryConfig = {
  key: string
  label: string
  icon: LucideIcon
  color: string // Tailwind color name
}

const CATEGORIES: CategoryConfig[] = [
  { key: "eletrica", label: "Elétrica", icon: Zap, color: "amber" },
  { key: "hidraulica", label: "Hidráulica", icon: Droplets, color: "sky" },
  { key: "pintura", label: "Pintura", icon: Paintbrush, color: "rose" },
  { key: "alvenaria", label: "Alvenaria", icon: BrickWall, color: "orange" },
  { key: "pisos", label: "Pisos", icon: Square, color: "violet" },
  { key: "pos-obra", label: "Pós-obra", icon: SprayCan, color: "teal" },
  { key: "residencial", label: "Residencial", icon: Home, color: "emerald" },
]

// ---------------------------------------------------------------------------
// Scope config
// ---------------------------------------------------------------------------

type ScopeConfig = {
  key: ScopeKey
  label: string
  description: string
  emoji: string
}

const SCOPES: ScopeConfig[] = [
  { key: "small", label: "Pequeno", description: "Ex.: 1 tomada, 1 ponto", emoji: "🔹" },
  { key: "medium", label: "Médio", description: "Ex.: 3–5 tomadas, 1 cômodo", emoji: "🔸" },
  { key: "large", label: "Grande", description: "Ex.: Casa inteira, obra completa", emoji: "🔶" },
]

// ---------------------------------------------------------------------------
// CSS-only bar chart for price comparison
// ---------------------------------------------------------------------------

function PriceBarChart({ categoryKey }: { categoryKey: string }) {
  const data = PRICE_DATA[categoryKey]
  if (!data) return null

  const maxPrice = Math.max(...Object.values(data).flat())
  const barColors = {
    small: "from-emerald-400 to-emerald-500",
    medium: "from-teal-400 to-teal-500",
    large: "from-emerald-600 to-emerald-700",
  }

  return (
    <div className="mt-6 space-y-3">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Comparativo de preços médios
      </p>
      <div className="space-y-2.5">
        {(["small", "medium", "large"] as ScopeKey[]).map((scope) => {
          const [min, max] = data[scope]
          const widthMin = (min / maxPrice) * 100
          const widthMax = (max / maxPrice) * 100
          const scopeLabel = SCOPES.find((s) => s.key === scope)?.label ?? scope

          return (
            <div key={scope} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">{scopeLabel}</span>
                <span className="font-semibold text-foreground">
                  R$ {min} – R$ {max}
                </span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted/50">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${widthMax}%` }}
                  transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r",
                    barColors[scope],
                  )}
                />
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${widthMin}%` }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                  className="absolute inset-y-0 left-0 rounded-full bg-background/30"
                  style={{ width: `${widthMin}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Animated price display
// ---------------------------------------------------------------------------

function AnimatedPrice({ value, label }: { value: number; label: string }) {
  const { ref, value: animated } = useCountUp(value, {
    duration: 1200,
    decimals: 0,
  })

  return (
    <div className="text-center">
      <span ref={ref} className="text-3xl font-extrabold tabular-nums text-primary sm:text-4xl">
        R$ {animated.toLocaleString("pt-BR")}
      </span>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number
  totalSteps: number
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => (
        <React.Fragment key={i}>
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
              i < currentStep
                ? "bg-gradient-to-r from-primary to-emerald-600 text-white shadow-md shadow-primary/20"
                : i === currentStep
                  ? "border-2 border-primary bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < currentStep ? "✓" : i + 1}
          </div>
          {i < totalSteps - 1 && (
            <div
              className={cn(
                "h-0.5 w-8 rounded-full transition-all duration-300",
                i < currentStep ? "bg-primary" : "bg-muted",
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function QuickQuoteCalculator() {
  const { ref: sectionRef, visible } = useScrollReveal<HTMLElement>({
    threshold: 0.1,
    once: true,
  })

  const [step, setStep] = React.useState(0) // 0, 1, 2
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null)
  const [selectedScope, setSelectedScope] = React.useState<ScopeKey | null>(null)
  const [priceKey, setPriceKey] = React.useState(0) // for re-triggering count animation

  const openQuote = useUIStore((s) => s.openQuote)

  // Calculate price when both category and scope are selected
  const priceRange = React.useMemo(() => {
    if (!selectedCategory || !selectedScope) return null
    return PRICE_DATA[selectedCategory]?.[selectedScope] ?? null
  }, [selectedCategory, selectedScope])

  const handleCategorySelect = React.useCallback((key: string) => {
    setSelectedCategory(key)
    setStep(1)
  }, [])

  const handleScopeSelect = React.useCallback((scope: ScopeKey) => {
    setSelectedScope(scope)
    setPriceKey((k) => k + 1)
    setStep(2)
  }, [])

  const handleBack = React.useCallback(() => {
    if (step === 1) {
      setSelectedCategory(null)
      setStep(0)
    } else if (step === 2) {
      setSelectedScope(null)
      setStep(1)
    }
  }, [step])

  const handleReset = React.useCallback(() => {
    setSelectedCategory(null)
    setSelectedScope(null)
    setStep(0)
  }, [])

  const handleRequestQuote = React.useCallback(() => {
    openQuote({ providerId: "" }) // Opens quote modal flow
  }, [openQuote])

  const selectedCategoryConfig = CATEGORIES.find((c) => c.key === selectedCategory)

  return (
    <section
      id="simulador"
      ref={sectionRef}
      className="relative overflow-hidden bg-gradient-to-b from-muted/30 to-background py-16 sm:py-24"
    >
      {/* Background decoration */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 50%, rgba(16,185,129,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(20,184,166,0.06) 0%, transparent 50%)",
        }}
      />

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center"
        >
          <Badge
            variant="secondary"
            className="mb-4 gap-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          >
            <Calculator className="size-3.5" />
            Simulador de preços
          </Badge>
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">
            Quanto custa?{" "}
            <span className="bg-gradient-to-r from-primary to-teal-500 bg-clip-text text-transparent">
              Simule agora
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Estime o valor do serviço em 3 passos rápidos. Sem compromisso, sem cadastro.
          </p>
        </motion.div>

        {/* ── Step indicator ─────────────────────────────────────────────── */}
        <StepIndicator currentStep={step} totalSteps={3} />

        {/* ── Steps content ──────────────────────────────────────────────── */}
        <Card className="mt-8 overflow-hidden border-0 shadow-xl shadow-primary/5">
          <CardContent className="p-0">
            <AnimatePresence mode="wait">
              {/* ── Step 1: Select service type ───────────────────────────── */}
              {step === 0 && (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, x: 60 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -60 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="p-6 sm:p-8"
                >
                  <h3 className="mb-1 text-lg font-bold">
                    1. Qual serviço você precisa?
                  </h3>
                  <p className="mb-6 text-sm text-muted-foreground">
                    Selecione a categoria do serviço
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {CATEGORIES.map((cat) => {
                      const Icon = cat.icon
                      const isActive = selectedCategory === cat.key
                      return (
                        <motion.button
                          key={cat.key}
                          type="button"
                          onClick={() => handleCategorySelect(cat.key)}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          className={cn(
                            "group flex flex-col items-center gap-2.5 rounded-2xl border-2 p-4 text-center transition-all duration-200",
                            isActive
                              ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                              : "border-transparent bg-muted/30 hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-12 items-center justify-center rounded-xl transition-all duration-200",
                              isActive
                                ? "bg-gradient-to-br from-primary to-emerald-600 shadow-md shadow-primary/20"
                                : "bg-muted group-hover:bg-primary/10",
                            )}
                          >
                            <Icon
                              className={cn(
                                "size-6 transition-colors",
                                isActive ? "text-white" : "text-muted-foreground group-hover:text-primary",
                              )}
                            />
                          </span>
                          <span
                            className={cn(
                              "text-sm font-semibold transition-colors",
                              isActive ? "text-primary" : "text-foreground/70 group-hover:text-foreground",
                            )}
                          >
                            {cat.label}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </motion.div>
              )}

              {/* ── Step 2: Describe scope ────────────────────────────────── */}
              {step === 1 && (
                <motion.div
                  key="step-2"
                  initial={{ opacity: 0, x: 60 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -60 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="p-6 sm:p-8"
                >
                  <div className="mb-4 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBack}
                      className="gap-1 text-muted-foreground"
                      aria-label="Voltar ao passo anterior"
                    >
                      <ChevronLeft className="size-4" />
                      Voltar
                    </Button>
                  </div>
                  <h3 className="mb-1 text-lg font-bold">
                    2. Qual o tamanho do serviço?
                  </h3>
                  <p className="mb-6 text-sm text-muted-foreground">
                    <span className="font-medium text-primary">
                      {selectedCategoryConfig?.label}
                    </span>{" "}
                    — selecione o escopo
                  </p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {SCOPES.map((scope) => {
                      const isActive = selectedScope === scope.key
                      return (
                        <motion.button
                          key={scope.key}
                          type="button"
                          onClick={() => handleScopeSelect(scope.key)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                          className={cn(
                            "group relative flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all duration-200",
                            isActive
                              ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                              : "border-transparent bg-muted/30 hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm",
                          )}
                        >
                          <span className="text-2xl">{scope.emoji}</span>
                          <span
                            className={cn(
                              "text-base font-bold transition-colors",
                              isActive ? "text-primary" : "text-foreground/80 group-hover:text-foreground",
                            )}
                          >
                            {scope.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {scope.description}
                          </span>
                          {isActive && (
                            <motion.div
                              layoutId="scope-indicator"
                              className="absolute inset-0 rounded-2xl border-2 border-primary"
                              transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                          )}
                        </motion.button>
                      )
                    })}
                  </div>
                </motion.div>
              )}

              {/* ── Step 3: Price estimate ────────────────────────────────── */}
              {step === 2 && priceRange && (
                <motion.div
                  key="step-3"
                  initial={{ opacity: 0, x: 60 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -60 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="p-6 sm:p-8"
                >
                  <div className="mb-4 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBack}
                      className="gap-1 text-muted-foreground"
                      aria-label="Voltar ao passo anterior"
                    >
                      <ChevronLeft className="size-4" />
                      Voltar
                    </Button>
                  </div>
                  <h3 className="mb-1 text-lg font-bold">
                    3. Estimativa de preço
                  </h3>
                  <p className="mb-6 text-sm text-muted-foreground">
                    <span className="font-medium text-primary">
                      {selectedCategoryConfig?.label}
                    </span>{" "}
                    •{" "}
                    <span className="font-medium text-primary">
                      {SCOPES.find((s) => s.key === selectedScope)?.label}
                    </span>
                  </p>

                  {/* Price display */}
                  <div className="mb-8 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 p-8 dark:from-emerald-950/30 dark:to-teal-950/30">
                    <div className="flex items-center justify-center gap-4 sm:gap-6">
                      <div key={`min-${priceKey}`}>
                        <AnimatedPrice value={priceRange[0]} label="Valor mínimo estimado" />
                      </div>
                      <span className="text-2xl font-light text-muted-foreground">—</span>
                      <div key={`max-${priceKey}`}>
                        <AnimatedPrice value={priceRange[1]} label="Valor máximo estimado" />
                      </div>
                    </div>

                    {/* Price comparison chart */}
                    {selectedCategory && <PriceBarChart categoryKey={selectedCategory} />}
                  </div>

                  {/* Disclaimer (H5/H10) */}
                  <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200/60 bg-amber-50/50 p-4 dark:border-amber-800/30 dark:bg-amber-950/20">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Valores são apenas estimativas baseadas em médias de mercado. O orçamento
                      final pode variar conforme a complexidade, materiais e região. Solicite um
                      orçamento real para um valor preciso.
                    </p>
                  </div>

                  {/* CTA + reset */}
                  <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                    <Button
                      size="lg"
                      onClick={handleRequestQuote}
                      className="gap-2 rounded-xl bg-gradient-to-r from-primary to-emerald-600 px-8 font-bold shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:brightness-110"
                    >
                      Pedir orçamento real
                      <ArrowRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={handleReset}
                      className="gap-2 rounded-xl"
                    >
                      Simular outro serviço
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
