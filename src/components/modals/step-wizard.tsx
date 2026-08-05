"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepDef = {
  id: number
  label: string
  shortLabel?: string
  icon?: React.ComponentType<{ className?: string }>
}

export type StepWizardProps = {
  steps: StepDef[]
  currentStep: number
  /** Steps that are completed (show green check) */
  validSteps: Record<number, boolean>
  onStepClick: (stepId: number) => void
  /** Show "Back" button — auto-hidden on step 1 */
  onBack?: () => void
  /** Primary CTA label for non-final steps */
  nextLabel?: string
  /** Final step CTA */
  submitLabel?: React.ReactNode
  /** Whether the current step is valid (enables Next button) */
  currentStepValid?: boolean
  onSubmit?: () => void
  onNext?: () => void
  submitting?: boolean
  /** Step content — keyed by step id */
  children: React.ReactNode
  className?: string
}

// ---------------------------------------------------------------------------
// StepWizard — Shared step-by-step wizard layout
// ---------------------------------------------------------------------------
// Nielsen Heuristics applied:
// #1  Visibility of system status → clear step indicator + progress bar
// #3  User control & freedom → back button + clickable completed steps
// #4  Consistency & standards → shared component for both flows
// #8  Minimalist design → one task per step, clean layout
// ---------------------------------------------------------------------------

export function StepWizard({
  steps,
  currentStep,
  validSteps,
  onStepClick,
  onBack,
  nextLabel = "Continuar",
  submitLabel,
  currentStepValid = true,
  onSubmit,
  onNext,
  submitting = false,
  children,
  className,
}: StepWizardProps) {
  const isFirst = currentStep === steps[0]?.id
  const isLast = currentStep === steps[steps.length - 1]?.id
  const completedCount = steps.filter((s) => validSteps[s.id]).length
  const progressPct = (completedCount / steps.length) * 100

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* ── Step Indicator Bar ── */}
      <div className="shrink-0 border-b px-4 py-3 sm:px-5">
        {/* Step circles + labels */}
        <div className="flex items-center justify-between">
          {steps.map((s, i) => {
            const active = currentStep === s.id
            const done = validSteps[s.id] && currentStep > s.id
            const Icon = s.icon
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => onStepClick(s.id)}
                  disabled={!done && s.id > currentStep}
                  className={cn(
                    "focus-visible:ring-ring flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "font-semibold text-emerald-700 dark:text-emerald-400"
                      : done
                        ? "cursor-pointer text-emerald-600 hover:text-emerald-700"
                        : "text-muted-foreground cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all",
                      active &&
                        "border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/25",
                      done && "cursor-pointer border-emerald-600 bg-emerald-600 text-white",
                      !active && !done && "border-muted-foreground/20 text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <Check className="size-3.5" />
                    ) : Icon ? (
                      <Icon className="size-3.5" />
                    ) : (
                      s.id
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.shortLabel ?? s.label}</span>
                </button>
                {i < steps.length - 1 && (
                  <div className="bg-muted-foreground/15 relative mx-1 h-px flex-1 sm:mx-2">
                    <div
                      className="absolute inset-0 origin-left bg-emerald-500 transition-transform duration-300"
                      style={{
                        transform:
                          validSteps[steps[i + 1]?.id] || currentStep > s.id
                            ? "scaleX(1)"
                            : currentStep === s.id && validSteps[s.id]
                              ? "scaleX(0.5)"
                              : "scaleX(0)",
                      }}
                    />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>

        {/* Thin progress bar — Nielsen #1: visibility of system status */}
        <div className="bg-muted-foreground/10 mt-2.5 h-1 w-full overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(progressPct, (currentStep / steps.length) * 100)}%` }}
          />
        </div>
      </div>

      {/* ── Step Content ── */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-4 sm:px-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* ── Sticky Footer — Nielsen #3: user control & freedom ── */}
      <div className="bg-background/95 sticky bottom-0 shrink-0 border-t px-4 py-2.5 backdrop-blur sm:px-5">
        <div className="flex items-center justify-between gap-2">
          {/* Back button */}
          {!isFirst ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={submitting}
              className="text-muted-foreground hover:text-foreground h-9 gap-1"
            >
              <ChevronLeft className="size-4" />
              Voltar
            </Button>
          ) : (
            <div />
          )}

          {/* Primary CTA */}
          {!isLast ? (
            <Button
              type="button"
              size="sm"
              onClick={onNext}
              disabled={!currentStepValid}
              className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              {nextLabel}
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={submitting || !currentStepValid}
              className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              {submitLabel ?? "Confirmar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StepHeader — Consistent step title + description pattern
// ---------------------------------------------------------------------------

export function StepHeader({
  title,
  description,
  icon: Icon,
  className,
}: {
  title: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  return (
    <div className={cn("mb-4", className)}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {Icon && <Icon className="size-4 text-emerald-600" />}
        {title}
      </h3>
      {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ValidationHint — Inline field validation feedback
// Nielsen #9: help users recognize, diagnose, and recover from errors
// ---------------------------------------------------------------------------

export function ValidationHint({
  ok,
  error,
  touched,
}: {
  ok?: boolean
  error?: string
  touched?: boolean
}) {
  if (!touched) return null
  if (error) {
    return <p className="text-destructive mt-1 text-xs">{error}</p>
  }
  if (ok) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
        <Check className="size-3" /> OK
      </p>
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// InfoCard — Compact info display card
// ---------------------------------------------------------------------------

export function InfoCard({
  children,
  className,
  variant = "default",
}: {
  children: React.ReactNode
  className?: string
  variant?: "default" | "emerald"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        variant === "emerald"
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
          : "bg-card",
        className,
      )}
    >
      {children}
    </div>
  )
}
