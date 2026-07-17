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

export default function Vitrine() {
  const { status: authStatus } = useAuthStore()
  const { lat, lng } = useGeoStore()
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const openProvider = useUIStore((s) => s.openProvider)

  // ---------------------------------------------------------------- state --
  const [filters, setFilters] = React.useState<FiltersState>(DEFAULT_FILTERS)
  const [page, setPage] = React.useState(1)

  // Debounce the free-text query so we don't fire one request per keystroke.
  const [debouncedQ, setDebouncedQ] = React.useState(filters.q)
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(filters.q), 350)
    return () => window.clearTimeout(t)
  }, [filters.q])

  // Reset pagination when the user-facing filters change.
  React.useEffect(() => {
    setPage(1)
  }, [
    debouncedQ,
    filters.categoryId,
    filters.radius,
    filters.sort,
    filters.verifiedOnly,
    filters.minRating,
  ])

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
      setFilters((f) => ({ ...f, categoryId: id }))
    },
    [],
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Topbar
        query={filters.q}
        onQueryChange={(q) => setFilters((f) => ({ ...f, q }))}
        categories={categories}
        activeCategoryId={filters.categoryId}
        onCategorySelect={handleCategorySelect}
        onSearchSubmit={() => {
          setDebouncedQ(filters.q)
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
          onQueryChange={(q) => setFilters((f) => ({ ...f, q }))}
          resultsAnchorId={RESULTS_ANCHOR_ID}
          onSearchSubmit={() => {
            setDebouncedQ(filters.q)
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
          onFiltersChange={setFilters}
          categories={categories}
          favorites={favorites}
          userLat={lat}
          userLng={lng}
          onQuote={handleQuote}
          onBook={handleBook}
          onView={handleView}
          onPageChange={setPage}
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
