"use client"

import dynamic from "next/dynamic"

const AuthModal = dynamic(() => import("./auth-modal").then((m) => ({ default: m.AuthModal })), {
  ssr: false,
})
const ProviderProfileModal = dynamic(
  () => import("./provider-profile-modal").then((m) => ({ default: m.ProviderProfileModal })),
  { ssr: false },
)
const QuoteModal = dynamic(() => import("./quote-modal").then((m) => ({ default: m.QuoteModal })), {
  ssr: false,
})
const BookingModal = dynamic(
  () => import("./booking-modal").then((m) => ({ default: m.BookingModal })),
  { ssr: false },
)

/**
 * Single host that mounts every flow modal in the app.
 *
 * Each modal reads its own open-state from `useUIStore`, so this component
 * has no props — mount it once at the app shell (next to the main view).
 *
 * All modals are lazy-loaded via next/dynamic to reduce initial bundle size.
 */
export function ModalsHost() {
  return (
    <>
      <AuthModal />
      <ProviderProfileModal />
      <QuoteModal />
      <BookingModal />
    </>
  )
}
