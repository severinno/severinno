import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="from-background via-background to-muted/30 min-h-screen bg-gradient-to-b">
        {/* ── Hero skeleton ────────────────────────────────────────── */}
        <div className="to-background border-b bg-gradient-to-b from-emerald-50/50 dark:from-emerald-950/10">
          <div className="mx-auto max-w-5xl px-4 pt-12 pb-8 sm:pt-16 sm:pb-10">
            <StaggerContainer stagger={0.06} className="text-center">
              <StaggerItem y={12} duration={0.35}>
                <S className="mx-auto mb-2 h-8 w-64 sm:h-9 sm:w-72" />
              </StaggerItem>
              <StaggerItem y={12} duration={0.35}>
                <S className="mx-auto h-4 w-48" />
              </StaggerItem>
            </StaggerContainer>

            <div
              className="relative mx-auto mt-8 max-w-2xl"
              style={{ animation: "fadeSlideUp 0.4s 0.15s both" }}
            >
              <S className="h-14 w-full rounded-xl" />
            </div>

            <div
              className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-2"
              style={{ animation: "fadeIn 0.4s 0.25s both" }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <S key={i} className="h-7 w-20 rounded-full" />
              ))}
            </div>
          </div>
        </div>

        {/* ── Results skeleton ─────────────────────────────────────── */}
        <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
          <StaggerContainer stagger={0.06} className="mb-6 flex items-center justify-between">
            <StaggerItem y={12} duration={0.35}>
              <S className="h-4 w-32" />
            </StaggerItem>
            <StaggerItem y={12} duration={0.35} className="flex items-center gap-2">
              <S className="h-8 w-28 rounded-lg" />
              <S className="h-8 w-20 rounded-lg" />
            </StaggerItem>
          </StaggerContainer>

          <StaggerContainer stagger={0.06} className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <StaggerItem key={i} y={12} duration={0.35}>
                <div className="border-border/50 bg-card rounded-xl border p-4">
                  <div className="flex gap-4">
                    <S className="size-14 shrink-0 rounded-xl" />
                    <div className="flex-1 space-y-2.5">
                      <S className="h-4 w-3/4" />
                      <S className="h-3 w-1/2" />
                      <S className="h-3 w-1/3" />
                      <div className="flex gap-2 pt-0.5">
                        <S className="h-5 w-16 rounded-full" />
                        <S className="h-4 w-20" />
                      </div>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </div>
    </LoadingShell>
  )
}
