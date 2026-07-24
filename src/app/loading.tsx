import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="min-h-screen bg-background">
        {/* ══════════════════════════════════════════════════════════════
            HERO SECTION — search + CTA
           ══════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden border-b bg-gradient-to-b from-emerald-50/60 via-background to-background dark:from-emerald-950/10">
          {/* Decorative blobs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-32 -top-32 size-64 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
            <div className="absolute -right-32 -bottom-32 size-80 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
          </div>

          <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-8 sm:pb-20 sm:pt-12">
            {/* Topbar skeleton */}
            <StaggerContainer stagger={0.07} className="mb-10 flex items-center justify-between">
              <StaggerItem y={14} duration={0.4} className="flex items-center gap-8">
                <S className="h-7 w-28" />
                <div className="hidden gap-5 md:flex">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <S key={i} className="h-4 w-16" />
                  ))}
                </div>
              </StaggerItem>
              <StaggerItem y={14} duration={0.4} className="flex items-center gap-3">
                <S className="hidden h-8 w-20 rounded-full sm:block" />
                <S className="size-8 rounded-full" />
              </StaggerItem>
            </StaggerContainer>

            {/* Hero title */}
            <StaggerContainer stagger={0.07} className="mx-auto max-w-3xl text-center">
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto mb-3 h-9 w-72 sm:h-10 sm:w-80" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto h-10 w-80 sm:h-11 sm:w-96" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4} className="mt-3">
                <S className="mx-auto h-4 w-64" />
              </StaggerItem>
            </StaggerContainer>

            {/* Search bar */}
            <div
              className="relative mx-auto mt-8 max-w-2xl"
              style={{ animation: "fadeSlideUp 0.45s 0.18s both" }}
            >
              <S className="h-14 w-full rounded-xl" />
            </div>

            {/* Category pills */}
            <div
              className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-2"
              style={{ animation: "fadeIn 0.4s 0.3s both" }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <S key={i} className="h-7 w-[72px] rounded-full" />
              ))}
            </div>

            {/* Trust badges */}
            <div
              className="mx-auto mt-8 flex items-center justify-center gap-6"
              style={{ animation: "fadeIn 0.4s 0.4s both" }}
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <S className="size-4 rounded-full" />
                  <S className="h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            SOCIAL PROOF TICKER — atividade recente
           ══════════════════════════════════════════════════════════════ */}
        <section
          className="relative isolate border-y border-emerald-200/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:border-emerald-800/30 dark:from-emerald-950/30 dark:to-teal-950/30"
          style={{ animation: "fadeIn 0.5s 0.45s both" }}
        >
          {/* Left fade gradient */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-emerald-50 to-transparent dark:from-emerald-950/30 sm:w-24" />
          {/* Right fade gradient */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-teal-50 to-transparent dark:from-teal-950/30 sm:w-24" />

          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
            {/* Badge: "Atividade recente" */}
            <div className="mb-2 flex items-center gap-2 sm:mb-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100/80 px-3 py-1 dark:bg-emerald-900/40">
                <S className="size-2 rounded-full" />
                <S className="h-3 w-24" />
              </div>
            </div>

            {/* Row 1 — always visible */}
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex shrink-0 items-center gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 shrink-0">
                    <S className="size-4" />
                    <S className="h-3.5 w-36" />
                    <S className="size-1.5 shrink-0 rounded-full" />
                  </div>
                ))}
              </div>
            </div>

            {/* Row 2 — visible on sm+ */}
            <div className="mt-2 hidden sm:flex sm:items-center sm:gap-3 sm:overflow-hidden">
              <div className="flex shrink-0 items-center gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 shrink-0">
                    <S className="size-4" />
                    <S className="h-3.5 w-40" />
                    <S className="size-1.5 shrink-0 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            CATEGORY SHOWCASE SECTION
           ══════════════════════════════════════════════════════════════ */}
        <section className="border-b py-10 sm:py-14">
          <div className="mx-auto max-w-6xl px-4">
            <StaggerContainer stagger={0.07} className="mb-8 text-center">
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto h-6 w-48 sm:h-7 sm:w-56" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4} className="mt-2">
                <S className="mx-auto h-4 w-72" />
              </StaggerItem>
            </StaggerContainer>

            <StaggerContainer stagger={0.07} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <StaggerItem key={i} y={14} duration={0.4}>
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-card p-5">
                    <S className="size-10 rounded-xl" />
                    <S className="h-4 w-20" />
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            RECENTLY VIEWED — prestadores vistos recentemente
           ══════════════════════════════════════════════════════════════ */}
        <section
          className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
          style={{ animation: "fadeSlideUp 0.45s 0.55s both" }}
        >
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-card dark:border-slate-700/60">
            {/* CardHeader */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2">
                <S className="size-8 rounded-lg" />
                <div>
                  <S className="h-4 w-36" />
                  <S className="mt-1 h-3 w-28" />
                </div>
              </div>
              <S className="h-7 w-16 rounded-md" />
            </div>

            {/* CardContent: provider cards grid */}
            <div className="px-5 pb-5">
              <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-200 bg-card p-3 dark:border-slate-700/60"
                  >
                    {/* Avatar + name + rating */}
                    <div className="flex items-center gap-2.5">
                      <S className="size-10 shrink-0 rounded-full ring-2 ring-emerald-500/20" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <S className="h-3.5 w-24" />
                        <S className="h-3 w-20" />
                      </div>
                    </div>
                    {/* Location */}
                    <S className="mt-2 h-3 w-28" />
                    {/* Price */}
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-700/60">
                      <S className="h-3 w-16" />
                      <S className="h-4 w-14" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Mobile: horizontal scroll hint */}
              <div className="flex gap-3 sm:hidden">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div
                    key={i}
                    className="min-w-[220px] rounded-xl border border-slate-200 bg-card p-3 dark:border-slate-700/60"
                  >
                    <div className="flex items-center gap-2.5">
                      <S className="size-10 shrink-0 rounded-full ring-2 ring-emerald-500/20" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <S className="h-3.5 w-24" />
                        <S className="h-3 w-20" />
                      </div>
                    </div>
                    <S className="mt-2 h-3 w-28" />
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-700/60">
                      <S className="h-3 w-16" />
                      <S className="h-4 w-14" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            HOW IT WORKS SECTION
           ══════════════════════════════════════════════════════════════ */}
        <section className="border-b bg-muted/20 py-10 sm:py-14">
          <div className="mx-auto max-w-5xl px-4">
            <StaggerContainer stagger={0.07} className="mb-10 text-center">
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto h-6 w-48" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4} className="mt-2">
                <S className="mx-auto h-4 w-64" />
              </StaggerItem>
            </StaggerContainer>

            <StaggerContainer stagger={0.07} className="grid gap-6 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <StaggerItem key={i} y={14} duration={0.4}>
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-card p-6 text-center">
                    <S className="size-14 rounded-2xl" />
                    <S className="h-5 w-28" />
                    <S className="h-3 w-full" />
                    <S className="h-3 w-3/4" />
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            PARTNERS TRUST — referência no mercado
           ══════════════════════════════════════════════════════════════ */}
        <section
          className="border-t border-border/30 bg-background py-12 sm:py-16"
          style={{ animation: "fadeSlideUp 0.45s 0.6s both" }}
          aria-label="Parceiros e imprensa"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {/* Header */}
            <div className="mb-8 text-center">
              <S className="mx-auto h-4 w-44" />
            </div>

            {/* Logo cards — hidden on mobile via sm:flex */}
            <div className="hidden flex-wrap items-center justify-center gap-3 sm:flex lg:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex shrink-0 items-center justify-center rounded-xl border border-border/40 bg-card/30 px-5 py-3.5"
                  style={{ minWidth: 120 }}
                >
                  <S className="h-4 w-20" />
                </div>
              ))}
            </div>

            {/* Logo cards — mobile horizontal scroll */}
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:hidden">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex shrink-0 items-center justify-center rounded-xl border border-border/40 bg-card/30 px-5 py-3.5"
                  style={{ minWidth: 120 }}
                >
                  <S className="h-4 w-20" />
                </div>
              ))}
            </div>

            {/* Trust stat */}
            <div
              className="mt-8 text-center"
              style={{ animation: "fadeIn 0.4s 0.75s both" }}
            >
              <S className="mx-auto h-4 w-64" />
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            TESTIMONIALS SECTION
           ══════════════════════════════════════════════════════════════ */}
        <section className="border-b py-10 sm:py-14">
          <div className="mx-auto max-w-5xl px-4">
            <StaggerContainer stagger={0.07} className="mb-8 text-center">
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto h-6 w-44" />
              </StaggerItem>
            </StaggerContainer>

            <StaggerContainer stagger={0.07} className="grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <StaggerItem key={i} y={14} duration={0.4}>
                  <div className="rounded-xl border border-border/50 bg-card p-5">
                    <div className="mb-3 flex gap-1">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <S key={j} className="size-4" />
                      ))}
                    </div>
                    <S className="mb-2 h-3 w-full" />
                    <S className="mb-2 h-3 w-11/12" />
                    <S className="mb-4 h-3 w-4/5" />
                    <div className="flex items-center gap-3 border-t pt-3">
                      <S className="size-9 rounded-full" />
                      <div className="flex-1">
                        <S className="h-3.5 w-24" />
                        <S className="mt-1 h-3 w-16" />
                      </div>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            FAQ SECTION
           ══════════════════════════════════════════════════════════════ */}
        <section className="border-b bg-muted/20 py-10 sm:py-14">
          <div className="mx-auto max-w-3xl px-4">
            <StaggerContainer stagger={0.07} className="mb-8 text-center">
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto h-6 w-36" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4} className="mt-2">
                <S className="mx-auto h-4 w-56" />
              </StaggerItem>
            </StaggerContainer>

            <StaggerContainer stagger={0.07} className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <StaggerItem key={i} y={14} duration={0.4}>
                  <div className="rounded-xl border border-border/50 bg-card p-4">
                    <div className="flex items-center justify-between">
                      <S className="h-4 w-3/4" />
                      <S className="size-5" />
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            CTA BANNER
           ══════════════════════════════════════════════════════════════ */}
        <section className="border-b py-10 sm:py-14">
          <div className="mx-auto max-w-3xl px-4 text-center">
            <StaggerContainer stagger={0.07} className="rounded-2xl bg-emerald-50 p-8 dark:bg-emerald-950/20 sm:p-12">
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto mb-2 h-6 w-64" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4}>
                <S className="mx-auto h-4 w-80" />
              </StaggerItem>
              <StaggerItem y={14} duration={0.4} className="mt-6">
                <S className="mx-auto h-12 w-44 rounded-xl" />
              </StaggerItem>
            </StaggerContainer>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            FOOTER
           ══════════════════════════════════════════════════════════════ */}
        <footer className="border-t bg-muted/30 py-8">
          <div className="mx-auto max-w-6xl px-4">
            <StaggerContainer stagger={0.07} className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <StaggerItem key={i} y={14} duration={0.4} className="space-y-3">
                  <S className="h-5 w-24" />
                  <S className="h-3 w-full" />
                  <S className="h-3 w-4/5" />
                  {i === 0 && <S className="mt-2 h-3 w-3/5" />}
                  {i === 3 &&
                    Array.from({ length: 3 }).map((_, j) => (
                      <S key={j} className="h-3 w-28" />
                    ))}
                </StaggerItem>
              ))}
            </StaggerContainer>

            <div
              style={{ animation: "fadeIn 0.4s 0.6s both" }}
              className="mt-8 flex flex-col items-center justify-between gap-3 border-t pt-6 sm:flex-row"
            >
              <S className="h-3 w-48" />
              <div className="flex gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <S key={i} className="size-6 rounded-md" />
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </LoadingShell>
  )
}
