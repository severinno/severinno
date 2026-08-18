"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Sparkles, X } from "lucide-react"
import { apiGet } from "@/lib/api"

type ProvidersCountResponse = {
  total: number
}

export function WelcomeToast({ onDismiss }: { onDismiss: () => void }) {
  const [providerCount, setProviderCount] = React.useState<number | null>(null)

  React.useEffect(() => {
    apiGet<ProvidersCountResponse>("/api/providers", { limit: 1 })
      .then((data) => {
        if (data && typeof data.total === "number") {
          setProviderCount(data.total)
        }
      })
      .catch(() => {
        setProviderCount(120)
      })
  }, [])

  // Auto-dismiss after 8 seconds
  React.useEffect(() => {
    const t = window.setTimeout(onDismiss, 8000)
    return () => window.clearTimeout(t)
  }, [onDismiss])

  return (
    <motion.div
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -100, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed top-4 left-1/2 z-[60] -translate-x-1/2"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-3 shadow-lg shadow-emerald-500/10 dark:border-emerald-800/40 dark:from-emerald-950/90 dark:to-teal-950/90 dark:shadow-emerald-500/5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md shadow-emerald-500/20">
          <Sparkles className="size-4 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Bem-vindo ao Severinno!
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {providerCount !== null
              ? `${providerCount} prestadores disponíveis na sua região`
              : "Carregando…"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 flex size-6 shrink-0 items-center justify-center rounded-full text-emerald-500 transition-colors hover:bg-emerald-200/50 hover:text-emerald-700 dark:hover:bg-emerald-800/50 dark:hover:text-emerald-300"
          aria-label="Dispensar notificação"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </motion.div>
  )
}
