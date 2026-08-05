/**
 * Home — Server Component with SSR Streaming.
 *
 * The initial HTML (skeleton/shell) ships immediately while the full
 * interactive client bundle loads and hydrates. This gives users instant
 * visual feedback and makes the page SEO-friendly.
 *
 * Sections with interactive state (filtering, search, auth) are wrapped
 * in Suspense so they load progressively without blocking the rest of
 * the page.
 *
 * The real work (view routing, auth, data fetching, interactivity)
 * happens inside the suspended client component.
 */

import { Suspense } from "react"
import dynamic from "next/dynamic"

import { LoadingShell } from "@/components/vitrine/loading-shell"

// The full app shell — view router, auth, panels, all interactivity.
// Loaded inside Suspense so the shell streams immediately.
const AppShell = dynamic(() => import("@/components/app-shell"), {
  ssr: true,
  loading: () => <LoadingShell />,
})

export default function Home() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <AppShell />
    </Suspense>
  )
}
