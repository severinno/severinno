"use client";

/**
 * Compare store — tracks up to 3 providers the visitor is comparing.
 *
 * Persisted to localStorage so the selection survives reloads.
 * The store is intentionally UI-only (no API calls); the CompareModal
 * fetches full provider details via /api/providers when opened.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const MAX_COMPARE = 3;

type CompareState = {
  ids: string[];
  modalOpen: boolean;

  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  isAdded: (id: string) => boolean;

  openCompare: () => void;
  closeCompare: () => void;
};

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      ids: [],
      modalOpen: false,

      toggle: (id) =>
        set((s) => {
          if (s.ids.includes(id)) {
            return { ids: s.ids.filter((x) => x !== id) };
          }
          if (s.ids.length >= MAX_COMPARE) {
            return s; // ignore — caller should toast a warning
          }
          return { ids: [...s.ids, id] };
        }),

      remove: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),

      clear: () => set({ ids: [] }),

      isAdded: (id) => get().ids.includes(id),

      openCompare: () => set({ modalOpen: true }),
      closeCompare: () => set({ modalOpen: false }),
    }),
    {
      name: "severinno-compare",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ ids: s.ids }),
    },
  ),
);
