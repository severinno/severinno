import { cn } from "@/lib/utils"

/**
 * SectionSkeleton - shared loading fallback for the vitrine's next/dynamic
 * sections.
 *
 * Fixes the null flash during SPA view switches: while a code-split chunk is
 * (re)loading, next/dynamic renders this placeholder instead of nothing, so
 * in-flow sections keep their height (no layout collapse) and floating
 * widgets keep their slot (no jarring pop-in). Same visual language as the
 * LoadingShell (animate-pulse + bg-muted) at section level.
 *
 * Variants match the shape of the component they stand in for:
 *   section - in-flow marketing sections (heading + content grid)
 *   bar     - CompareBar (fixed bottom bar)
 *   pill    - BackToTop (fixed bottom-right circle)
 *   widget  - AIChatWidget (fixed bottom-right chat bubble)
 *   banner  - CookieConsent (fixed bottom banner)
 *
 * Accessibility: role="status" live region announces the sr-only text to
 * screen readers; the pulse blocks are decorative. One announcement channel
 * only (no aria-label on the container - the sr-only span is the source).
 */

export type SectionSkeletonVariant =
  | "section"
  | "bar"
  | "pill"
  | "widget"
  | "banner"

export interface SectionSkeletonProps {
  variant?: SectionSkeletonVariant
  className?: string
}

const STATUS_TEXT = "Carregando conteúdo"

export function SectionSkeleton({
  variant = "section",
  className,
}: SectionSkeletonProps) {
  switch (variant) {
    case "bar":
      return (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="h-10 w-56 animate-pulse rounded-lg bg-muted" />
            <div className="h-10 w-28 animate-pulse rounded-lg bg-muted" />
          </div>
          <span className="sr-only">{STATUS_TEXT}</span>
        </div>
      )
    case "pill":
      return (
        <div
          role="status"
          className="fixed bottom-20 right-4 z-30 sm:bottom-24 sm:right-6"
        >
          <div className="size-11 animate-pulse rounded-full bg-muted shadow-lg" />
          <span className="sr-only">{STATUS_TEXT}</span>
        </div>
      )
    case "widget":
      return (
        <div
          role="status"
          className="fixed bottom-20 right-6 z-50 sm:bottom-22 sm:right-8"
        >
          <div className="size-14 animate-pulse rounded-full bg-muted shadow-lg" />
          <span className="sr-only">{STATUS_TEXT}</span>
        </div>
      )
    case "banner":
      return (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-[60] border-t bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-9 w-28 shrink-0 animate-pulse rounded-full bg-muted" />
          </div>
          <span className="sr-only">{STATUS_TEXT}</span>
        </div>
      )
    default:
      return (
        <section
          role="status"
          className={cn(
            "w-full px-4 py-16 sm:px-6 lg:px-8",
            className,
          )}
        >
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto mb-10 h-8 w-56 animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 animate-pulse rounded-xl bg-muted/60"
                />
              ))}
            </div>
          </div>
          <span className="sr-only">{STATUS_TEXT}</span>
        </section>
      )
  }
}
