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

import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { apiGet } from "@/lib/api"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
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

export function OnboardingChecklist() {
  const { user } = useAuthStore()
  const navigate = useViewStore((s) => s.navigate)
  const _qc = useQueryClient()

  // Fetch the user's full profile to determine completion
  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ["onboarding-profile", user?.id],
    queryFn: () => apiGet<ProfileData>("/api/users/me"),
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
        <Progress
          value={pct}
          className="mt-2 h-2 [&>div]:bg-emerald-600"
          aria-label={`${pct}% concluído`}
        />
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <p className="text-muted-foreground mb-2 text-xs">
          Um perfil completo ajuda os prestadores a enviarem orçamentos precisos e aumenta sua
          confiança.
        </p>
        {steps.map((step) => (
          <button
            key={step.key}
            type="button"
            onClick={() => navigate(step.actionView)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all hover:shadow-sm",
              step.done
                ? "border-emerald-200 bg-white/60 dark:border-emerald-900 dark:bg-emerald-950/20"
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
