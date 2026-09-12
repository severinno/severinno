/**
 * Shared types and helpers for AddressForm and GeoAddressForm.
 */

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

export const UF_OPTIONS = [
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

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "")
}

export function maskCep(cep: string): string {
  const d = onlyDigits(cep).slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}
