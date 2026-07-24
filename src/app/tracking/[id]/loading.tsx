import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Breadcrumb */}
        <div style={{ animation: "fadeIn 0.3s both" }} className="mb-6">
          <S className="h-4 w-48" />
        </div>

        <StaggerContainer stagger={0.06}>
          {/* Page title */}
          <StaggerItem y={12} duration={0.35}>
            <S className="h-7 w-64" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.35} className="mt-1">
            <S className="h-4 w-48" />
          </StaggerItem>

          {/* Status badge */}
          <StaggerItem y={12} duration={0.35} className="mt-4">
            <S className="h-7 w-28 rounded-full" />
          </StaggerItem>

          {/* ── Map placeholder (aspect-video) ──────────────────────── */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/20">
              <div className="flex aspect-video items-center justify-center">
                <S className="size-full rounded-none" />
              </div>
            </div>
          </StaggerItem>

          {/* ── Booking details card ────────────────────────────────── */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Provider */}
                <div className="space-y-2">
                  <S className="h-3.5 w-20" />
                  <div className="flex items-center gap-3">
                    <S className="size-10 rounded-full" />
                    <div className="space-y-1.5">
                      <S className="h-4 w-28" />
                      <S className="h-3 w-20" />
                    </div>
                  </div>
                </div>

                {/* Service */}
                <div className="space-y-2">
                  <S className="h-3.5 w-16" />
                  <S className="h-4 w-36" />
                  <S className="h-5 w-20" />
                </div>

                {/* Date/time */}
                <div className="space-y-2">
                  <S className="h-3.5 w-14" />
                  <S className="h-4 w-40" />
                  <S className="h-3 w-24" />
                </div>

                {/* Address */}
                <div className="space-y-2">
                  <S className="h-3.5 w-16" />
                  <S className="h-4 w-44" />
                  <S className="h-3 w-32" />
                </div>
              </div>
            </div>
          </StaggerItem>

          {/* ── Progress / timeline ─────────────────────────────────── */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <div className="rounded-xl border border-border/50 bg-card p-6">
              <S className="mb-4 h-5 w-24" />
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <S className="mt-0.5 size-3 rounded-full" />
                    <div className="flex-1 space-y-1">
                      <S className="h-4 w-32" />
                      <S className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </StaggerItem>
        </StaggerContainer>
      </div>
    </LoadingShell>
  )
}
