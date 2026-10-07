/**
 * loading-base.tsx
 *
 * Base primitives for all loading skeletons across the app.
 *
 * This is the low-level module — end‑users should import from `@/app/loading-shell`
 * which re‑exports everything and adds the compound `<LoadingShell>` component.
 *
 * Exports:
 *   shimmerCSS          – CSS string espelho do bloco .shimmer/@keyframes em globals.css
 *   ShimmerStyle        – DEPRECATED no-op: não renderiza mais <style> (contrato CSP)
 *   S                   – Shimmer div helper (<div className="shimmer rounded …" />)
 *   createContainer     – Factory for stagger‑container Variants
 *   createItem          – Factory for stagger‑item Variants
 */

import type { Variants } from "framer-motion"

// ── Shimmer CSS ───────────────────────────────────────────────────────────
export const shimmerCSS = `
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .shimmer {
    background: linear-gradient(
      90deg,
      hsl(var(--muted)) 25%,
      hsl(var(--primary) / 0.08) 50%,
      hsl(var(--muted)) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 2s ease-in-out infinite;
  }

  @keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`

/**
 * @deprecated Os estilos agora vivem em globals.css (.shimmer + @keyframes
 * shimmer); este componente não renderiza mais <style> inline — a CSP saiu
 * do 'unsafe-inline' em style-src (ver src/lib/csp.ts). Mantido como no-op
 * para compatibilidade de imports; remover os usos.
 */
export function ShimmerStyle() {
  return null
}

// ── Shimmer div helper ────────────────────────────────────────────────────
export function S({ className }: { className?: string }) {
  return <div className={`shimmer rounded ${className ?? ""}`} />
}

// ── Animation variant factories ───────────────────────────────────────────
// Each loading.tsx can customise stagger delay and y-offset independently.

export function createContainer(staggerChildren = 0.06): Variants {
  return {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren },
    },
  }
}

export function createItem(y = 12, duration = 0.35): Variants {
  return {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration, ease: "easeOut" } },
  }
}
