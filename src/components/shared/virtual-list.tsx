"use client"

/**
 * src/components/shared/virtual-list.tsx
 *
 * Componente de lista virtualizada (windowing) leve e sem dependências externas.
 * Renderiza apenas os elementos visíveis na janela de rolagem + buffer de overscan,
 * garantindo:
 *   - Taxa de quadros constante de 60fps em dispositivos móveis.
 *   - Redução drástica de nós no DOM (ex.: 20 nós em vez de 5.000 nós).
 *   - Menor consumo de memória RAM do navegador em feeds longos de chat e tabelas.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

export interface VirtualListProps<T> {
  items: T[]
  height: number
  itemHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  overscan?: number
  className?: string
  emptyText?: string
  onScrollBottom?: () => void
}

export function VirtualList<T>({
  items,
  height,
  itemHeight,
  renderItem,
  overscan = 3,
  className,
  emptyText = "Nenhum item encontrado",
  onScrollBottom,
}: VirtualListProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = React.useState(0)

  const totalItems = items.length
  const totalHeight = totalItems * itemHeight

  const handleScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const top = e.currentTarget.scrollTop
      setScrollTop(top)

      if (onScrollBottom) {
        const { scrollHeight, clientHeight } = e.currentTarget
        if (top + clientHeight >= scrollHeight - itemHeight * 2) {
          onScrollBottom()
        }
      }
    },
    [itemHeight, onScrollBottom],
  )

  if (totalItems === 0) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex items-center justify-center p-6 text-xs",
          className,
        )}
        style={{ height }}
      >
        {emptyText}
      </div>
    )
  }

  // Janela visível de itens calculada
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(height / itemHeight) + 2 * overscan
  const endIndex = Math.min(totalItems, startIndex + visibleCount)

  const visibleItems = items.slice(startIndex, endIndex)
  const offsetY = startIndex * itemHeight

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn("relative overflow-y-auto", className)}
      style={{ height }}
      tabIndex={0}
      role="region"
      aria-label="Lista com rolagem virtualizada"
    >
      <div style={{ height: totalHeight, width: "100%", position: "relative" }}>
        <div
          style={{
            transform: `translateY(${offsetY}px)`,
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, idx) => {
            const actualIndex = startIndex + idx
            return (
              <div key={actualIndex} style={{ height: itemHeight }} className="overflow-hidden">
                {renderItem(item, actualIndex)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
