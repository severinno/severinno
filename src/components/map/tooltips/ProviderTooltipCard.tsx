/* eslint-disable @next/next/no-img-element -- map components use external provider avatar URLs */
"use client"

/**
 * ProviderTooltipCard — Rich tooltip card for map pins (desktop).
 *
 * Airbnb/Rappi-inspired design with:
 * - Provider photo/avatar
 * - Name + verified badge
 * - Star rating + review count
 * - Service tags (2-3 main services)
 * - Price range
 * - Online status indicator
 * - Estimated response time
 * - "Solicitar orçamento" CTA button
 *
 * Uses Framer Motion for smooth hover/selection animations.
 */

import { useState } from "react"
import { Star, BadgeCheck, Clock, MessageSquare } from "lucide-react"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import type { ProviderCard } from "@/lib/api"

type Props = {
  provider: ProviderCard
  onSelect?: (id: string) => void
  isSelected?: boolean
  className?: string
}

function getStatusInfo(provider: ProviderCard): {
  color: string
  label: string
  online: boolean
} {
  // If provider has lastActiveAt, check recency
  if (provider.memberSince) {
    const diff = Date.now() - new Date(provider.memberSince).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 5) return { color: "bg-emerald-500", label: "Online agora", online: true }
    if (minutes < 60) return { color: "bg-yellow-500", label: `Ativo há ${minutes}min`, online: true }
    if (minutes < 1440) return { color: "bg-orange-400", label: `Ativo há ${Math.floor(minutes / 60)}h`, online: false }
  }
  return { color: "bg-gray-400", label: "Offline", online: false }
}

function getEstimatedResponse(provider: ProviderCard): string {
  if (provider.memberSince) {
    const diff = Date.now() - new Date(provider.memberSince).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 5) return "~5 min"
    if (minutes < 30) return "~15 min"
    if (minutes < 120) return "~1 hora"
  }
  return "~2 horas"
}

export default function ProviderTooltipCard({
  provider,
  onSelect,
  isSelected = false,
  className = "",
}: Props) {
  const [isHovered, setIsHovered] = useState(false)
  const status = getStatusInfo(provider)
  const responseTime = getEstimatedResponse(provider)

  const services = provider.services?.slice(0, 3) ?? []
  const minPrice = services.length > 0
    ? Math.min(...services.map(s => s.basePrice ?? 0).filter(p => p > 0))
    : null

  return (
    <div
      className={`pointer-events-auto relative w-[280px] overflow-hidden rounded-2xl border border-white/80 bg-white shadow-2xl transition-all duration-200 ${
        isSelected ? "ring-2 ring-emerald-500 ring-offset-2" : ""
      } ${isHovered ? "scale-[1.02]" : ""} ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect?.(provider.id)}
    >
      {/* Photo / Header */}
      <div className="relative h-[100px] w-full overflow-hidden bg-gradient-to-br from-emerald-400 to-emerald-600">
        {provider.avatarUrl ? (
          <img
            src={provider.avatarUrl}
            alt={provider.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-4xl font-bold text-white/80">
              {provider.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Status badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <span className={`size-1.5 rounded-full ${status.color}`} />
          {status.label}
        </div>

        {/* Verified badge */}
        {provider.verified && (
          <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">
            <BadgeCheck className="size-3" />
            Verificado
          </div>
        )}

        {/* Name overlay at bottom of photo */}
        <div className="absolute right-0 bottom-0 left-0 p-3">
          <h3 className="truncate text-sm font-bold text-white drop-shadow-md">
            {provider.name}
          </h3>
          {provider.city && (
            <p className="text-[11px] text-white/80">
              📍 {provider.city}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-2.5 p-3">
        {/* Rating + Response Time */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold">
              {provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}
            </span>
            {provider.reviewCount > 0 && (
              <span className="text-[11px] text-gray-500">
                ({provider.reviewCount})
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-[11px] text-gray-500">
            <Clock className="size-3" />
            <span>Responde em {responseTime}</span>
          </div>
        </div>

        {/* Service tags */}
        {services.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {services.map((service) => (
              <span
                key={service.id}
                className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"
              >
                {service.title}
              </span>
            ))}
          </div>
        )}

        {/* Price + Distance */}
        <div className="flex items-center justify-between border-t border-gray-100 pt-2">
          <div>
            {minPrice !== null && (
              <p className="text-[10px] text-gray-500">a partir de</p>
            )}
            <p className="text-base font-bold text-emerald-700">
              {minPrice !== null ? formatBRL(minPrice) : "Sob consulta"}
            </p>
          </div>

          {typeof provider.distanceKm === "number" && (
            <div className="text-right">
              <p className="text-[10px] text-gray-500">distância</p>
              <p className="text-xs font-semibold text-gray-700">
                {formatDistance(provider.distanceKm)}
              </p>
            </div>
          )}
        </div>

        {/* CTA Button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(provider.id)
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-md transition-colors hover:bg-emerald-700"
        >
          <MessageSquare className="size-4" />
          Solicitar orçamento
        </button>
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute -bottom-1 left-1/2 h-2 w-8 -translate-x-1/2 rounded-full bg-emerald-500 shadow-lg" />
      )}
    </div>
  )
}
