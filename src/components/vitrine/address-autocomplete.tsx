"use client"

/**
 * AddressAutocomplete — search-as-you-type address field powered by Nominatim.
 *
 * Debounces input by 300 ms, calls fetchGeoSearch, and shows a dropdown of
 * results. On selection, updates the geo store (lat/lng) and calls onSelect.
 *
 * Keyboard: ArrowUp/Down to navigate, Enter to select, Escape to close.
 */

import * as React from "react"
import { motion } from "framer-motion"
import { MapPin, LocateFixed, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { fetchGeoSearch, type GeoSearchResult } from "@/lib/api"
import { useGeoStore } from "@/store/geo"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

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
  React.useEffect(() => {
    if (!debouncedInput || debouncedInput.length < 3) {
      setResults([])
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)

    fetchGeoSearch(debouncedInput, 5)
      .then((data) => {
        if (cancelled) return
        setResults(data)
        setOpen(data.length > 0)
        setSelectedIdx(-1)
      })
      .catch(() => {
        if (cancelled) return
        setResults([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

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
      setFromCoords(result.lat, result.lng, result.displayName)
      onSelect?.(result.lat, result.lng, result.displayName)
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
      <MapPin className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
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
        className="h-12 border-0 bg-transparent pl-10 pr-16 text-left shadow-none focus-visible:ring-0"
        aria-label="Localização"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? "address-suggestions" : undefined}
        role="combobox"
        autoComplete="off"
      />

      {/* Right icons: GPS locate | loading spinner | clear button */}
      <span className="absolute top-1/2 right-2.5 flex items-center gap-0.5 -translate-y-1/2">
        {/* GPS locate */}
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
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
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : input ? (
          /* Clear button when input has text */
          <button
            type="button"
            onClick={handleClear}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border bg-background p-1 shadow-lg"
        >
          {results.map((result, idx) => (
            <button
              key={`${result.lat}-${result.lng}-${idx}`}
              type="button"
              role="option"
              aria-selected={idx === selectedIdx}
              onMouseEnter={() => setSelectedIdx(idx)}
              onClick={() => selectResult(result)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                idx === selectedIdx
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted",
              )}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{result.displayName}</p>
                {result.city && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[result.city, result.state].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
              {result.importance > 0.5 ? (
                <span className="shrink-0 self-center text-[11px] text-amber-500" aria-label="Alta relevância">
                  ★
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
