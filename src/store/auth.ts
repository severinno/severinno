"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { apiPost, apiGet } from "@/lib/api"

export type UserRole = "CLIENT" | "PROVIDER" | "ADMIN"

export type AuthUser = {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
  soundEnabled?: boolean
  vibrateEnabled?: boolean
}

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated"

type LoginPayload = { email: string; password: string }
type RegisterPayload = Record<string, unknown>

type AuthState = {
  user: AuthUser | null
  status: AuthStatus
  error: string | null
  initialized: boolean
  /** Expiry EFETIVO do cookie de sessão (unix seconds) — do /api/auth/me.
   *  Usado pelo countdown "sessão expira em X dias" no dashboard. */
  sessionExpiresAt: number | null

  // actions
  login: (payload: LoginPayload) => Promise<{ ok: boolean; error?: string }>
  register: (payload: RegisterPayload) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  /** Renovação PROATIVA da sessão (não-destrutiva) — ver implementação. */
  renewSession: () => Promise<void>
  /** Semear o countdown via SSR (server components): preenche
   *  sessionExpiresAt SOMENTE se ainda estiver null — o fetchMe (rede) pode
   *  estar lento, e um valor já resolvido nunca é sobrescrito. Não muda
   *  user/status: é só o paint inicial do countdown, sem efeitos colaterais. */
  seedSessionExpiry: (expiresAt: number | null) => void
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
      sessionExpiresAt: null,

      setUser: (user) =>
        set({
          user,
          status: user ? "authenticated" : "unauthenticated",
          initialized: true,
        }),

      clearError: () => set({ error: null }),

      // Seed do countdown via SSR: preenche só se vazio (primeiro paint antes
      // do fetchMe resolver). Se já houver valor (fetchMe mais rápido, outro
      // seed), mantém — o mais fresco vence.
      seedSessionExpiry: (expiresAt) =>
        set((s) => ({
          sessionExpiresAt: s.sessionExpiresAt ?? expiresAt,
        })),

      login: async ({ email, password }) => {
        set({ status: "loading", error: null })
        try {
          const data = await apiPost<{ user: AuthUser }>("/api/auth/login", {
            email,
            password,
          })
          if (!data?.user) {
            const msg = "Não foi possível entrar. Verifique seus dados."
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
        } catch (e: unknown) {
          const msg =
            (e && typeof e === "object" && "message" in e
              ? String((e as { message: string }).message)
              : null) ?? "Erro de rede ao entrar. Tente novamente."
          set({ status: "unauthenticated", error: msg })
          return { ok: false, error: msg }
        }
      },

      register: async (payload) => {
        set({ status: "loading", error: null })
        try {
          const data = await apiPost<{ user: AuthUser }>("/api/auth/register", payload)
          if (!data?.user) {
            const msg = "Não foi possível criar a conta."
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
        } catch (e: unknown) {
          const msg =
            (e && typeof e === "object" && "message" in e
              ? String((e as { message: string }).message)
              : null) ?? "Erro de rede ao criar conta. Tente novamente."
          set({ status: "unauthenticated", error: msg })
          return { ok: false, error: msg }
        }
      },

      logout: async () => {
        try {
          await apiPost("/api/auth/logout")
        } catch {
          // ignore network errors on logout
        } finally {
          set({ user: null, status: "unauthenticated", error: null, sessionExpiresAt: null })
        }
      },

      // Renovação proativa do cookie (botão "Renovar" do aviso de sessão):
      // GET /api/auth/me dispara o getSession server-side, que REEMITE o
      // cookie na janela <15d e devolve o novo expiresAt. Diferente do
      // fetchMe (que em erro de rede marca unauthenticated e derruba o
      // usuário para o login), esta ação é NÃO-DESTRUTIVA: em erro, apenas
      // mantém o estado atual — um renew que falha não pode expulsar o user.
      renewSession: async () => {
        try {
          const data = await apiGet<{ user: AuthUser; expiresAt?: number | null }>("/api/auth/me")
          // Sem user na resposta (cookie inválido/expirado) → mantém o estado
          // atual; o próximo fetchMe/guarda de rota resolve a expulsão.
          if (data?.user) {
            set({
              user: data.user as AuthUser,
              status: "authenticated",
              initialized: true,
              sessionExpiresAt: data.expiresAt ?? null,
            })
          }
        } catch {
          // Best-effort: falha de rede/5xx NUNCA derruba o usuário logado.
        }
      },

      fetchMe: async () => {
        try {
          const data = await apiGet<{ user: AuthUser; expiresAt?: number | null }>("/api/auth/me")
          if (data?.user) {
            set({
              user: data.user as AuthUser,
              status: "authenticated",
              initialized: true,
              // expiresAt efetivo do cookie (unix seconds) — countdown da sessão.
              sessionExpiresAt: data.expiresAt ?? null,
            })
          } else {
            set({
              user: null,
              status: "unauthenticated",
              initialized: true,
              sessionExpiresAt: null,
            })
          }
        } catch {
          set({
            user: null,
            status: "unauthenticated",
            initialized: true,
            sessionExpiresAt: null,
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
