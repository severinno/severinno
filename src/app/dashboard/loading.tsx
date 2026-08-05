import { LoadingShell, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="bg-background flex min-h-screen flex-col">
        {/* ── Topbar skeleton ──────────────────────────────────── */}
        <div className="bg-card border-b px-4 py-3">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div className="flex items-center gap-4">
              <S className="h-7 w-28" />
              <div className="hidden gap-4 md:flex">
                {Array.from({ length: 3 }).map((_, i) => (
                  <S key={i} className="h-4 w-16" />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <S className="hidden h-8 w-20 rounded-full sm:block" />
              <S className="size-8 rounded-full" />
            </div>
          </div>
        </div>

        {/* ── Sidebar + content skeleton ───────────────────────── */}
        <div className="mx-auto flex w-full max-w-7xl flex-1">
          {/* Sidebar */}
          <div className="hidden w-56 shrink-0 border-r p-4 sm:block">
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <S className="size-4" />
                  <S className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 p-4 sm:p-6">
            <div style={{ animation: "fadeSlideUp 0.35s both" }}>
              {/* Header */}
              <S className="mb-1 h-6 w-44" />
              <S className="mb-6 h-4 w-72" />

              {/* Stats cards grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="border-border/50 bg-card rounded-xl border p-5"
                    style={{ animation: `fadeSlideUp 0.35s ${0.1 + i * 0.06}s both` }}
                  >
                    <div className="flex items-center justify-between">
                      <S className="h-6 w-20" />
                      <S className="size-8 rounded-lg" />
                    </div>
                    <S className="mt-3 h-8 w-16" />
                    <S className="mt-1 h-3 w-28" />
                  </div>
                ))}
              </div>

              {/* Table / list */}
              <div
                className="border-border/50 bg-card mt-6 rounded-xl border p-5"
                style={{ animation: "fadeSlideUp 0.35s 0.35s both" }}
              >
                <S className="mb-4 h-5 w-36" />
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <S className="h-3 w-8" />
                      <S className="h-4 flex-1" />
                      <S className="h-4 w-24" />
                      <S className="h-5 w-20 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LoadingShell>
  )
}
