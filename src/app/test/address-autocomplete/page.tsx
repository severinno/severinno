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
            // eslint-disable-next-line no-console -- debug output for the E2E test page
            console.log("[test] onSelect", { lat, lng, name })
          }}
        />
      </main>
    </Providers>
  )
}