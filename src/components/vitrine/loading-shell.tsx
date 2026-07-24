/**
 * LoadingShell — streaming fallback for the vitrine page.
 *
 * Renders a lightweight placeholder while the full client bundle loads.
 * The HTML is sent immediately (streaming), giving the user instant
 * visual feedback while JavaScript parses and hydrates.
 *
 * Matches the vitrine layout (topbar → main → footer) to prevent layout
 * shift when the real content loads.
 */

export function LoadingShell() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Topbar skeleton */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          <div className="hidden h-10 w-64 animate-pulse rounded-full bg-muted md:block" />
          <div className="flex items-center gap-3">
            <div className="size-9 animate-pulse rounded-full bg-muted" />
            <div className="size-9 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero skeleton — approx 600px tall */}
        <section className="relative flex min-h-[600px] items-center justify-center overflow-hidden bg-gradient-to-b from-emerald-50 to-background px-4">
          <div className="w-full max-w-3xl text-center">
            <div className="mx-auto mb-6 h-12 w-3/4 animate-pulse rounded bg-muted" />
            <div className="mx-auto mb-8 h-5 w-1/2 animate-pulse rounded bg-muted" />
            <div className="mx-auto h-12 w-full max-w-xl animate-pulse rounded-full bg-muted" />
            <div className="mx-auto mt-8 flex justify-center gap-3">
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        </section>

        {/* Results skeleton — approx 400px */}
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-8">
            <aside className="hidden lg:block">
              <div className="h-[400px] animate-pulse rounded-xl bg-muted" />
            </aside>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[420px] animate-pulse rounded-xl bg-muted"
                />
              ))}
            </div>
          </div>
        </section>

        {/* How it works skeleton */}
        <section className="bg-muted/30 px-4 py-16">
          <div className="mx-auto max-w-5xl text-center">
            <div className="mx-auto mb-12 h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          </div>
        </section>

        {/* FAQ skeleton */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto mb-12 h-8 w-40 animate-pulse rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="mb-3 h-16 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        </section>
      </main>

      {/* Footer skeleton */}
      <footer className="border-t bg-card px-4 py-12">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="h-5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </footer>
    </div>
  )
}
