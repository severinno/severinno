"use client"

import * as React from "react"

export function ConviteClientTracker({ code }: { code: string }) {
  React.useEffect(() => {
    if (!code) return
    try {
      localStorage.setItem("severinno_referral_code", code)
      document.cookie = `severinno_referral_code=${encodeURIComponent(code)}; path=/; max-age=2592000; SameSite=Lax`
    } catch {
      // Storage unavailable or disabled
    }
  }, [code])

  return null
}
