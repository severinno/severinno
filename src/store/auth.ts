"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export type UserRole = "CLIENT" | "PROVIDER" | "ADMIN"

export type AuthUser = {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
}

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated"

type LoginPayload = { email: string; password: string }
type RegisterPayload = Record<string, unknown>

type AuthState = {
  user: AuthUser | null
  status: AuthStatus
  error: string | null
  initialized: boolean

  // actions
  login: (payload: LoginPayload) => Promise<{ ok: boolean; error?: string }>
  register: (
    payload: RegisterPayload,
  ) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  setUser: (user: AuthUser | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      status: "idle",
      error: null,
      initialized: false,

      setUser: (user) =>
        set({
          user,
          status: user ? "authenticated" : "unauthenticated",
          initialized: true,
        }),

      clearError: () => set({ error: null }),

      login: async ({ email, password }) => {
        set({ status: "loading", error: null })
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          })
          const data = await res.json()
          if (!res.ok || !data?.user) {
            const msg =
              data?.error || "Não foi possível entrar. Verifique seus dados."
            set({ status: "unauthenticated", error: msg })
            return { ok: false, error: msg }
          }
          set({
            user: data.user as AuthUser,
            status: "authenticated",
            error: null,
            initialized: true,
          })
          return { ok: true }
        } catch (e) {
          const msg = "Erro de rede ao entrar. Tente novamente."
          set({ status: "unauthenticated", error: msg })
          return { ok: false, error: msg }
        }
      },

      register: async (payload) => {
        set({ status: "loading", error: null })
        try {
          const res = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          const data = await res.json()
          if (!res.ok || !data?.user) {
            const msg = data?.error || "Não foi possível criar a conta."
            set({ status: "unauthenticated", error: msg })
            return { ok: false, error: msg }
          }
          set({
            user: data.user as AuthUser,
            status: "authenticated",
            error: null,
            initialized: true,
          })
          return { ok: true }
        } catch (e) {
          const msg = "Erro de rede ao criar conta. Tente novamente."
          set({ status: "unauthenticated", error: msg })
          return { ok: false, error: msg }
        }
      },

      logout: async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST" })
        } catch {
          // ignore network errors on logout
        } finally {
          set({ user: null, status: "unauthenticated", error: null })
        }
      },

      fetchMe: async () => {
        try {
          const res = await fetch("/api/auth/me", { cache: "no-store" })
          if (!res.ok) {
            set({
              user: null,
              status: "unauthenticated",
              initialized: true,
            })
            return
          }
          const data = await res.json()
          if (data?.user) {
            set({
              user: data.user as AuthUser,
              status: "authenticated",
              initialized: true,
            })
          } else {
            set({
              user: null,
              status: "unauthenticated",
              initialized: true,
            })
          }
        } catch {
          set({
            user: null,
            status: "unauthenticated",
            initialized: true,
          })
        }
      },
    }),
    {
      name: "severinno:auth",
      storage: createJSONStorage(() => localStorage),
      // Persist only the user + status so a refresh restores the session
      // without falsely reporting `initialized` before fetchMe() has
      // verified the cookie server-side. `initialized` always starts false
      // and flips to true only after the first fetchMe() on mount.
      partialize: (state) => ({
        user: state.user,
        status: state.status,
      }),
    },
  ),
)
