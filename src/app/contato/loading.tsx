import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-3xl px-4 py-12">
        <StaggerContainer stagger={0.06}>
          {/* Title */}
          <StaggerItem y={12} duration={0.35}>
            <S className="h-9 w-32" />
          </StaggerItem>

          {/* Subtitle */}
          <StaggerItem y={12} duration={0.35} className="mt-2">
            <S className="h-4 w-64" />
          </StaggerItem>

          {/* Contact cards grid */}
          <StaggerItem y={12} duration={0.35} className="mt-8">
            <div className="grid gap-6 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-6">
                  <S className="h-5 w-20" />
                  <S className="mt-2 h-3.5 w-36" />
                  <S className="mt-3 h-5 w-44" />
                </div>
              ))}
            </div>
          </StaggerItem>
        </StaggerContainer>
      </div>
    </LoadingShell>
  )
}
