import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="to-background flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 p-4 dark:from-emerald-950/20">
        <div className="bg-card w-full max-w-md rounded-2xl border p-8 shadow-lg">
          <StaggerContainer stagger={0.06}>
            {/* Icon + title + subtitle */}
            <StaggerItem y={10} duration={0.35} className="mb-6 text-center">
              <S className="mx-auto mb-3 size-12 rounded-xl" />
              <S className="mx-auto h-6 w-44" />
              <S className="mx-auto mt-2 h-4 w-64" />
            </StaggerItem>

            {/* Form field 1: label + input */}
            <StaggerItem y={10} duration={0.35} className="space-y-1.5">
              <S className="h-4 w-20" />
              <S className="h-10 w-full rounded-lg" />
            </StaggerItem>

            {/* Submit button */}
            <StaggerItem y={10} duration={0.35} className="mt-6">
              <S className="h-11 w-full rounded-lg" />
            </StaggerItem>

            {/* Back link */}
            <StaggerItem y={10} duration={0.35} className="mt-4 text-center">
              <S className="mx-auto h-4 w-32" />
            </StaggerItem>
          </StaggerContainer>
        </div>
      </div>
    </LoadingShell>
  )
}
