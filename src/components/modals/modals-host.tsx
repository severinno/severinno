"use client"

import dynamic from "next/dynamic"
import { AuthModal } from "./auth-modal"
import { ProviderProfileModal } from "./provider-profile-modal"
import { QuoteModal } from "./quote-modal"

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
 * BookingModal is lazy-loaded via next/dynamic to reduce initial bundle size.
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
