"use client"

/**
 * GeoAddressForm — Combina AddressAutocomplete (busca inteligente com CEP detection,
 * cache LRU e GPS) com campos manuais de endereço para edição de número/complemento.
 *
 * Quando o usuário seleciona um resultado no autocomplete, os campos de endereço
 * são preenchidos automaticamente. O usuário pode editar número e complemento
 * manualmente.
 *
 * Mantém compatibilidade com AddressFormValue (mesma interface do AddressForm original).
 */

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
import { useGeoStore } from "@/store/geo"
import { cn } from "@/lib/utils"
import AddressAutocomplete from "@/components/vitrine/address-autocomplete"

export type AddressFormValue = {
  cep: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  lat?: number | null
  lng?: number | null
}

type GeoAddressFormProps = {
  value: AddressFormValue
  onChange: (v: AddressFormValue) => void
  errors?: Partial<Record<keyof AddressFormValue, string>>
  className?: string
  /** Hide the "use my location" GPS button. */
  hideGps?: boolean
  /** Field label prefix for screen readers / nested forms. */
  idPrefix?: string
}

const UF_OPTIONS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
]

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "")
}

function maskCep(cep: string): string {
  const d = onlyDigits(cep).slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

export function GeoAddressForm({
  value,
  onChange,
  errors,
  className,
  hideGps,
  idPrefix = "gaf",
}: GeoAddressFormProps) {
  const setFromGPS = useGeoStore((s) => s.setFromGPS)
  const [gpsLoading, setGpsLoading] = React.useState(false)

  const set = React.useCallback(
    <K extends keyof AddressFormValue>(key: K, v: AddressFormValue[K]) => {
      onChange({ ...value, [key]: v })
    },
    [value, onChange],
  )

  const handleAutocompleteSelect = React.useCallback(
    (_lat: number, _lng: number, _displayName: string) => {
      // Read the geo store directly — AddressAutocomplete already updated it
      // via setFromCoords or setFromCEP.
      const geo = useGeoStore.getState()
      const updates: Partial<AddressFormValue> = {}

      if (geo.cep) updates.cep = maskCep(geo.cep)
      if (geo.city) updates.city = geo.city
      if (geo.state) updates.state = geo.state
      if (geo.district) updates.district = geo.district
      if (geo.lat != null) {
        updates.lat = geo.lat
        updates.lng = geo.lng
      }
      // Auto-fill street from the display name (first part before comma)
      if (geo.address && !value.street) {
        const parts = geo.address.split(",").map((s) => s.trim())
        if (parts[0]) updates.street = parts[0]
      }

      if (Object.keys(updates).length > 0) {
        onChange({ ...value, ...updates })
      }
    },
    [value, onChange],
  )

  const handleGps = React.useCallback(async () => {
    setGpsLoading(true)
    try {
      await setFromGPS()
      const geo = useGeoStore.getState()
      if (geo.lat != null && geo.lng != null) {
        set("lat", geo.lat)
        set("lng", geo.lng)
      }
    } finally {
      setGpsLoading(false)
    }
  }, [set, setFromGPS])

  return (
    <div className={cn("grid gap-3", className)}>
      {/* AddressAutocomplete — primary input */}
      <div>
        <Label className="text-muted-foreground mb-1.5 block text-xs">Buscar endereço</Label>
        <AddressAutocomplete
          placeholder="CEP, cidade ou endereço…"
          onSelect={handleAutocompleteSelect}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-cep`}>CEP</Label>
          <Input
            id={`${idPrefix}-cep`}
            inputMode="numeric"
            placeholder="00000-000"
            value={value.cep}
            onChange={(e) => set("cep", maskCep(e.target.value))}
            aria-invalid={!!errors?.cep}
            className="h-10 text-sm"
          />
          {errors?.cep && <p className="text-destructive text-xs">{errors.cep}</p>}
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
