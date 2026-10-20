"use client"

import * as React from "react"

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
