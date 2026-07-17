"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * View-switching store — drives the SPA's single-route navigation.
 *
 * `view` is a dotted string like 'vitrine', 'client.dashboard',
 * 'provider.services', 'admin.taxonomy', 'provider.profile' etc.
 * `params` carries view-specific data (providerId, bookingId, ...).
 *
 * `history` enables a back() stack.
 */

export type ViewParams = Record<string, unknown>

type HistoryEntry = { view: string; params: ViewParams }

type ViewState = {
  view: string
  params: ViewParams
  history: HistoryEntry[]

  navigate: (view: string, params?: ViewParams) => void
  back: () => void
  reset: (view?: string, params?: ViewParams) => void
  canGoBack: () => boolean
}

const DEFAULT_VIEW = "vitrine"

export const useViewStore = create<ViewState>()(
  persist(
    (set, get) => ({
      view: DEFAULT_VIEW,
      params: {},
      history: [],

      navigate: (view, params = {}) => {
        const current = get()
        set({
          view,
          params,
          history: [...current.history, { view: current.view, params: current.params }],
        })
      },

      back: () => {
        const history = get().history
        if (history.length === 0) return
        const last = history[history.length - 1]
        set({
          view: last.view,
          params: last.params,
          history: history.slice(0, -1),
        })
      },

      reset: (view = DEFAULT_VIEW, params = {}) => {
        set({ view, params, history: [] })
      },

      canGoBack: () => get().history.length > 0,
    }),
    {
      name: "severinno:view",
      storage: createJSONStorage(() => localStorage),
      // Persist only the top-level view (not the entire history) so a
      // refreshed user lands back on a sensible page without the back stack.
      partialize: (s) => ({ view: s.view, params: s.params }),
    },
  ),
)
