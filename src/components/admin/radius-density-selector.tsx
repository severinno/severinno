"use client"

/**
 * RadiusDensitySelector — Raio de Busca + Densidade + Seletividade
 *
 * Sliders e presets para selecionar o raio de busca (km) e a densidade
 * de providers (providers/km²), com indicador de seletividade calculada.
 *
 * Extraído do GiSTSelectivitySection para reduzir o tamanho do arquivo
 * principal e permitir reuso independente.
 *
 * Props são controladas pelo parent (GiSTSelectivitySection) que mantém
 * o estado e as computações derivadas (estimatedProviders, densityLabel,
 * currentSelectivity, selPct). Este componente é puramente de apresentação.
 */

import { cn } from "@/lib/utils"
import { REFERENCE_RADIUS_KM, selectivityToRadiusLabel } from "@/lib/geo-benchmark-model"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RadiusDensitySelectorProps {
  /** Current search radius in km. */
  radiusKm: number
  /** Called when the user changes the radius. */
  onRadiusKmChange: (v: number) => void
  /** Current provider density (providers/km²). */
  density: number
  /** Called when the user changes the density. */
  onDensityChange: (v: number) => void
  /** Estimated number of providers within the search area (computed externally). */
  estimatedProviders: number
  /** Human-readable density label (e.g. "São Paulo (~10/km²)"). */
  densityLabel: string
  /** Selectivity ratio (0–1) for the current radius. */
  currentSelectivity: number
  /** Selectivity percentage (0–100), snapped to 5% increments. */
  selPct: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RadiusDensitySelector({
  radiusKm,
  onRadiusKmChange,
  density,
  onDensityChange,
  estimatedProviders,
  densityLabel,
  currentSelectivity,
  selPct,
}: RadiusDensitySelectorProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* ── Radius slider ──────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground w-14 text-right text-xs font-medium">
          {radiusKm} km
        </span>
        <input
          type="range"
          min={1}
          max={REFERENCE_RADIUS_KM}
          value={radiusKm}
          onChange={(e) => onRadiusKmChange(Number(e.target.value))}
          className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-sky-300 via-amber-300 to-red-300"
          aria-label="Raio de busca em km"
        />
      </div>

      {/* ── Radius preset buttons ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[5, 15, 30, 50].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRadiusKmChange(r)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              radiusKm === r
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {r} km
          </button>
        ))}
      </div>

      {/* ── Density slider ─────────────────────────────────────────── */}
      <div className="border-t pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground text-[10px] font-medium">
            Densidade: {densityLabel}
          </span>
          <span className="text-muted-foreground text-[10px]">
            ~{estimatedProviders.toLocaleString("pt-BR")} providers na área
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground w-10 text-right text-[10px] font-medium">
            {density}/km²
          </span>
          <input
            type="range"
            min={2}
            max={50}
            value={density}
            onChange={(e) => onDensityChange(Number(e.target.value))}
            className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-emerald-300 via-sky-300 to-violet-300"
            aria-label="Densidade de providers por km²"
          />
        </div>
        <div className="mt-1.5 flex gap-2">
          {[
            { v: 2, label: "Interior" },
            { v: 8, label: "RJ" },
            { v: 10, label: "SP" },
            { v: 30, label: "Metrópole" },
          ].map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => onDensityChange(p.v)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all",
                density === p.v
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {p.label} {p.v}/km²
            </button>
          ))}
        </div>
      </div>

      {/* ── Selectivity indicator ──────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-lg border bg-blue-50 px-3 py-2 text-xs dark:bg-blue-950/10">
        <span className="text-foreground font-semibold">{selPct}%</span>
        <span className="text-muted-foreground">
          dos providers em <strong>{radiusKm} km</strong>
          {currentSelectivity > 0 && (
            <>
              {" · "}seletividade equivalente a{" "}
              <strong>{selectivityToRadiusLabel(currentSelectivity)}</strong>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
