"use client"

import { create } from "zustand"

export type AuthModalMode = "login" | "register"
export type AuthModalRole = "CLIENT" | "PROVIDER"

type QuoteModalState = {
  open: boolean
  providerId?: string
  serviceId?: string
}

type BookingModalState = {
  open: boolean
  providerId?: string
  serviceId?: string
}

type ProviderModalState = {
  open: boolean
  providerId?: string
}

type AuthModalState = {
  open: boolean
  mode: AuthModalMode
  role: AuthModalRole
}

type UIState = {
  quoteModal: QuoteModalState
  bookingModal: BookingModalState
  providerModal: ProviderModalState
  authModal: AuthModalState

  // global mobile sidebar / drawer for app shell
  sidebarOpen: boolean

  openQuote: (opts?: Partial<QuoteModalState>) => void
  closeQuote: () => void

  openBooking: (opts?: Partial<BookingModalState>) => void
  closeBooking: () => void

  openProvider: (providerId: string) => void
  closeProvider: () => void

  openAuth: (mode?: AuthModalMode, role?: AuthModalRole) => void
  closeAuth: () => void

  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>()((set) => ({
  quoteModal: { open: false },
  bookingModal: { open: false },
  providerModal: { open: false },
  authModal: { open: false, mode: "login", role: "CLIENT" },
  sidebarOpen: false,

  openQuote: (opts) =>
    set((s) => ({ quoteModal: { ...s.quoteModal, open: true, ...opts } })),
  closeQuote: () => set((s) => ({ quoteModal: { ...s.quoteModal, open: false } })),

  openBooking: (opts) =>
    set((s) => ({ bookingModal: { ...s.bookingModal, open: true, ...opts } })),
  closeBooking: () =>
    set((s) => ({ bookingModal: { ...s.bookingModal, open: false } })),

  openProvider: (providerId) =>
    set(() => ({ providerModal: { open: true, providerId } })),
  closeProvider: () =>
    set((s) => ({ providerModal: { ...s.providerModal, open: false } })),

  openAuth: (mode = "login", role = "CLIENT") =>
    set(() => ({ authModal: { open: true, mode, role } })),
  closeAuth: () =>
    set((s) => ({ authModal: { ...s.authModal, open: false } })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
