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
 *
 * SEO/PERFORMANCE (parecer 08/2026): esta store é NAVEGAÇÃO INTERNA da SPA
 * (login obrigatório) — o estado vive em localStorage, NÃO na URL, então NÃO
 * é indexável. As páginas públicas indexáveis são as rotas reais do Next.js
 * (ex.: /busca?q=... em src/app/busca/search-page.tsx, com metadata) — NÃO
 * use useViewStore para páginas que o Google deve indexar. Limites impostos
 * aqui: o histórico é CAPADO (HISTORY_LIMIT) e navegações para a MESMA view
 * com os MESMOS params não duplicam a pilha — sem esses limites, uma sessão
 * longa de clicks cresceria o localStorage sem limite (write no persist a
 * cada navigate) e o back() atravessaria dezenas de entradas repetidas.
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

/**
 * Tamanho máximo da pilha de histórico. Um cap previne o crescimento
 * ilimitado do localStorage (o persist grava a cada navigate) e limita o
 * custo do back() — entradas mais antigas que o limite são descartadas.
 * 50 é generoso para uma sessão típica e barato de persistir.
 */
export const HISTORY_LIMIT = 50

/**
 * Comparação rasa de params — usada para NÃO duplicar entradas de histórico
 * quando o usuário navega para a MESMA view com os MESMOS params (ex.: clicar
 * duas vezes no mesmo item). Params são planos (ids/strings), então a
 * comparação rasa é suficiente; valores não-primitivos são tratados como
 * diferentes (nunca dedupe falso positivo).
 */
function sameViewAndParams(a: ViewParams, b: ViewParams): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a[k] === b[k])
}

export const useViewStore = create<ViewState>()(
  persist(
    (set, get) => ({
      view: DEFAULT_VIEW,
      params: {},
      history: [],

      navigate: (view, params = {}) => {
        const current = get()
        // Dedupe: navegar para a MESMA view com os MESMOS params não empilha
        // uma entrada repetida (só atualiza params se a view for a mesma).
        if (current.view === view && sameViewAndParams(current.params, params)) return
        const history = [...current.history, { view: current.view, params: current.params }]
        // Cap: descarta as entradas mais antigas além do HISTORY_LIMIT —
        // mantém a pilha finita (localStorage não cresce sem limite).
        const capped = history.length > HISTORY_LIMIT ? history.slice(-HISTORY_LIMIT) : history
        set({ view, params, history: capped })
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
