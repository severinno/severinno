import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* ── Hero / Profile header ───────────────────────────────── */}
        <StaggerContainer stagger={0.08} className="mb-10 flex flex-col items-center gap-4">
          {/* Avatar */}
          <StaggerItem y={16} duration={0.35}>
            <S className="size-24 rounded-full ring-4 ring-emerald-100 dark:ring-emerald-900/30" />
          </StaggerItem>
          {/* Name */}
          <StaggerItem y={16} duration={0.35} className="text-center">
            <S className="mx-auto h-8 w-48" />
          </StaggerItem>
          {/* Location */}
          <StaggerItem y={16} duration={0.35}>
            <S className="mx-auto h-4 w-40" />
          </StaggerItem>
          {/* Rating */}
          <StaggerItem y={16} duration={0.35}>
            <S className="mx-auto h-4 w-32" />
          </StaggerItem>
          {/* CTA button */}
          <StaggerItem y={16} duration={0.35}>
            <S className="h-10 w-44 rounded-lg" />
          </StaggerItem>
        </StaggerContainer>

        {/* ── About / Bio ──────────────────────────────────────────── */}
        <div className="mb-10 space-y-3" style={{ animation: "fadeSlideUp 0.4s 0.2s both" }}>
          <S className="h-5 w-32" />
          <S className="h-4 w-full" />
          <S className="h-4 w-5/6" />
          <S className="h-4 w-2/3" />
        </div>

        {/* ── Services section ────────────────────────────────────── */}
        <div className="mb-6" style={{ animation: "fadeSlideUp 0.4s 0.3s both" }}>
          <S className="mb-4 h-6 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ animation: `fadeSlideUp 0.3s ${0.35 + i * 0.06}s both` }}>
                <div className="border-border/50 bg-card rounded-xl border p-5">
                  <S className="mb-3 h-5 w-3/4" />
                  <S className="mb-2 h-3 w-full" />
                  <S className="mb-2 h-3 w-4/5" />
                  <div className="mt-3 flex items-center gap-2">
                    <S className="h-5 w-16 rounded-full" />
                    <S className="h-5 w-24" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Reviews section ─────────────────────────────────────── */}
        <div style={{ animation: "fadeSlideUp 0.4s 0.45s both" }}>
          <S className="mb-4 h-6 w-36" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border-border/50 bg-card rounded-xl border p-4">
                <div className="flex items-center gap-3">
                  <S className="size-9 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <S className="h-4 w-32" />
                    <S className="h-3 w-48" />
                  </div>
                  <S className="h-4 w-12" />
                </div>
                <S className="mt-3 h-3 w-full" />
                <S className="mt-1 h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingShell>
  )
}
