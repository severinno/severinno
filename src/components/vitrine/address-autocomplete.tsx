"use client"

/**
 * AddressAutocomplete — search-as-you-type address field powered by Nominatim
 * and ViaCEP.
 *
 * Detects CEP input (8 digits) and uses ViaCEP for precise address data.
 * Otherwise debounces input by 300 ms and calls fetchGeoSearch (Nominatim).
 * Results are cached in-memory (5min TTL) to reduce API calls.
 *
 * On selection, updates the geo store (lat/lng) and calls onSelect.
 * Keyboard: ArrowUp/Down to navigate, Enter to select, Escape to close.
 */

import * as React from "react"
import { motion } from "framer-motion"
import { MapPin, LocateFixed, Loader2, Mailbox, X } from "lucide-react"
import { toast } from "sonner"

import {
  fetchGeoSearch,
  fetchGeoSearchStructured,
  fetchCep,
  type GeoSearchResult,
  type CepResult,
} from "@/lib/api"
import { useGeoStore } from "@/store/geo"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

// ---------------------------------------------------------------------------
// In-memory LRU cache for geocoding results (5 min TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  results: GeoSearchResult[]
  ts: number // timestamp
}

const GLOBAL_CACHE = new Map<string, CacheEntry>()
const CACHE_MAX = 50
const CACHE_TTL_MS = 5 * 60 * 1000

function cacheGet(key: string): GeoSearchResult[] | null {
  const entry = GLOBAL_CACHE.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    GLOBAL_CACHE.delete(key)
    return null
  }
  return entry.results
}

function cacheSet(key: string, results: GeoSearchResult[]): void {
  if (GLOBAL_CACHE.size >= CACHE_MAX) {
    // Evict oldest entry
    const oldest = GLOBAL_CACHE.keys().next().value
    if (oldest !== undefined) GLOBAL_CACHE.delete(oldest)
  }
  GLOBAL_CACHE.set(key, { results, ts: Date.now() })
}

// ---------------------------------------------------------------------------
// CEP helpers
// ---------------------------------------------------------------------------

function isCEP(input: string): boolean {
  return input.replace(/\D/g, "").length === 8
}

function cepToResult(cep: string, addr: CepResult, lat?: number, lng?: number): GeoSearchResult {
  return {
    lat: lat ?? 0,
    lng: lng ?? 0,
    displayName:
      [addr.street, addr.district, addr.city, addr.state].filter(Boolean).join(", ") ||
      `CEP ${cep}`,
    street: addr.street ?? null,
    district: addr.district ?? null,
    city: addr.city ?? null,
    state: addr.state ?? null,
    cep: cep.replace(/\D/g, ""),
    type: "postcode",
    category: "address",
    importance: 0,
  }
}

type Props = {
  /** Placeholder text */
  placeholder?: string
  /** Called when the user selects an address result */
  onSelect?: (lat: number, lng: number, displayName: string) => void
  className?: string
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddressAutocomplete({
  placeholder = "CEP, cidade ou endereço…",
  onSelect,
  className,
}: Props) {
  const [input, setInput] = React.useState("")
  const [results, setResults] = React.useState<GeoSearchResult[]>([])
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [locating, setLocating] = React.useState(false)
  const [located, setLocated] = React.useState(false)
  const [selectedIdx, setSelectedIdx] = React.useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const locatedTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const setFromCoords = useGeoStore((s) => s.setFromCoords)
  const setFromGPS = useGeoStore((s) => s.setFromGPS)
  const city = useGeoStore((s) => s.city)

  const debouncedInput = useDebounce(input, 300)

  // Fetch results when debounced input changes
  // Checks cache first, then decides CEP vs Nominatim based on input.
  React.useEffect(() => {
    if (!debouncedInput || debouncedInput.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([])
       
      setOpen(false)
      return
    }

    // Check cache first
    const cached = cacheGet(debouncedInput.trim().toLowerCase())
    if (cached) {
      setResults(cached)
      setOpen(cached.length > 0)
      setSelectedIdx(-1)
      return
    }

    let cancelled = false
    setLoading(true)

    const fetchData = async () => {
      // CEP detection — use ViaCEP + try Nominatim for coordinates
      if (isCEP(debouncedInput)) {
        try {
          const clean = debouncedInput.replace(/\D/g, "")
          const addr = await fetchCep(clean)
          if (cancelled) return

          // Try Nominatim structured search with postcode to get lat/lng
          let lat: number | undefined
          let lng: number | undefined
          if (addr.city) {
            try {
              const geoResults = await fetchGeoSearchStructured({
                postcode: clean,
                city: addr.city,
                state: addr.state || undefined,
                limit: 1,
              })
              if (!cancelled && geoResults.length > 0) {
                const first = geoResults[0]
                if (first.lat && first.lng) {
                  lat = first.lat
                  lng = first.lng
                }
              }
            } catch {
              // Nominatim failed — keep lat/lng undefined (ViaCEP data only)
            }
          }
          if (cancelled) return

          const result = cepToResult(clean, addr, lat, lng)
          const arr = [result]
          cacheSet(debouncedInput.trim().toLowerCase(), arr)
          setResults(arr)
          setOpen(true)
          setSelectedIdx(-1)
        } catch {
          if (cancelled) return
          setResults([])
        } finally {
          if (!cancelled) setLoading(false)
        }
        return
      }

      // Default: Nominatim search
      try {
        const data = await fetchGeoSearch(debouncedInput, 5)
        if (cancelled) return
        cacheSet(debouncedInput.trim().toLowerCase(), data)
        setResults(data)
        setOpen(data.length > 0)
        setSelectedIdx(-1)
      } catch {
        if (cancelled) return
        setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [debouncedInput])

  // ---- Handlers -----------------------------------------------------------

  const selectResult = React.useCallback(
    (result: GeoSearchResult) => {
      setInput(result.displayName)
      setOpen(false)
      setResults([])
      // Discriminate by type: "postcode" = CEP result (may have lat/lng from Nominatim)
      if (result.type === "postcode" && result.cep) {
        const hasCoords = result.lat !== 0 && result.lng !== 0
        if (hasCoords) {
          // CEP with real coordinates (Nominatim enhanced) — full geo data
          setFromCoords(result.lat, result.lng, result.displayName)
          onSelect?.(result.lat, result.lng, result.displayName)
        } else {
          onSelect?.(0, 0, result.displayName)
        }
        // Store ViaCEP address fields directly (no extra network call)
        useGeoStore.setState({
          cep: result.cep,
          district: result.district ?? null,
          city: result.city ?? null,
          state: result.state ?? null,
          status: "ready",
          updatedAt: new Date().toISOString(),
        })
      } else {
        // Non-CEP result (Nominatim) — has real lat/lng
        setFromCoords(result.lat, result.lng, result.displayName)
        onSelect?.(result.lat, result.lng, result.displayName)
      }
    },
    [setFromCoords, onSelect],
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIdx((prev) => Math.min(prev + 1, results.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIdx((prev) => Math.max(prev - 1, 0))
      } else if (e.key === "Enter" && selectedIdx >= 0 && results[selectedIdx]) {
        e.preventDefault()
        selectResult(results[selectedIdx])
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    },
    [results, selectedIdx, selectResult],
  )

  // ---- GPS locate + reverse geocode ---------------------------------------

  const handleLocate = React.useCallback(async () => {
    if (locating) return
    setLocating(true)
    try {
      await setFromGPS()
      const geo = useGeoStore.getState()
      if (geo.lat == null || geo.lng == null) return

      // The store's setFromGPS already populates address via reverse geocode
      // — just use whatever it resolved to (named address or raw coords).
      const displayName = geo.address ?? `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`

      setInput(displayName)
      setResults([])
      setOpen(false)
      setFromCoords(geo.lat, geo.lng, displayName)
      onSelect?.(geo.lat, geo.lng, displayName)

      // Green pulse + toast feedback (H9: visibility of system status)
      setLocated(true)
      toast.success("Localização atualizada!")
      clearTimeout(locatedTimerRef.current)
      locatedTimerRef.current = setTimeout(() => setLocated(false), 1500)
    } finally {
      setLocating(false)
    }
  }, [locating, setFromGPS, setFromCoords, onSelect])

  // Click outside to close
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        listRef.current &&
        !listRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleClear = React.useCallback(() => {
    setInput("")
    setResults([])
    setOpen(false)
  }, [])

  // Derive the placeholder from the geo store city if available
  const derivedPlaceholder = city && !input ? city : placeholder

  // ---- Render -------------------------------------------------------------

  return (
    <div className={cn("relative", className)}>
      <MapPin className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
      <Input
        ref={inputRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value)
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        placeholder={derivedPlaceholder}
        className="h-12 border-0 bg-transparent pr-16 pl-10 text-left shadow-none focus-visible:ring-0"
        aria-label="Localização"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? "address-suggestions" : undefined}
        role="combobox"
        autoComplete="off"
      />

      {/* Right icons: GPS locate | loading spinner | clear button */}
      <span className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-0.5">
        {/* GPS locate */}
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          className="text-muted-foreground hover:bg-primary/10 hover:text-primary flex size-6 items-center justify-center rounded-full transition-colors"
          aria-label="Usar localização atual"
          title="Usar localização atual"
        >
          {locating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <motion.span
              animate={located ? { scale: [1, 1.35, 1] } : { scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn(
                "inline-flex transition-colors duration-300",
                located ? "text-emerald-500" : "",
              )}
            >
              <LocateFixed className="size-3.5" />
            </motion.span>
          )}
        </button>
        {/* Loading spinner from Nominatim search */}
        {loading ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : input ? (
          /* Clear button when input has text */
          <button
            type="button"
            onClick={handleClear}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-full transition-colors"
            aria-label="Limpar localização"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </span>

      {/* Dropdown */}
      {open && results.length > 0 ? (
        <div
          ref={listRef}
          id="address-suggestions"
          role="listbox"
          className="bg-background absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border p-1 shadow-lg"
        >
          {results.map((result, idx) => {
            const isCep = result.type === "postcode"
            return (
              <button
                key={`${result.lat}-${result.lng}-${idx}`}
                type="button"
                role="option"
                aria-selected={idx === selectedIdx}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => selectResult(result)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  idx === selectedIdx ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                {isCep ? (
                  <Mailbox className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                ) : (
                  <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{result.displayName}</p>
                  {result.city ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {isCep && result.cep ? `CEP ${result.cep} · ` : ""}
                      {[result.city, result.state].filter(Boolean).join(", ")}
                    </p>
                  ) : isCep && result.cep ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">CEP {result.cep}</p>
                  ) : null}
                </div>
                {isCep ? (
                  <span className="shrink-0 self-center text-[10px] font-medium text-emerald-600">
                    ViaCEP
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
