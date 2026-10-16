"use client"

import * as React from "react"
import { CheckCircle2, Star, MapPin, X, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface ActivityNotification {
  id: string
  userName: string
  action: string
  serviceTitle: string
  timeAgo: string
  type: "booking" | "review" | "completed"
  rating?: number
}

const BASE_ACTIVITIES: ActivityNotification[] = [
  {
    id: "act-1",
    userName: "Mariana S.",
    action: "agendou",
    serviceTitle: "Eletricista Residencial",
    timeAgo: "há 3 min",
    type: "booking",
  },
  {
    id: "act-2",
    userName: "Carlos M.",
    action: "avaliou",
    serviceTitle: "Climatização & Ar",
    timeAgo: "há 7 min",
    type: "review",
    rating: 5.0,
  },
  {
    id: "act-3",
    userName: "Fernanda L.",
    action: "aprovou orçamento para",
    serviceTitle: "Caça-Vazamentos",
    timeAgo: "há 11 min",
    type: "booking",
  },
  {
    id: "act-4",
    userName: "Rodrigo P.",
    action: "concluiu serviço com",
    serviceTitle: "Chaveiro 24h",
    timeAgo: "há 15 min",
    type: "completed",
    rating: 5.0,
  },
  {
    id: "act-5",
    userName: "Juliana R.",
    action: "contratou",
    serviceTitle: "Montador de Móveis",
    timeAgo: "há 19 min",
    type: "booking",
  },
]

const DISMISS_KEY = "severinno_social_proof_dismissed"

export function LiveSocialProofToast() {
  const regional = useRegionalContext()
  const context = regional?.context
  const rawNeighborhoods = context?.neighborhoods
  const neighborhoods = React.useMemo(() => {
    return rawNeighborhoods && rawNeighborhoods.length > 0
      ? rawNeighborhoods
      : ["Centro", "Ilha dos Araújos", "Grã-Duquesa", "São Pedro", "Esplanada"]
  }, [rawNeighborhoods])

  const [currentIndex, setCurrentIndex] = React.useState<number>(0)
  const [isVisible, setIsVisible] = React.useState<boolean>(false)
  const [isDismissed, setIsDismissed] = React.useState<boolean>(false)
  const [isPaused, setIsPaused] = React.useState<boolean>(false)

  // Checar se já foi fechado pelo usuário nesta sessão
  React.useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          if (window.sessionStorage.getItem(DISMISS_KEY) === "true") {
            setIsDismissed(true)
            return
          }
        }
        // Primeira aparição após 4 segundos
        setIsVisible(true)
      } catch {
        // Ignora erros de storage
      }
    }, 4000)

    return () => clearTimeout(timer)
  }, [])

  // Ciclo de rotação: 5s visível, 15s oculto
  React.useEffect(() => {
    if (isDismissed || isPaused) return

    let hideTimer: NodeJS.Timeout
    let nextTimer: NodeJS.Timeout

    if (isVisible) {
      hideTimer = setTimeout(() => {
        setIsVisible(false)
      }, 5500)
    } else {
      nextTimer = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % BASE_ACTIVITIES.length)
        setIsVisible(true)
      }, 16000)
    }

    return () => {
      clearTimeout(hideTimer)
      clearTimeout(nextTimer)
    }
  }, [isVisible, isDismissed, isPaused])

  const handleDismiss = () => {
    setIsVisible(false)
    setIsDismissed(true)
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(DISMISS_KEY, "true")
      }
    } catch {
      // Ignora erro de storage
    }
  }

  if (isDismissed || !isVisible) {
    return null
  }

  const currentItem = BASE_ACTIVITIES[currentIndex] || BASE_ACTIVITIES[0]
  const currentNeighborhood = neighborhoods[currentIndex % neighborhoods.length] || "Centro"

  return (
    <aside
      aria-label="Atividade recente na plataforma"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={cn(
        "border-primary/20 bg-background/95 fixed bottom-20 left-4 z-30 flex max-w-xs items-center gap-3 rounded-2xl border p-3 shadow-lg backdrop-blur-md transition-all duration-300 sm:bottom-6 sm:left-6 sm:max-w-sm",
        isVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {currentItem.type === "review" ? (
          <Star className="size-4 fill-amber-400 text-amber-500" />
        ) : currentItem.type === "completed" ? (
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Sparkles className="text-primary size-4" />
        )}
      </div>

      <div className="min-w-0 flex-1 pr-1">
        <p className="text-foreground text-xs leading-snug">
          <strong className="font-semibold">{currentItem.userName}</strong>{" "}
          <span className="text-muted-foreground">{currentItem.action}</span>{" "}
          <span className="text-primary font-medium">{currentItem.serviceTitle}</span>
        </p>
        <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-0.5 truncate">
            <MapPin className="text-muted-foreground/70 size-3" />
            {currentNeighborhood}
          </span>
          <span>•</span>
          <span>{currentItem.timeAgo}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dispensar notificação de atividade"
        className="text-muted-foreground/60 hover:bg-muted hover:text-foreground focus-visible:ring-primary shrink-0 rounded-full p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-3.5" />
      </button>
    </aside>
  )
}
