"use client"

/**
 * OnboardingChecklist — guides new clients to complete their profile.
 *
 * Nielsen heuristics:
 *   H5  Prevenção de erros  → incomplete profile prevents bad quotes
 *   H6  Reconhecimento      → visible progress bar + checklist items
 *   H7  Eficiência          → direct links to complete each step
 *   H1  Visibilidade status → % complete + remaining steps
 *
 * Trust/Professionalism: a complete profile builds confidence with providers
 * and enables accurate quotes (address, contact, photo).
 */

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Camera, CheckCircle2, MapPin, Phone, Sparkles, User } from "lucide-react"
import { motion } from "framer-motion"

import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { apiGet } from "@/lib/api"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type ProfileData = {
  name?: string | null
  avatarUrl?: string | null
  whatsapp?: string | null
  cep?: string | null
  street?: string | null
  number?: string | null
  city?: string | null
}

type Step = {
  key: keyof ProfileData
  label: string
  description: string
  icon: React.ReactNode
  actionView: string
  done: boolean
}

// ---------------------------------------------------------------------------
// Etapas visitadas (clicadas e voltaram sem concluir) — sobrevive a remounts
// (o checklist desmonta ao navegar para o perfil) via sessionStorage.
// ---------------------------------------------------------------------------
const VISITED_KEY = "onboarding-checklist:visited"

function readVisitedSteps(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.sessionStorage.getItem(VISITED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? new Set(parsed.filter((k): k is string => typeof k === "string"))
      : new Set()
  } catch {
    return new Set()
  }
}

function markStepVisited(key: string): void {
  if (typeof window === "undefined") return
  try {
    const visited = readVisitedSteps()
    visited.add(key)
    window.sessionStorage.setItem(VISITED_KEY, JSON.stringify([...visited]))
  } catch {
    // sessionStorage indisponível — apenas ignora (estado visual efêmero)
  }
}

export function OnboardingChecklist() {
  const { user } = useAuthStore()
  const navigate = useViewStore((s) => s.navigate)
  const _qc = useQueryClient()
  // Etapas clicadas e não concluídas — borda tracejada no stepper (diferente
  // das nunca visitadas).
  const [visitedSteps, setVisitedSteps] = React.useState<Set<string>>(() => readVisitedSteps())

  const openStep = React.useCallback(
    (step: Step) => {
      setVisitedSteps((prev) => {
        if (prev.has(step.key)) return prev
        const next = new Set(prev)
        next.add(step.key)
        return next
      })
      markStepVisited(step.key)
      navigate(step.actionView)
    },
    [navigate],
  )

  // Fetch the user's full profile to determine completion.
  // /api/users/me responde { user: {...} } — desembrulha (e tolera payload plano).
  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ["onboarding-profile", user?.id],
    queryFn: async () => {
      const res = await apiGet<{ user?: ProfileData } | ProfileData>("/api/users/me")
      if (res && typeof res === "object" && "user" in res && res.user) return res.user
      return res as ProfileData
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  })

  if (isLoading || !profile) return null

  const steps: Step[] = [
    {
      key: "name",
      label: "Nome completo",
      description: "Como você quer ser chamado(a)",
      icon: <User className="size-4" />,
      actionView: "client.profile",
      done: !!profile.name && profile.name.trim().length > 1,
    },
    {
      key: "avatarUrl",
      label: "Foto de perfil",
      description: "Prestadores veem quem você é",
      icon: <Camera className="size-4" />,
      actionView: "client.profile",
      done: !!profile.avatarUrl,
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      description: "Para os prestadores entrarem em contato",
      icon: <Phone className="size-4" />,
      actionView: "client.profile",
      done: !!profile.whatsapp && profile.whatsapp.replace(/\D/g, "").length >= 10,
    },
    {
      key: "cep",
      label: "Endereço",
      description: "CEP + número para orçamentos precisos",
      icon: <MapPin className="size-4" />,
      actionView: "client.profile",
      done: !!profile.cep && !!profile.number,
    },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const totalCount = steps.length
  const pct = Math.round((completedCount / totalCount) * 100)
  const isComplete = completedCount === totalCount
  const initials = (profile.name ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase()

  // Don't show the checklist once everything is done
  if (isComplete) return null

  return (
    <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 dark:border-emerald-900 dark:from-emerald-950/40 dark:to-teal-950/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <Sparkles className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">Complete seu perfil</CardTitle>
              <p className="text-muted-foreground text-xs">
                {completedCount} de {totalCount} passos · {pct}%
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{pct}%</span>
        </div>
        {/* Resumo com foto — mesmo padrão do onboarding do prestador */}
        <div className="mt-2 flex items-center gap-2.5">
          {profile.avatarUrl ? (
            // <img> de propósito: a URL pode vir de host sem remotePattern
            // configurado (MinIO assinado); o <Image> do next reprovaria no
            // runtime. Preview de 40px não se beneficia do otimizador.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt="Sua foto de perfil"
              className="size-10 shrink-0 rounded-full object-cover ring-2 ring-emerald-600/25"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
            >
              {initials || "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{profile.name || "Novo(a) por aqui?"}</p>
            <p className="text-muted-foreground truncate text-xs">
              Perfil completo gera confiança e orçamentos precisos.
            </p>
          </div>
        </div>
        {/* Stepper segmentado — um segmento por etapa (mesmo padrão do
            prestador). Concluído vira botão que reabre o perfil para revisar. */}
        <div
          role="progressbar"
          className="sr-only mt-3"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={completedCount}
          aria-label={`${completedCount} de ${totalCount} etapas concluídas`}
        />
        <div className="mt-3 flex gap-1.5">
          {steps.map((s, i) => {
            const isCurrent = i === completedCount
            // Visitada mas não concluída: o usuário já abriu esta etapa
            // (clicou no card) e voltou sem completá-la.
            const isVisited = visitedSteps.has(s.key)
            const segment = cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-300",
              s.done
                ? "bg-emerald-600"
                : isCurrent
                  ? "animate-pulse bg-emerald-500"
                  : isVisited
                    ? "border border-dashed border-amber-600/70 bg-amber-100/70 dark:border-amber-400/60 dark:bg-amber-900/30"
                    : "bg-emerald-900/15 dark:bg-emerald-100/20",
            )
            if (!s.done) {
              return (
                <span
                  key={s.key}
                  aria-hidden
                  data-step-key={s.key}
                  data-visited={isVisited ? "true" : undefined}
                  title={
                    isVisited
                      ? `Você já abriu ${s.label.toLowerCase()} — ainda não concluído`
                      : undefined
                  }
                  className={segment}
                />
              )
            }
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => navigate(s.actionView)}
                aria-label={`Revisar ${s.label.toLowerCase()} no perfil`}
                title={`Revisar ${s.label.toLowerCase()}`}
                className={cn(
                  segment,
                  "cursor-pointer hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
                )}
              />
            )
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <p className="text-muted-foreground mb-2 text-xs">
          Um perfil completo ajuda os prestadores a enviarem orçamentos precisos e aumenta sua
          confiança.
        </p>
        {steps.map((step, i) => (
          <motion.div
            key={step.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
          >
            <button
              type="button"
              onClick={() => openStep(step)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all hover:shadow-sm",
                step.done
                  ? "border-emerald-200 bg-white/60 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : visitedSteps.has(step.key)
                    ? "border-amber-300 bg-white hover:border-amber-400 dark:border-amber-800 dark:bg-slate-900"
                    : "border-slate-200 bg-white hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  step.done
                    ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-400 dark:bg-slate-800",
                )}
              >
                {step.done ? <CheckCircle2 className="size-4" /> : step.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.label}
                </p>
                <p className="text-muted-foreground text-xs">{step.description}</p>
              </div>
              {!step.done && <ArrowRight className="text-muted-foreground size-4 shrink-0" />}
            </button>
          </motion.div>
        ))}

        {/* Sound & vibration preferences */}
        <div className="mt-4 space-y-2 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium">Preferências</p>
          <PreferenceToggles variant="compact" />
        </div>
      </CardContent>
    </Card>
  )
}
