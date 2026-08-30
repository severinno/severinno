/* eslint-disable @next/next/no-img-element -- map components use external provider avatar URLs */
"use client"

/**
 * ProviderBottomSheet — Mobile-first bottom sheet for map provider details.
 *
 * Inspired by Uber/Rappi bottom sheets:
 * - Drag handle for dismissal
 * - Swipe up to expand
 * - Provider photo + name
 * - Full service list
 * - Rating + reviews
 * - Action buttons (call, message, request quote)
 * - Smooth spring animation
 */

import { useState, useRef, useCallback, useEffect } from "react"
import { Star, BadgeCheck, Clock, MessageSquare, MapPin, ChevronDown, X } from "lucide-react"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import type { ProviderCard } from "@/lib/api"

type Props = {
  provider: ProviderCard | null
  onSelect?: (id: string) => void
  onClose?: () => void
  className?: string
}

function getStatusInfo(provider: ProviderCard): {
  color: string
  label: string
  online: boolean
} {
  if (provider.memberSince) {
    const diff = Date.now() - new Date(provider.memberSince).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 5) return { color: "bg-emerald-500", label: "Online agora", online: true }
    if (minutes < 60) return { color: "bg-yellow-500", label: `Ativo há ${minutes}min`, online: true }
    if (minutes < 1440) return { color: "bg-orange-400", label: `Ativo há ${Math.floor(minutes / 60)}h`, online: false }
  }
  return { color: "bg-gray-400", label: "Offline", online: false }
}

export default function ProviderBottomSheet({
  provider,
  onSelect,
  onClose,
  className = "",
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [dragY, setDragY] = useState(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef(0)
  const isDraggingRef = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY
    isDraggingRef.current = true
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return
    const currentY = e.touches[0].clientY
    const diff = startYRef.current - currentY
    setDragY(Math.max(0, diff))
  }, [])

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false
    if (dragY > 100) {
      setIsExpanded(true)
    } else if (dragY < -50) {
      setIsExpanded(false)
      onClose?.()
    }
    setDragY(0)
  }, [dragY, onClose])

  // Auto-expand when provider changes
  useEffect(() => {
    if (provider) {
      // Schedule state updates to avoid synchronous setState in effect
      const id = requestAnimationFrame(() => {
        setIsExpanded(false)
        setDragY(0)
      })
      return () => cancelAnimationFrame(id)
    }
  }, [provider, provider?.id])

  if (!provider) return null

  const status = getStatusInfo(provider)
  const services = provider.services ?? []


  return (
    <>
      {/* Backdrop */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-40 bg-black/40 transition-opacity"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`fixed right-0 bottom-0 left-0 z-50 transition-transform duration-300 ease-out ${
          isExpanded ? "translate-y-0" : ""
        } ${className}`}
        style={{
          transform: isExpanded ? "translateY(0)" : `translateY(calc(-100% + ${320 - dragY}px))`,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="rounded-t-3xl border-t border-gray-200 bg-white shadow-2xl">
          {/* Drag Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>

          {/* Preview (always visible) */}
          <div className="px-4 pb-3">
            <div className="flex items-start gap-3">
              {/* Avatar */}
              <div className="relative shrink-0">
                {provider.avatarUrl ? (
                                      <img
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="size-14 rounded-full object-cover ring-2 ring-white shadow-md"
                  />
                ) : (
                  <div className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 ring-2 ring-white shadow-md">
                    <span className="text-lg font-bold text-white">
                      {provider.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )}
                {/* Online dot */}
                <span className={`absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-2 border-white ${status.color}`} />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate text-base font-bold">{provider.name}</h3>
                  {provider.verified && (
                    <BadgeCheck className="size-4 shrink-0 text-emerald-500" />
                  )}
                </div>

                <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Star className="size-3 fill-yellow-400 text-yellow-400" />
                    <span className="font-semibold">{provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}</span>
                    {provider.reviewCount > 0 && <span>({provider.reviewCount})</span>}
                  </span>
                  {typeof provider.distanceKm === "number" && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {formatDistance(provider.distanceKm)}
                    </span>
                  )}
                </div>

                {provider.city && (
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    📍 {provider.city}
                  </p>
                )}
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
              >
                <X className="size-4 text-gray-500" />
              </button>
            </div>

            {/* Quick Actions Row */}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => onSelect?.(provider.id)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-emerald-700"
              >
                <MessageSquare className="size-4" />
                Solicitar orçamento
              </button>

            </div>
          </div>

          {/* Expanded Content */}
          {isExpanded && (
            <div className="border-t border-gray-100 px-4 pb-8 pt-4">
              {/* Status */}
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-gray-50 p-3">
                <span className={`size-2 rounded-full ${status.color}`} />
                <span className="text-sm font-medium">{status.label}</span>
                <span className="ml-auto text-xs text-gray-500">
                  <Clock className="mr-1 inline size-3" />
                  Responde em ~{status.online ? "5 min" : "2 horas"}
                </span>
              </div>

              {/* Services */}
              {services.length > 0 && (
                <div className="mb-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                    Serviços ({services.length})
                  </h4>
                  <div className="space-y-2">
                    {services.map((service) => (
                      <div
                        key={service.id}
                        className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{service.title}</p>
                          <p className="text-[11px] text-gray-500 line-clamp-1">
                            {service.description}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-emerald-700">
                          {formatBRL(service.basePrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bio */}
              {provider.bio && (
                <div className="mb-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
                    Sobre
                  </h4>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {provider.bio}
                  </p>
                </div>
              )}


            </div>
          )}

          {/* Expand indicator */}
          {!isExpanded && (
            <button
              onClick={() => setIsExpanded(true)}
              className="flex w-full items-center justify-center gap-1 pb-3 text-xs text-gray-400"
            >
              <ChevronDown className="size-4 animate-bounce" />
              Deslize para cima para mais detalhes
            </button>
          )}
        </div>
      </div>
    </>
  )
}
