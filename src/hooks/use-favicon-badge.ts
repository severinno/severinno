"use client"

/**
 * useFaviconBadge — Atualiza o favicon e o título da página com o
 * contador de notificações não lidas.
 *
 * - Quando unreadCount > 0: adiciona "(N)" ao início do título da aba
 * - Quando unreadCount === 0: restaura o título original
 * - Altera o favicon para um badge circular com o número (via canvas)
 *
 * Uso:
 *   useFaviconBadge(unreadCount)
 */

import * as React from "react"

// Guarda o título original na primeira execução
let originalTitle: string | null = null

/**
 * Gera um favicon data-URL com um badge circular vermelho no canto
 * superior direito contendo o número de notificações não lidas.
 * Retorna o href original quando count === 0.
 */
function generateFaviconDataUrl(count: number): string {
  if (count === 0) return ""

  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""

  // Fundo transparente (mantém o favicon original visível embaixo)
  ctx.clearRect(0, 0, size, size)

  // Badge circular no canto superior direito
  const badgeX = size - 2
  const badgeY = 2
  const badgeRadius = count > 9 ? 10 : 8

  ctx.beginPath()
  ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
  ctx.fillStyle = "#EF4444" // red-500
  ctx.fill()
  ctx.strokeStyle = "#FFFFFF"
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Número
  const text = count > 99 ? "99+" : String(count)
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 9px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, badgeX, badgeY)

  return canvas.toDataURL("image/png")
}

/**
 * Hook que gerencia o favicon badge e o título da página.
 * Deve ser chamado uma vez no layout principal.
 */
export function useFaviconBadge(unreadCount: number): void {
  React.useEffect(() => {
    if (typeof window === "undefined") return

    // Salva o título original na primeira execução
    if (originalTitle === null) {
      originalTitle = document.title
    }

    // ── Atualiza o título da aba ──────────────────────────────────
    if (unreadCount > 0) {
      const badge = `(${unreadCount > 99 ? "99+" : unreadCount})`
      if (!document.title.startsWith(badge)) {
        document.title = `${badge} ${originalTitle}`
      }
    } else {
      if (document.title !== originalTitle) {
        document.title = originalTitle
      }
    }

    // ── Atualiza o favicon ────────────────────────────────────────
    const dataUrl = generateFaviconDataUrl(unreadCount)
    const links = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"]',
    )

    if (dataUrl) {
      // Adiciona badge ao favicon: salva original e troca para o com badge
      links.forEach((link) => {
        if (!link.dataset.originalHref) {
          link.dataset.originalHref = link.href
        }
        link.href = dataUrl
      })
    } else {
      // Restaura favicon original
      links.forEach((link) => {
        if (link.dataset.originalHref) {
          link.href = link.dataset.originalHref
        }
      })
    }
  }, [unreadCount])
}

export default useFaviconBadge
