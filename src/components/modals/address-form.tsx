"use client"

import * as React from "react"
import { Loader2, LocateFixed, MapPin } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiGet, fetchGeoSearchStructured } from "@/lib/api"
import { useGeoStore } from "@/store/geo"
import { cn } from "@/lib/utils"
import {
  type AddressFormValue,
  UF_OPTIONS,
  onlyDigits,
  maskCep,
} from "@/components/forms/address-shared"

export type { AddressFormValue }

type AddressFormProps = {
  value: AddressFormValue
  onChange: (v: AddressFormValue) => void
  errors?: Partial<Record<keyof AddressFormValue, string>>
  className?: string
  /** Hide the "use my location" GPS button. */
  hideGps?: boolean
  /** Field label prefix for screen readers / nested forms. */
  idPrefix?: string
}

/**
 * Reusable address form with CEP auto-fill and "use my location" GPS.
 *
 * Used by the Quote and Booking flows. CEP lookup calls `/api/geo/cep` and
 * then enriches the result with coordinates via a Nominatim structured
 * search (postcode) — ViaCEP has no lat/lng, and Booking/Quote require them.
 * GPS uses `useGeoStore.setFromGPS` and then `/api/geo/reverse` for
 * reverse geocoding.
 */
export function AddressForm({
  value,
  onChange,
  errors,
  className,
  hideGps,
  idPrefix = "addr",
}: AddressFormProps) {
  const setFromGPS = useGeoStore((s) => s.setFromGPS)
  const [cepLoading, setCepLoading] = React.useState(false)
  const [gpsLoading, setGpsLoading] = React.useState(false)
  const [cepError, setCepError] = React.useState<string | null>(null)

  const set = React.useCallback(
    <K extends keyof AddressFormValue>(key: K, v: AddressFormValue[K]) => {
      onChange({ ...value, [key]: v })
    },
    [value, onChange],
  )

  const handleCepLookup = React.useCallback(
    async (raw: string) => {
      const cep = onlyDigits(raw)
      if (cep.length !== 8) return
      setCepLoading(true)
      setCepError(null)
      try {
        const data = await apiGet<{
          cep: string
          street?: string
          district?: string
          city?: string
          state?: string
        }>("/api/geo/cep", { cep })
        // ViaCEP não retorna coordenadas — enriquece com Nominatim structured
        // (postcode), mesmo padrão do address-autocomplete. Se o endereço
        // resolvido divergir do atual (ex.: GPS de outro lugar), coords antigas
        // ficariam inconsistentes — tenta enriquecer, senão limpa para forçar
        // a confirmação do usuário (indicator "Localização confirmada" some).
        let lat = value.lat
        let lng = value.lng
        if (data.city) {
          const addressChanged =
            (data.street ?? value.street) !== value.street ||
            (data.city ?? value.city) !== value.city ||
            (data.state ?? value.state) !== value.state
          if (addressChanged) {
            lat = null
            lng = null
            try {
              const geoResults = await fetchGeoSearchStructured({
                postcode: cep,
                city: data.city,
                state: data.state || undefined,
                limit: 1,
              })
              const first = geoResults[0]
              if (first?.lat != null && first?.lng != null) {
                lat = first.lat
                lng = first.lng
              }
            } catch {
              // Nominatim falhou — mantém lat/lng null (endereço não confirmado)
            }
          }
        }
        onChange({
          ...value,
          cep: data.cep ?? maskCep(cep),
          street: data.street ?? value.street,
          district: data.district ?? value.district,
          city: data.city ?? value.city,
          state: data.state ?? value.state,
          lat,
          lng,
        })
      } catch {
        setCepError("CEP não encontrado. Preencha o endereço manualmente.")
      } finally {
        setCepLoading(false)
      }
    },
    [value, onChange],
  )

  const handleGps = React.useCallback(async () => {
    setGpsLoading(true)
    try {
      await setFromGPS()
      const geo = useGeoStore.getState()
      if (geo.lat == null || geo.lng == null) {
        setGpsLoading(false)
        return
      }
      // Try reverse geocoding for a friendlier UX.
      try {
        const data = await apiGet<{
          street?: string
          district?: string
          city?: string
          state?: string
          cep?: string
        }>("/api/geo/reverse", { lat: geo.lat, lng: geo.lng })
        onChange({
          ...value,
          lat: geo.lat,
          lng: geo.lng,
          cep: data.cep ? maskCep(data.cep) : value.cep,
          street: data.street ?? value.street,
          district: data.district ?? value.district,
          city: data.city ?? value.city,
          state: data.state ?? value.state,
        })
      } catch {
        // Keep GPS coords only; user fills address manually.
        onChange({ ...value, lat: geo.lat, lng: geo.lng })
      }
    } finally {
      setGpsLoading(false)
    }
  }, [value, onChange, setFromGPS])

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-cep`}>CEP</Label>
          <div className="relative">
            <Input
              id={`${idPrefix}-cep`}
              inputMode="numeric"
              placeholder="00000-000"
              value={value.cep}
              onChange={(e) => set("cep", maskCep(e.target.value))}
              onBlur={(e) => handleCepLookup(e.target.value)}
              aria-invalid={!!errors?.cep || !!cepError}
              className="h-10 text-sm"
            />
            {cepLoading && (
              <Loader2 className="text-muted-foreground absolute top-1/2 right-2 size-4 -translate-y-1/2 animate-spin" />
            )}
          </div>
          {(errors?.cep || cepError) && (
            <p className="text-destructive text-xs">{errors?.cep ?? cepError}</p>
          )}
        </div>
        {!hideGps && (
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGps}
              disabled={gpsLoading}
              className="border-primary/30 text-primary hover:bg-primary/5 hover:text-primary h-10 w-full justify-start gap-2"
            >
              {gpsLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LocateFixed className="size-4" />
              )}
              Minha localização
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-street`}>Rua / Avenida</Label>
        <Input
          id={`${idPrefix}-street`}
          placeholder="Rua, avenida..."
          value={value.street}
          onChange={(e) => set("street", e.target.value)}
          aria-invalid={!!errors?.street}
          className="h-10 text-sm"
        />
        {errors?.street && <p className="text-destructive text-xs">{errors.street}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-number`}>Número</Label>
          <Input
            id={`${idPrefix}-number`}
            placeholder="123"
            value={value.number}
            onChange={(e) => set("number", e.target.value)}
            aria-invalid={!!errors?.number}
            className="h-10 text-sm"
          />
          {errors?.number && <p className="text-destructive text-xs">{errors.number}</p>}
        </div>
        <div className="col-span-1 grid gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-complement`}>Complemento</Label>
          <Input
            id={`${idPrefix}-complement`}
            placeholder="Apto, bloco... (opcional)"
            value={value.complement}
            onChange={(e) => set("complement", e.target.value)}
            className="h-10 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-district`}>Bairro</Label>
          <Input
            id={`${idPrefix}-district`}
            placeholder="Bairro"
            value={value.district}
            onChange={(e) => set("district", e.target.value)}
            className="h-10 text-sm"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-city`}>Cidade</Label>
          <Input
            id={`${idPrefix}-city`}
            placeholder="Cidade"
            value={value.city}
            onChange={(e) => set("city", e.target.value)}
            aria-invalid={!!errors?.city}
            className="h-10 text-sm"
          />
          {errors?.city && <p className="text-destructive text-xs">{errors.city}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-state`}>UF</Label>
          <Select value={value.state} onValueChange={(v) => set("state", v)}>
            <SelectTrigger
              id={`${idPrefix}-state`}
              className="h-10 w-full text-sm"
              aria-invalid={!!errors?.state}
            >
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              {UF_OPTIONS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors?.state && <p className="text-destructive text-xs">{errors.state}</p>}
        </div>
        <div className="flex items-end">
          {value.lat != null && value.lng != null ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <MapPin className="size-3.5" />
              Localização confirmada
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">Confirme o endereço para prosseguir.</p>
          )}
        </div>
      </div>
    </div>
  )
}
