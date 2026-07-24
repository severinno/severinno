"use client"

/**
 * Vitrine — orchestrator of the public storefront.
 *
 * Composes: Topbar, Hero, CategoryShowcase, VitrineResults, HowItWorks, Footer.
 *
 * Owns:
 *   - Filter state (q, categoryId, radius, sort, verifiedOnly, minRating)
 *   - Pagination state (page, limit)
 *   - Server state via TanStack Query (providers, categories, favorites)
 *
 * The providers query is driven by:
 *   - the geo store (user lat/lng)
 *   - the current filter state (debounced `q`)
 *
 * Card actions are wired to the UI store (openQuote / openBooking / openProvider).
 */

import * as React from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"

import { useAuthStore, useGeoStore, useUIStore } from "@/store"
import {
  fetchCategories,
  fetchFavorites,
  fetchProviders,
  type Category,
} from "@/lib/api"

import Topbar from "./topbar"
import Hero from "./hero"
import SocialProofTicker from "./social-proof-ticker"
import CategoryShowcase from "./category-showcase"
import VitrineResults from "./vitrine-results"
import HowItWorks from "./how-it-works"
import QuickQuoteCalculator from "./quick-quote-calculator"
import PartnersTrust from "./partners-trust"
import Testimonials from "./testimonials"
import FAQ from "./faq"
import WhySeverinno from "./why-severinno"
import CtaBanner from "./cta-banner"
import ProviderSpotlight from "./provider-spotlight"
import { RecentlyViewed } from "./recently-viewed"
import CompareBar from "./compare-bar"
import CompareModal from "./compare-modal"
import BackToTop from "./back-to-top"
import Footer from "../shared/footer"
import AIChatWidget from "../shared/ai-chat-widget"
import CookieConsent from "../shared/cookie-consent"
import {
  DEFAULT_FILTERS,
  type FiltersState,
} from "./filters"

const RESULTS_ANCHOR_ID = "vitrine-resultados"
const PAGE_LIMIT = 9

// ── Combined state (filters + debouncedQ + page) via reducer ─────────────
// Using useReducer so that filter changes atomically reset the page,
// avoiding the need for a separate sync effect (which would trigger
// the react-hooks/set-state-in-effect lint rule).

type VitrineState = {
  filters: FiltersState
  page: number
  debouncedQ: string
}

type VitrineAction =
  | { type: 'SET_FILTERS'; filters: FiltersState }
  | { type: 'SET_CATEGORY'; id: string | null }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'DEBOUNCE_Q'; q: string }

function vitrineReducer(state: VitrineState, action: VitrineAction): VitrineState {
  switch (action.type) {        case 'SET_FILTERS':
      return { ...state, filters: action.filters, page: 1 }
    case 'SET_CATEGORY':
      return { ...state, filters: { ...state.filters, categoryId: action.id }, page: 1 }
    case 'SET_PAGE':
      return { ...state, page: action.page }
    case 'DEBOUNCE_Q':
      return { ...state, debouncedQ: action.q }
  }
}

export default function Vitrine() {
  const { status: authStatus } = useAuthStore()
  const { lat, lng } = useGeoStore()
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const openProvider = useUIStore((s) => s.openProvider)

  // ---------------------------------------------------------------- state --
  const [{ filters, page, debouncedQ }, dispatch] = React.useReducer(
    vitrineReducer,
    { filters: DEFAULT_FILTERS, page: 1, debouncedQ: '' },
  )

  // Debounce the free-text query so we don't fire one request per keystroke.
  // Note: the reducer does NOT reset page on debounce because SET_FILTERS
  // already reset it when the user typed (q is part of filters).
  React.useEffect(() => {
    const t = window.setTimeout(() => dispatch({ type: 'DEBOUNCE_Q', q: filters.q }), 350)
    return () => window.clearTimeout(t)
  }, [filters.q])

  // ----------------------------------------------------------- categories --
  const categoriesQuery = useQuery({
    queryKey: ["categories", "top"],
    queryFn: () => fetchCategories({ level: 1 }),
    staleTime: 10 * 60 * 1000,
  })
  const categories: Category[] = categoriesQuery.data ?? []

  // ------------------------------------------------------------ providers --
  const providersQuery = useQuery({
    queryKey: [
      "providers",
      {
        q: debouncedQ,
        categoryId: filters.categoryId,
        radius: filters.radius,
        sort: filters.sort,
        verifiedOnly: filters.verifiedOnly,
        minRating: filters.minRating,
        lat,
        lng,
        page,
        limit: PAGE_LIMIT,
      },
    ],
    queryFn: () =>
      fetchProviders({
        q: debouncedQ || undefined,
        categoryId: filters.categoryId ?? undefined,
        radius: filters.radius,
        sort: filters.sort,
        verified: filters.verifiedOnly || undefined,
        minRating: filters.minRating > 0 ? filters.minRating : undefined,
        lat,
        lng,
        page,
        limit: PAGE_LIMIT,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })

  // ------------------------------------------------------------ favorites --
  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: () => fetchFavorites(),
    enabled: authStatus === "authenticated",
    staleTime: 60 * 1000,
  })
  const favorites = React.useMemo(
    () => new Set((favoritesQuery.data ?? []).map((p) => p.id)),
    [favoritesQuery.data],
  )

  // --------------------------------------------------------- card actions --
  const handleQuote = React.useCallback(
    (id: string) => openQuote({ providerId: id }),
    [openQuote],
  )
  const handleBook = React.useCallback(
    (id: string, serviceId?: string) =>
      openBooking({ providerId: id, serviceId }),
    [openBooking],
  )
  const handleView = React.useCallback(
    (id: string) => openProvider(id),
    [openProvider],
  )

  // ---------------------------------------------------- category handlers --
  const handleCategorySelect = React.useCallback(
    (id: string | null) => {
      dispatch({ type: 'SET_CATEGORY', id })
    },
    [],
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Topbar
        query={filters.q}
        onQueryChange={(q) => dispatch({ type: 'SET_FILTERS', filters: { ...filters, q } })}
        categories={categories}
        activeCategoryId={filters.categoryId}
        onCategorySelect={handleCategorySelect}
        onSearchSubmit={() => {
          dispatch({ type: 'DEBOUNCE_Q', q: filters.q })
          if (typeof window !== "undefined") {
            const el = document.getElementById(RESULTS_ANCHOR_ID)
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        }}
      />

      <main className="flex-1">
        {/* 1. Hero — trust engine, search, CTA */}
        <Hero
          query={filters.q}
          onQueryChange={(q) => dispatch({ type: 'SET_FILTERS', filters: { ...filters, q } })}
          resultsAnchorId={RESULTS_ANCHOR_ID}
          onSearchSubmit={() => {
            dispatch({ type: 'DEBOUNCE_Q', q: filters.q })
            if (typeof window !== "undefined") {
              const el = document.getElementById(RESULTS_ANCHOR_ID)
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          }}
        />

        {/* 2. SocialProofTicker — H1/H6: live activity, immediate trust */}
        <SocialProofTicker />

        {/* 3. CategoryShowcase — browse by category */}
        <CategoryShowcase
          categories={categories}
          activeId={filters.categoryId}
          onSelect={handleCategorySelect}
          isLoading={categoriesQuery.isLoading}
        />

        <RecentlyViewed />

        {/* 4. VitrineResults — provider listings */}
        <VitrineResults
          providers={providersQuery.data?.items ?? []}
          total={providersQuery.data?.total ?? 0}
          page={page}
          limit={PAGE_LIMIT}
          isLoading={providersQuery.isLoading}
          isFetching={providersQuery.isFetching}
          error={providersQuery.error}
          filters={filters}
          onFiltersChange={(next) => dispatch({ type: 'SET_FILTERS', filters: next })}
          categories={categories}
          favorites={favorites}
          userLat={lat}
          userLng={lng}
          onQuote={handleQuote}
          onBook={handleBook}
          onView={handleView}
          onPageChange={(p) => dispatch({ type: 'SET_PAGE', page: p })}
          resultsAnchorId={RESULTS_ANCHOR_ID}
          radiusExpanded={providersQuery.data?.radiusExpanded}
        />

        {/* 5. HowItWorks — process explanation */}
        <HowItWorks />

        {/* 5b. QuickQuoteCalculator — instant price estimate */}
        <QuickQuoteCalculator />

        {/* 6. PartnersTrust — H6/H9: press logos, trust signals */}
        <PartnersTrust />

        {/* 7. Testimonials — social proof from real users */}
        <Testimonials />

        {/* 8. WhySeverinno — value proposition */}
        <WhySeverinno />

        {/* 9. ProviderSpotlight — featured provider */}
        <ProviderSpotlight />

        {/* 10. FAQ — common questions */}
        <FAQ />

        {/* 11. CtaBanner — final conversion CTA */}
        <CtaBanner />
      </main>

      <Footer />

      {/* Floating UI — compare bar + back-to-top + AI chat */}
      <CompareBar />
      <BackToTop />
      <AIChatWidget />

      {/* Compare modal — portal-mounted by Radix */}
      <CompareModal />

      {/* Cookie consent banner — LGPD compliance */}
      <CookieConsent />
    </div>
  )
}
