"use client"

/**
 * Recently-viewed providers store — recognition over recall (Nielsen H6).
 * Persists the last 8 providers the visitor opened (max 8 to keep it tidy).
 * Stored as minimal cards so we can render previews without refetching.
 */

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { ProviderCard } from "@/lib/api"

type RecentlyViewState = {
  items: ProviderCard[]
  addView: (provider: ProviderCard) => void
  clear: () => void
}

const MAX_ITEMS = 8

export const useRecentlyViewedStore = create<RecentlyViewState>()(
  persist(
    (set, get) => ({
      items: [],

      addView: (provider) => {
        const current = get().items
        // Remove if already present (we'll re-add at the top)
        const filtered = current.filter((p) => p.id !== provider.id)
        const next = [provider, ...filtered].slice(0, MAX_ITEMS)
        set({ items: next })
      },

      clear: () => set({ items: [] }),
    }),
    {
      name: "severinno:recently-viewed",
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
