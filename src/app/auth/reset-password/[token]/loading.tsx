import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-background p-4 dark:from-emerald-950/20">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
          <StaggerContainer stagger={0.06}>
            {/* Icon + title + subtitle */}
            <StaggerItem y={10} duration={0.35} className="mb-6 text-center">
              <S className="mx-auto mb-3 size-12 rounded-xl" />
              <S className="mx-auto h-6 w-36" />
              <S className="mx-auto mt-2 h-4 w-56" />
            </StaggerItem>

            {/* Password field */}
            <StaggerItem y={10} duration={0.35} className="space-y-1.5">
              <S className="h-4 w-24" />
              <S className="h-10 w-full rounded-lg" />
            </StaggerItem>

            {/* Confirm password field */}
            <StaggerItem y={10} duration={0.35} className="mt-4 space-y-1.5">
              <S className="h-4 w-32" />
              <S className="h-10 w-full rounded-lg" />
            </StaggerItem>

            {/* Submit button */}
            <StaggerItem y={10} duration={0.35} className="mt-6">
              <S className="h-11 w-full rounded-lg" />
            </StaggerItem>
          </StaggerContainer>
        </div>
      </div>
    </LoadingShell>
  )
}
