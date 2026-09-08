/**
 * confetti.ts — Lightweight, zero-dependency HTML5 Canvas Confetti.
 *
 * Spawns colorful celebration particles with velocity, gravity, friction,
 * and rotation, automatically cleaning up DOM elements when animation completes.
 */

type ConfettiParticle = {
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
  rotation: number
  rotationSpeed: number
  color: string
  opacity: number
}

const COLORS = [
  "#10b981", // emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // purple
  "#06b6d4", // cyan
]

/**
 * Fires a burst of celebration confetti on the screen.
 * @param durationMs Duration of the animation before fade out (defaults to 2500ms)
 */
export function launchConfetti(durationMs: number = 2500): void {
  if (typeof window === "undefined" || typeof document === "undefined") return

  const canvas = document.createElement("canvas")
  canvas.style.position = "fixed"
  canvas.style.top = "0"
  canvas.style.left = "0"
  canvas.style.width = "100vw"
  canvas.style.height = "100vh"
  canvas.style.pointerEvents = "none"
  canvas.style.zIndex = "9999"
  document.body.appendChild(canvas)

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    document.body.removeChild(canvas)
    return
  }

  const width = (canvas.width = window.innerWidth)
  const height = (canvas.height = window.innerHeight)

  const particleCount = Math.min(120, Math.floor(width / 12))
  const particles: ConfettiParticle[] = []

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: width * (0.2 + Math.random() * 0.6),
      y: height * 0.4 + (Math.random() * 40 - 20),
      w: Math.random() * 10 + 6,
      h: Math.random() * 6 + 4,
      vx: (Math.random() - 0.5) * 16,
      vy: -(Math.random() * 14 + 6),
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      opacity: 1,
    })
  }

  const startTime = performance.now()
  let animationFrameId: number

  function render(time: number) {
    if (!ctx) return
    const elapsed = time - startTime
    const progress = elapsed / durationMs

    ctx.clearRect(0, 0, width, height)

    let alive = false

    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.35 // gravity
      p.vx *= 0.98 // air drag
      p.rotation += p.rotationSpeed

      if (progress > 0.6) {
        p.opacity = Math.max(0, 1 - (progress - 0.6) / 0.4)
      }

      if (p.opacity > 0 && p.y < height + 50) {
        alive = true
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate((p.rotation * Math.PI) / 180)
        ctx.globalAlpha = p.opacity
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
    }

    if (alive && elapsed < durationMs) {
      animationFrameId = requestAnimationFrame(render)
    } else {
      cancelAnimationFrame(animationFrameId)
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    }
  }

  animationFrameId = requestAnimationFrame(render)
}
