/**
 * loading-base.tsx
 *
 * Base primitives for all loading skeletons across the app.
 *
 * This is the low-level module — end‑users should import from `@/app/loading-shell`
 * which re‑exports everything and adds the compound `<LoadingShell>` component.
 *
 * Exports:
 *   shimmerCSS          – CSS string with @keyframes shimmer / fadeSlideUp / fadeIn
 *   ShimmerStyle        – Component that renders <style>{shimmerCSS}</style>
 *   S                   – Shimmer div helper (<div className="shimmer rounded …" />)
 *   createContainer     – Factory for stagger‑container Variants
 *   createItem          – Factory for stagger‑item Variants
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

  /* Stagger entrance — translateY driven by --svn-y (set by StaggerItem) */
  @keyframes svnFadeUpVar {
    from { opacity: 0; transform: translateY(var(--svn-y, 12px)); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* LoadingGlobal dots — soft scale + opacity pulse */
  @keyframes svnDotPulse {
    0%, 100% { transform: scale(1); opacity: 0.6; }
    50%      { transform: scale(1.3); opacity: 1; }
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

// ── Animation variant factories ───────────────────────────────────────────
// Each loading.tsx can customise stagger delay and y-offset independently.
// (Plain object shape — no framer-motion type dependency, keeping the
// animation lib out of the initial JS graph.)

// Local minimal shape for the legacy variant factories. The CSS-based
// <StaggerContainer>/<StaggerItem> in loading-shell.tsx are the current
// recommended path; these factories remain for API compatibility.
export type Variants = {
  hidden: Record<string, unknown>
  show: Record<string, unknown>
}

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
