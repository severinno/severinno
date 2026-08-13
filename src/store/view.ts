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
const MAX_HISTORY = 25

function syncUrlWithView(view: string, params: ViewParams = {}, replace = false): void {
  if (typeof window === "undefined" || !window.history) return

  try {
    const url = new URL(window.location.href)
    if (view === DEFAULT_VIEW && Object.keys(params).length === 0) {
      url.searchParams.delete("view")
    } else {
      url.searchParams.set("view", view)
    }

    const stateObj = { view, params }
    if (replace) {
      window.history.replaceState(stateObj, "", url.toString())
    } else {
      window.history.pushState(stateObj, "", url.toString())
    }
  } catch {
    // Silent fail in restrictive sandboxes
  }
}

function getInitialView(): { view: string; params: ViewParams } {
  if (typeof window === "undefined") {
    return { view: DEFAULT_VIEW, params: {} }
  }

  try {
    const url = new URL(window.location.href)
    const viewFromUrl = url.searchParams.get("view")
    if (viewFromUrl) {
      return { view: viewFromUrl, params: {} }
    }
  } catch {
    // Fallback
  }

  return { view: DEFAULT_VIEW, params: {} }
}

export const useViewStore = create<ViewState>()(
  persist(
    (set, get) => {
      // Wire up popstate listener in browser
      if (typeof window !== "undefined") {
        window.addEventListener("popstate", (event) => {
          const state = event.state as { view?: string; params?: ViewParams } | null
          if (state?.view) {
            set({ view: state.view, params: state.params ?? {} })
          } else {
            const initial = getInitialView()
            set({ view: initial.view, params: initial.params })
          }
        })
      }

      return {
        view: DEFAULT_VIEW,
        params: {},
        history: [],

        navigate: (view, params = {}) => {
          const current = get()
          syncUrlWithView(view, params, false)
          const newHistory = [
            ...current.history,
            { view: current.view, params: current.params },
          ].slice(-MAX_HISTORY)

          set({
            view,
            params,
            history: newHistory,
          })
        },

        back: () => {
          const history = get().history
          if (history.length === 0) return
          const last = history[history.length - 1]
          syncUrlWithView(last.view, last.params, true)
          set({
            view: last.view,
            params: last.params,
            history: history.slice(0, -1),
          })
        },

        reset: (view = DEFAULT_VIEW, params = {}) => {
          syncUrlWithView(view, params, true)
          set({ view, params, history: [] })
        },

        canGoBack: () => get().history.length > 0,
      }
    },
    {
      name: "severinno:view",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ view: s.view, params: s.params }),
    },
  ),
)
