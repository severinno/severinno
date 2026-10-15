import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import React from "react"
import Hero from "@/components/vitrine/hero"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Test suite for Activity Feed profile avatar display
describe("Hero Live Activity Avatars", () => {
  it("renders live activities and user avatar container", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Hero query="" onQueryChange={() => {}} />
      </QueryClientProvider>,
    )

    // Verify hero mounts and has the activity feed structure
    expect(screen.getByText(/Atividade ao vivo/i)).toBeInTheDocument()
    expect(container).toBeDefined()
  })
})
