"use client"

/**
 * AnimatedProviderPin — Custom MapLibre marker with animated status dot.
 *
 * Features:
 * - Pill-shaped price/rating chip (Airbnb-style)
 * - Animated pulsing dot for online status
 * - Scale animation on hover/selection
 * - Verified badge
 * - Category color coding
 */

import { formatBRL } from "@/lib/format"
import type { ProviderCard } from "@/lib/api"

type StatusLevel = "online" | "recent" | "away" | "offline"

function getStatusLevel(provider: ProviderCard): StatusLevel {
  if (provider.memberSince) {
    const diff = Date.now() - new Date(provider.memberSince).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 5) return "online"
    if (minutes < 60) return "recent"
    if (minutes < 1440) return "away"
  }
  return "offline"
}


type Props = {
  provider: ProviderCard
  isSelected?: boolean
  onSelect?: (id: string) => void
}

export function createAnimatedPinElement(props: Props): HTMLButtonElement {
  const { provider, isSelected, onSelect } = props
  const status = getStatusLevel(provider)

  const services = provider.services?.slice(0, 2) ?? []
  const minPrice = services.length > 0
    ? Math.min(...services.map(s => s.basePrice ?? 0).filter(p => p > 0))
    : null

  const el = document.createElement("button")
  el.type = "button"
  el.className = "animated-provider-pin"
  el.dataset.selected = isSelected ? "true" : "false"
  el.dataset.status = status
  el.setAttribute("aria-label", `${provider.name} - ${status === "online" ? "Online" : "Offline"}`)

  el.style.cssText = `
    display: flex; align-items: center; gap: 5px;
    padding: 4px 10px 4px 6px;
    border-radius: 9999px;
    border: 2px solid rgba(255,255,255,0.95);
    background: white;
    font-size: 12px; font-weight: 600; line-height: 1;
    box-shadow: 0 4px 16px -2px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05);
    cursor: pointer;
    transform: translate(-50%, -100%);
    transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms ease;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  `

  // Status dot with pulse animation
  const statusDot = document.createElement("span")
  statusDot.style.cssText = `
    width: 8px; height: 8px;
    border-radius: 50%;
    background: ${status === "online" ? "#10b981" : status === "recent" ? "#eab308" : status === "away" ? "#f97316" : "#9ca3af"};
    flex-shrink: 0;
    position: relative;
  `

  if (status === "online") {
    const pulse = document.createElement("span")
    pulse.style.cssText = `
      position: absolute; inset: -4px;
      border-radius: 50%;
      border: 2px solid rgba(16, 185, 129, 0.4);
      animation: pin-pulse 2s ease-out infinite;
    `
    statusDot.appendChild(pulse)
  }

  el.appendChild(statusDot)

  // Star + rating
  const star = document.createElement("span")
  star.style.cssText = "color: #facc15; font-size: 11px;"
  star.textContent = "★"
  el.appendChild(star)

  const rating = document.createElement("span")
  rating.style.color = "#374151"
  rating.textContent = provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"
  el.appendChild(rating)

  // Price
  if (minPrice !== null) {
    const sep = document.createElement("span")
    sep.style.cssText = "color: #9ca3af; margin: 0 1px;"
    sep.textContent = "·"
    el.appendChild(sep)

    const price = document.createElement("span")
    price.style.cssText = "color: #059669; font-weight: 700;"
    price.textContent = formatBRL(minPrice)
    el.appendChild(price)
  }

  // Verified badge
  if (provider.verified) {
    const badge = document.createElement("span")
    badge.style.cssText = "color: #10b981; font-size: 10px;"
    badge.textContent = "✓"
    el.appendChild(badge)
  }

  // Events
  el.addEventListener("mouseenter", () => {
    el.style.transform = "translate(-50%, -100%) scale(1.12)"
    el.style.boxShadow = "0 8px 24px -4px rgba(0,0,0,0.3), 0 0 0 2px rgba(16, 185, 129, 0.3)"
    el.style.zIndex = "100"
  })

  el.addEventListener("mouseleave", () => {
    el.style.transform = isSelected
      ? "translate(-50%, -100%) scale(1.06)"
      : "translate(-50%, -100%) scale(1)"
    el.style.boxShadow = isSelected
      ? "0 4px 16px -2px rgba(0,0,0,0.2), 0 0 0 3px rgba(16, 185, 129, 0.4)"
      : "0 4px 16px -2px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)"
    el.style.zIndex = ""
  })

  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onSelect?.(provider.id)
  })

  // Selected state
  if (isSelected) {
    el.style.transform = "translate(-50%, -100%) scale(1.06)"
    el.style.boxShadow = "0 4px 16px -2px rgba(0,0,0,0.2), 0 0 0 3px rgba(16, 185, 129, 0.4)"
    el.style.zIndex = "10"
  }

  return el
}

// Inject pulse keyframes once
if (typeof document !== "undefined") {
  const id = "animated-pin-pulse-keyframes"
  if (!document.getElementById(id)) {
    const style = document.createElement("style")
    style.id = id
    style.textContent = `
      @keyframes pin-pulse {
        0% { transform: scale(0.8); opacity: 1; }
        100% { transform: scale(2.2); opacity: 0; }
      }
    `
    document.head.appendChild(style)
  }
}
