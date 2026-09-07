import type * as React from "react"
import type { ProviderDetail, ProviderService } from "@/lib/api"
import type { AddressFormValue } from "@/components/forms/geo-address-form"
import type { StepDef } from "../step-wizard"

export type { AddressFormValue }

export type BookingFormState = {
  date: Date | undefined
  time: string | undefined
  quantity: number
  notes: string
  address: AddressFormValue
  paymentMethod: "CARD" | "PIX"
  cardName: string
  cardNumber: string
  cardExpiry: string
  cardCvv: string
}

export const emptyAddress: AddressFormValue = {
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  lat: null,
  lng: null,
}

export const initialState = (quantity = 1): BookingFormState => ({
  date: undefined,
  time: undefined,
  quantity,
  notes: "",
  address: emptyAddress,
  paymentMethod: "PIX",
  cardName: "",
  cardNumber: "",
  cardExpiry: "",
  cardCvv: "",
})

// Validation helpers
export function cardNameValid(v: string) {
  return v.trim().length >= 3
}
export function cardNumberValid(v: string) {
  return v.replace(/\s/g, "").length >= 13
}
export function cardExpiryValid(v: string) {
  return /^\d{2}\/\d{2}$/.test(v)
}
export function cardCvvValid(v: string) {
  return /^\d{3,4}$/.test(v)
}

// Step definitions
export const STEPS: StepDef[] = [
  { id: 1, label: "Agenda", shortLabel: "Agenda" },
  { id: 2, label: "Detalhes", shortLabel: "Detalhes" },
  { id: 3, label: "Pagamento", shortLabel: "Pagamento" },
  { id: 4, label: "Confirmação", shortLabel: "Confirmar" },
]

export type Step = (typeof STEPS)[number]["id"]

// Step props
export type TimePeriod = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  range: [number, number]
}

export type StepProps = {
  state: BookingFormState
  set: <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) => void
}

export type Step1Props = StepProps & {
  availability: ProviderDetail["availability"]
  selectedService?: ProviderService
  provider?: ProviderDetail
  loading: boolean
  isDesktop: boolean
}

export type Step2Props = StepProps & {
  provider?: ProviderDetail
  selectedService?: ProviderService
}

export type Step3Props = StepProps & {
  markTouched: (field: string) => void
  touched: Set<string>
  selectedService?: ProviderService
}

export type Step4Props = {
  state: BookingFormState
  provider?: ProviderDetail
  selectedService?: ProviderService
  goToStep: (s: Step) => void
}
