"use client";

import dynamic from "next/dynamic";

const AuthModal = dynamic(() => import("./auth-modal").then((m) => m.AuthModal), { ssr: false });
const ProviderProfileModal = dynamic(
  () => import("./provider-profile-modal").then((m) => m.ProviderProfileModal),
  { ssr: false },
);
const QuoteModal = dynamic(() => import("./quote-modal").then((m) => m.QuoteModal), { ssr: false });
const BookingModal = dynamic(() => import("./booking-modal").then((m) => m.BookingModal), { ssr: false });

/**
 * Single host that mounts every flow modal in the app.
 *
 * Each modal reads its own open-state from `useUIStore`, so this component
 * has no props — mount it once at the app shell (next to the main view).
 *
 * All modals are lazy-loaded (next/dynamic ssr:false) so their heavy
 * dependencies (framer-motion, hook-forms, zod, etc.) are fetched only
 * when a user triggers the corresponding flow.
 */
export function ModalsHost() {
  return (
    <>
      <AuthModal />
      <ProviderProfileModal />
      <QuoteModal />
      <BookingModal />
    </>
  );
}
