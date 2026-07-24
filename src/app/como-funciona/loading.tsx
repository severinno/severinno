import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-3xl px-4 py-12">
        <StaggerContainer stagger={0.06}>
          {/* Title */}
          <StaggerItem y={12} duration={0.35}>
            <S className="h-9 w-64" />
          </StaggerItem>

          {/* 4 steps */}
          {Array.from({ length: 4 }).map((_, i) => (
            <StaggerItem key={i} y={12} duration={0.35} className="mt-8">
              <div className="flex gap-4">
                {/* Numbered circle */}
                <S className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  {/* Step title */}
                  <S className="h-6 w-48" />
                  {/* Step description */}
                  <S className="h-4 w-full" />
                  <S className="h-4 w-5/6" />
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </LoadingShell>
  )
}
