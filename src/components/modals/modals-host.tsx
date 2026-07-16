"use client"

import { AuthModal } from "./auth-modal"
import { ProviderProfileModal } from "./provider-profile-modal"
import { QuoteModal } from "./quote-modal"
import { BookingModal } from "./booking-modal"

/**
 * Single host that mounts every flow modal in the app.
 *
 * Each modal reads its own open-state from `useUIStore`, so this component
 * has no props — mount it once at the app shell (next to the main view).
 *
 * All modals are client components ("use client") and guard against SSR by
 * rendering nothing until their `open` flag is true (driven by user
 * interaction, so always false on the server).
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
