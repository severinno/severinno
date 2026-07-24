import { LoadingShell, StaggerContainer, StaggerItem, S } from "@/app/loading-shell"

export default function Loading() {
  return (
    <LoadingShell>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <StaggerContainer stagger={0.06} className="mb-6">
          <StaggerItem y={10} duration={0.35}>
            <S className="h-6 w-36" />
          </StaggerItem>
          <StaggerItem y={10} duration={0.35} className="mt-1">
            <S className="h-4 w-80" />
          </StaggerItem>
        </StaggerContainer>

        {/* Grid: avatar sidebar + form */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ── Avatar / identity sidebar ────────────────────────── */}
          <StaggerContainer stagger={0.06} className="lg:col-span-1">
            <StaggerItem y={10} duration={0.35}>
              <div className="rounded-xl border bg-card">
                <div className="flex flex-col items-center gap-3 p-6">
                  {/* Avatar */}
                  <S className="size-24 rounded-full ring-4 ring-background shadow-md" />
                  {/* Name + email */}
                  <div className="text-center">
                    <S className="mx-auto h-4 w-28" />
                    <S className="mx-auto mt-1 h-3 w-36" />
                  </div>
                  {/* Badges */}
                  <div className="flex items-center gap-1.5">
                    <S className="h-5 w-16 rounded-full" />
                    <S className="h-5 w-20 rounded-full" />
                  </div>
                </div>
                {/* Readonly fields */}
                <div className="space-y-3 border-t px-6 pb-6 pt-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <S className="size-4 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <S className="h-2.5 w-12" />
                        <S className="h-4 w-28" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>
          </StaggerContainer>

          {/* ── Editable fields ─────────────────────────────────── */}
          <div className="lg:col-span-2">
            <StaggerContainer stagger={0.06} className="rounded-xl border bg-card p-6">
              {/* Name + WhatsApp row */}
              <StaggerItem y={10} duration={0.35}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <S className="h-4 w-28" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                  <div className="space-y-1.5">
                    <S className="h-4 w-20" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                </div>
              </StaggerItem>

              {/* Phone row */}
              <StaggerItem y={10} duration={0.35} className="mt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <S className="h-4 w-24" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                </div>
              </StaggerItem>

              {/* Bio */}
              <StaggerItem y={10} duration={0.35} className="mt-4 space-y-1.5">
                <S className="h-4 w-16" />
                <S className="h-24 w-full rounded-lg" />
                <S className="ml-auto h-3 w-12" />
              </StaggerItem>

              {/* Address section */}
              <StaggerItem y={10} duration={0.35} className="mt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <S className="size-4" />
                  <S className="h-4 w-20" />
                </div>
                <S className="h-3 w-72" />
                {/* Address form fields */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-10" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-14" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-20" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-16" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-10" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-12" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                  <div className="space-y-1.5">
                    <S className="h-3.5 w-14" />
                    <S className="h-10 w-full rounded-lg" />
                  </div>
                </div>
              </StaggerItem>

              {/* Action buttons */}
              <StaggerItem y={10} duration={0.35} className="mt-6 flex items-center justify-end gap-2 border-t pt-4">
                <S className="h-10 w-24 rounded-lg" />
                <S className="h-10 w-40 rounded-lg" />
              </StaggerItem>

              {/* Change Password section */}
              <StaggerItem y={10} duration={0.35} className="mt-6 space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <S className="size-4" />
                  <S className="h-4 w-32" />
                </div>
                <p className="text-xs text-muted-foreground">
                  <S className="h-3 w-64" />
                </p>
                <div className="space-y-1.5">
                  <S className="h-3.5 w-28" />
                  <S className="h-10 w-full rounded-lg sm:w-80" />
                </div>
                <div className="space-y-1.5">
                  <S className="h-3.5 w-20" />
                  <S className="h-10 w-full rounded-lg sm:w-80" />
                </div>
                <S className="h-10 w-36 rounded-lg" />
              </StaggerItem>
            </StaggerContainer>
          </div>
        </div>
      </div>
    </LoadingShell>
  )
}
