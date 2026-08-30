"use client"

/**
 * AnimatedMapCard — Map card with Framer Motion spring animations.
 *
 * Features:
 * - Spring physics on hover (scale, shadow, y)
 * - Layout animation when selected
 * - AnimatePresence for mount/unmount
 * - Staggered children animation
 * - WhileTap for press feedback
 */

import { motion, AnimatePresence } from "framer-motion"
import { Star, BadgeCheck, Clock, MessageSquare } from "lucide-react"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import type { ProviderCard } from "@/lib/api"

type Props = {
  provider: ProviderCard
  isSelected?: boolean
  onSelect?: (id: string) => void
  className?: string
}

// Spring config for snappy feel
const SPRING = { type: "spring" as const, stiffness: 400, damping: 25 }

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

export default function AnimatedMapCard({
  provider,
  isSelected = false,
  onSelect,
  className = "",
}: Props) {
  const status = getStatusInfo(provider)
  const services = provider.services?.slice(0, 3) ?? []
  const minPrice = services.length > 0
    ? Math.min(...services.map(s => s.basePrice ?? 0).filter(p => p > 0))
    : null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: isSelected ? 1.02 : 1,
        boxShadow: isSelected
          ? "0 8px 32px -8px rgba(16, 185, 129, 0.3), 0 0 0 2px rgba(16, 185, 129, 0.5)"
          : "0 4px 16px -4px rgba(0,0,0,0.1)",
      }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={SPRING}
      whileHover={{
        scale: isSelected ? 1.03 : 1.02,
        y: -4,
        boxShadow: "0 12px 40px -8px rgba(0,0,0,0.2)",
      }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect?.(provider.id)}
      className={`pointer-events-auto w-[280px] cursor-pointer overflow-hidden rounded-2xl border border-white/80 bg-white ${className}`}
    >
      {/* Header with photo */}
      <motion.div
        className="relative h-[100px] w-full overflow-hidden bg-gradient-to-br from-emerald-400 to-emerald-600"
        layoutId={`header-${provider.id}`}
      >
        {provider.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- map provider avatar
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

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Status badge */}
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
        >
          <span className={`size-1.5 rounded-full ${status.color}`} />
          {status.label}
        </motion.div>

        {/* Verified badge */}
        {provider.verified && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 500 }}
            className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white"
          >
            <BadgeCheck className="size-3" />
            Verificado
          </motion.div>
        )}

        {/* Name */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute right-0 bottom-0 left-0 p-3"
        >
          <h3 className="truncate text-sm font-bold text-white drop-shadow-md">
            {provider.name}
          </h3>
          {provider.city && (
            <p className="text-[11px] text-white/80">📍 {provider.city}</p>
          )}
        </motion.div>
      </motion.div>

      {/* Content */}
      <div className="space-y-2.5 p-3">
        {/* Rating + Response Time */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5">
            <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold">
              {provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}
            </span>
            {provider.reviewCount > 0 && (
              <span className="text-[11px] text-gray-500">({provider.reviewCount})</span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-500">
            <Clock className="size-3" />
            <span>{status.online ? "~5 min" : "~2 horas"}</span>
          </div>
        </motion.div>

        {/* Service tags */}
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-wrap gap-1"
        >
          {services.map((service, i) => (
            <motion.span
              key={service.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"
            >
              {service.title}
            </motion.span>
          ))}
        </motion.div>

        {/* Price + Distance */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="flex items-center justify-between border-t border-gray-100 pt-2"
        >
          <div>
            {minPrice !== null && <p className="text-[10px] text-gray-500">a partir de</p>}
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
        </motion.div>

        {/* CTA */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(provider.id)
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-md transition-colors hover:bg-emerald-700"
        >
          <MessageSquare className="size-4" />
          Solicitar orçamento
        </motion.button>
      </div>

      {/* Selection indicator */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ scaleX: 0 }}
            className="absolute -bottom-1 left-1/2 h-2 w-12 -translate-x-1/2 rounded-full bg-emerald-500 shadow-lg"
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
