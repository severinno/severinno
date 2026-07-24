import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-3xl px-4 py-12">
        <StaggerContainer stagger={0.06}>
          {/* Main title */}
          <StaggerItem y={12} duration={0.35}>
            <S className="h-9 w-48" />
          </StaggerItem>

          {/* Date */}
          <StaggerItem y={12} duration={0.35} className="mt-2">
            <S className="h-4 w-52" />
          </StaggerItem>

          {/* Section 1 */}
          <StaggerItem y={12} duration={0.35} className="mt-8">
            <S className="h-6 w-56" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.35} className="mt-2 space-y-2">
            <S className="h-4 w-full" />
            <S className="h-4 w-4/5" />
          </StaggerItem>

          {/* Section 2 */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <S className="h-6 w-44" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.35} className="mt-2 space-y-2">
            <S className="h-4 w-full" />
            <S className="h-4 w-3/4" />
            <S className="h-4 w-5/6" />
          </StaggerItem>

          {/* Section 3 */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <S className="h-6 w-36" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.35} className="mt-2 space-y-2">
            <S className="h-4 w-full" />
            <S className="h-4 w-11/12" />
          </StaggerItem>

          {/* Section 4 */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <S className="h-6 w-40" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.35} className="mt-2 space-y-2">
            <S className="h-4 w-full" />
            <S className="h-4 w-5/6" />
            <S className="h-4 w-2/3" />
          </StaggerItem>

          {/* Section 5 */}
          <StaggerItem y={12} duration={0.35} className="mt-6">
            <S className="h-6 w-48" />
          </StaggerItem>
          <StaggerItem y={12} duration={0.35} className="mt-2 space-y-2">
            <S className="h-4 w-full" />
            <S className="h-4 w-3/5" />
          </StaggerItem>
        </StaggerContainer>
      </div>
    </LoadingShell>
  )
}
