"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { WifiOff, CheckCircle2 } from "lucide-react"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export function OfflineAmbientBanner({ className }: { className?: string }) {
  const isOnline = useOnlineStatus()
  const [showReconnected, setShowReconnected] = React.useState(false)
  const prevOnlineRef = React.useRef(isOnline)

  React.useEffect(() => {
    // Detect reconnection transition from offline -> online
    if (!prevOnlineRef.current && isOnline) {
      setShowReconnected(true)
      triggerHaptic("success")
      const timer = setTimeout(() => {
        setShowReconnected(false)
      }, 3500)
      return () => clearTimeout(timer)
    }

    if (prevOnlineRef.current && !isOnline) {
      triggerHaptic("warning")
    }

    prevOnlineRef.current = isOnline
  }, [isOnline])

  const showBanner = !isOnline || showReconnected

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "pointer-events-none fixed top-3 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center justify-center px-4 sm:max-w-md",
            className,
          )}
          role="status"
          aria-live="polite"
        >
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-2.5 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-md transition-all",
              !isOnline
                ? "border-amber-300/80 bg-amber-500/95 text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/95 dark:text-amber-100"
                : "border-emerald-300/80 bg-emerald-600/95 text-white dark:border-emerald-700/80 dark:bg-emerald-950/95 dark:text-emerald-100",
            )}
          >
            {!isOnline ? (
              <>
                <span className="relative flex size-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-900 opacity-75 dark:bg-amber-200" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-amber-900 dark:bg-amber-200" />
                </span>
                <WifiOff className="size-4 shrink-0" />
                <span className="truncate">Modo Offline &middot; Ações serão sincronizadas</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 shrink-0 text-white dark:text-emerald-300" />
                <span className="truncate">Conexão restabelecida &middot; Sincronizando</span>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
