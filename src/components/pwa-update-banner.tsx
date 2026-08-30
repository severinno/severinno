"use client"

/**
 * PwaUpdateBanner — Shows a banner when a new SW version is available.
 *
 * Renders a subtle top banner with "Update available" + reload button.
 * Auto-hides after 30s if user doesn't interact.
 */

import { useEffect, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { RefreshCw, X } from "lucide-react"

type Props = {
  visible: boolean
  onUpdate: () => void
}

export default function PwaUpdateBanner({ visible, onUpdate }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [autoHide, setAutoHide] = useState(false)

  // Auto-hide after 30s
  useEffect(() => {
    if (!visible || dismissed) return
    const timer = setTimeout(() => setAutoHide(true), 30_000)
    return () => clearTimeout(timer)
  }, [visible, dismissed])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  if (dismissed || autoHide) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-emerald-600 text-white"
          role="alert"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-2">
            <RefreshCw className="size-4 animate-spin" />
            <span className="text-sm font-medium">
              Nova versão disponível!
            </span>
            <button
              onClick={onUpdate}
              className="rounded-lg bg-white/20 px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-white/30"
            >
              Atualizar
            </button>
            <button
              onClick={handleDismiss}
              className="ml-1 flex size-5 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white"
              aria-label="Dispensar"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
