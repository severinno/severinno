"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { WifiOff, CheckCircle2 } from "lucide-react"
import { triggerHaptic } from "@/lib/haptics"

export default function NetworkStatusIndicator() {
  const [isOnline, setIsOnline] = React.useState(true)
  const [showRestored, setShowRestored] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const handleOffline = () => {
      setIsOnline(false)
      setShowRestored(false)
      triggerHaptic("warning")
    }

    const handleOnline = () => {
      setIsOnline(true)
      setShowRestored(true)
      triggerHaptic("success")
      window.setTimeout(() => {
        setShowRestored(false)
      }, 3500)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  const isVisible = !isOnline || showRestored

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", stiffness: 350, damping: 25 }}
          className="pointer-events-none fixed top-3 left-1/2 z-[70] -translate-x-1/2 px-4"
        >
          <div
            className={
              !isOnline
                ? "flex items-center gap-2.5 rounded-full border border-amber-300/70 bg-amber-50/95 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-md dark:border-amber-700/60 dark:bg-amber-950/90 dark:text-amber-200"
                : "flex items-center gap-2.5 rounded-full border border-emerald-300/70 bg-emerald-50/95 px-4 py-2 text-xs font-semibold text-emerald-900 shadow-lg backdrop-blur-md dark:border-emerald-700/60 dark:bg-emerald-950/90 dark:text-emerald-200"
            }
          >
            {!isOnline ? (
              <>
                <span className="flex size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
                <WifiOff className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Você está offline. Exibindo dados salvos em cache local.</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>Conexão restabelecida!</span>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
