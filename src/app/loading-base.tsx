/**
 * loading-base.tsx
 *
 * Base primitives for all loading skeletons across the app.
 *
 * This is the low-level module — end-users should import from `@/app/loading-shell`
 * which re-exports everything and adds the compound `<LoadingShell>` component.
 *
 * Exports:
 *   shimmerCSS          – CSS string with @keyframes shimmer / fadeSlideUp / fadeIn
 *   ShimmerStyle        – Component that renders <style>{shimmerCSS}</style>
 *   S                   – Shimmer div helper (<div className="shimmer rounded …" />)
 *   staggerDelay        – Returns animation-delay style for staggered children
 */

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

  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 0.6; }
    50% { transform: scale(1.3); opacity: 1; }
  }
`

/** Render this once at the top of your loading component. */
export function ShimmerStyle() {
  return <style>{shimmerCSS}</style>
}

// ── Shimmer div helper ────────────────────────────────────────────────────
export function S({ className }: { className?: string }) {
  return <div className={`shimmer rounded ${className ?? ""}`} />
}

// ── Stagger animation helper ──────────────────────────────────────────────
// Returns an inline style object with animation-delay for staggered children.
export function staggerDelay(index: number, staggerSeconds = 0.06): React.CSSProperties {
  return { animationDelay: `${index * staggerSeconds}s` }
}
