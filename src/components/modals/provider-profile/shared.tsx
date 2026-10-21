import * as React from "react"

/**
 * Utility to decode escaped HTML entities like &quot;, &#39;, &lt;, &gt;, &amp;
 */
export function decodeEntities(str?: string | null): string {
  if (!str) return ""
  let decoded = str
  while (decoded.includes("&amp;")) {
    decoded = decoded.replace(/&amp;/g, "&")
  }
  return decoded
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

/**
 * Standard empty state card for provider tabs
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="bg-muted text-muted-foreground rounded-xl p-3">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 max-w-xs text-[11px]">{description}</p>
      </div>
    </div>
  )
}

/**
 * Deterministic quick slots based on provider ID seed
 */
export function getQuickSlotsForProvider(providerId?: string) {
  const seed = (providerId || "prov").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const hours = ["09:00", "10:30", "14:00", "15:30", "17:00"]
  const h1 = hours[seed % hours.length]
  const h2 = hours[(seed + 2) % hours.length]
  return [
    { label: `Hoje ${h1}`, isToday: true },
    { label: `Amanhã ${h2}`, isToday: false },
  ]
}
