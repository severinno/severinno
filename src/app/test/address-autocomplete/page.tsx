"use client"

import dynamic from "next/dynamic"
import { Providers } from "@/components/providers"

const AddressAutocomplete = dynamic(
  () => import("@/components/vitrine/address-autocomplete"),
  { ssr: false },
)

/**
 * Isolated test page for AddressAutocomplete E2E tests.
 * Wraps the component in Providers (needed for geo store + toasts).
 */
export default function TestAddressAutocompletePage() {
  return (
    <Providers>
      <main style={{ padding: 24 }}>
        <h1>Address Autocomplete Test</h1>
        <AddressAutocomplete
          placeholder="CEP, cidade ou endereço…"
          onSelect={(lat, lng, name) => {
            console.log("[test] onSelect", { lat, lng, name })
          }}
        />
      </main>
    </Providers>
  )
}
