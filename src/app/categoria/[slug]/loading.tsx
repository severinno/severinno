import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Breadcrumb */}
        <div
          className="mb-6"
          style={{ animation: "fadeIn 0.3s both" }}
        >
          <S className="h-4 w-48" />
        </div>

        {/* Title + description */}
        <StaggerContainer stagger={0.05} className="mb-8">
          <StaggerItem y={12} duration={0.3}>
            <S className="h-9 w-64" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.3}>
            <S className="mt-2 h-5 w-96" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.3}>
            <S className="mt-1 h-5 w-80" />
          </StaggerItem>
        </StaggerContainer>

        {/* Filter bar */}
        <div
          className="mb-6 flex gap-3"
          style={{ animation: "fadeSlideUp 0.3s 0.15s both" }}
        >
          <S className="h-10 flex-1 rounded-lg" />
          <S className="h-10 w-32 rounded-lg" />
          <S className="h-10 w-32 rounded-lg" />
        </div>

        {/* Category highlight cards */}
        <StaggerContainer stagger={0.05} className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StaggerItem key={i} y={12} duration={0.3}>
              <div className="rounded-xl border border-border/50 bg-card p-5">
                <S className="mb-3 size-10 rounded-lg" />
                <S className="mb-1 h-4 w-24" />
                <S className="h-3 w-32" />
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        {/* Provider cards grid */}
        <StaggerContainer stagger={0.05} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StaggerItem key={i} y={12} duration={0.3}>
              <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
                <S className="aspect-video w-full rounded-none" />
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <S className="size-10 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <S className="h-4 w-3/4" />
                      <S className="h-3 w-1/2" />
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <S className="h-3 w-full" />
                    <S className="h-3 w-2/3" />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <S className="h-5 w-16 rounded-full" />
                    <S className="h-4 w-20" />
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </LoadingShell>
  )
}
