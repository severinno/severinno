"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export function ConviteClientTracker({
  code,
  intentType = "client",
}: {
  code: string
  intentType?: string
}) {
  React.useEffect(() => {
    if (!code) return
    try {
      localStorage.setItem("severinno_referral_code", code)
      localStorage.setItem("severinno_referral_intent", intentType)
      document.cookie = `severinno_referral_code=${encodeURIComponent(code)}; path=/; max-age=2592000; SameSite=Lax`
      document.cookie = `severinno_referral_intent=${encodeURIComponent(intentType)}; path=/; max-age=2592000; SameSite=Lax`
    } catch {
      // Storage unavailable or disabled
    }
  }, [code, intentType])

  return null
}

export function ConviteCodeCopyBadge({
  code,
  isProvider = false,
}: {
  code: string
  isProvider?: boolean
}) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    triggerHaptic("success")
    setCopied(true)
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {})
    }
    toast.success(`Código ${code} copiado!`)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copiar código de convite ${code}`}
      title="Toque para copiar o código"
      className={cn(
        "group inline-flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-6 py-2.5 font-mono text-2xl font-black tracking-widest transition-all active:scale-95 sm:text-3xl",
        isProvider
          ? "border-amber-500/40 bg-amber-500/5 text-amber-600 hover:border-amber-500/70 hover:bg-amber-500/10 dark:text-amber-400"
          : "border-primary/40 bg-primary/5 text-primary hover:border-primary/70 hover:bg-primary/10",
      )}
    >
      <span>{code}</span>
      {copied ? (
        <Check className="size-5 shrink-0 text-emerald-600 transition-transform" />
      ) : (
        <Copy className="size-4.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  )
}
