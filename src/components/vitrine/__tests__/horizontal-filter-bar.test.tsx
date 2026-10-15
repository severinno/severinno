import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { HorizontalFilterBar } from "../horizontal-filter-bar"
import { DEFAULT_FILTERS } from "../filters"

const mockCategories = [
  { id: "cat-1", name: "Elétrica", slug: "eletrica", level: 0, children: [] },
  { id: "cat-2", name: "Pintura", slug: "pintura", level: 0, children: [] },
]

describe("HorizontalFilterBar", () => {
  it("renders filter triggers and view toggle", () => {
    const onChange = vi.fn()
    const onOpenAdvancedFilters = vi.fn()
    const onViewChange = vi.fn()

    render(
      <HorizontalFilterBar
        value={DEFAULT_FILTERS}
        onChange={onChange}
        categories={mockCategories}
        hasGeo={true}
        onOpenAdvancedFilters={onOpenAdvancedFilters}
        activeFiltersCount={0}
        view="list"
        onViewChange={onViewChange}
      />,
    )

    // Check triggers are present
    expect(screen.getByText("Todas as categorias")).toBeInTheDocument()
    expect(screen.getByText(`Raio: ${DEFAULT_FILTERS.radius} km`)).toBeInTheDocument()
    expect(screen.getByText("Melhor avaliação")).toBeInTheDocument()
    expect(screen.getByText("Verificados")).toBeInTheDocument()
    expect(screen.getByText("Mais Filtros")).toBeInTheDocument()
    expect(screen.getByText("Lista")).toBeInTheDocument()
    expect(screen.getByText("Mapa")).toBeInTheDocument()
  })

  it("toggles verifiedOnly filter with 1 click", () => {
    const onChange = vi.fn()

    render(
      <HorizontalFilterBar
        value={DEFAULT_FILTERS}
        onChange={onChange}
        categories={mockCategories}
        hasGeo={true}
        onOpenAdvancedFilters={vi.fn()}
        activeFiltersCount={0}
        view="list"
        onViewChange={vi.fn()}
      />,
    )

    const verifiedBtn = screen.getByText("Verificados").closest("button")!
    fireEvent.click(verifiedBtn)

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS,
      verifiedOnly: true,
    })
  })

  it("triggers onOpenAdvancedFilters when clicking Mais Filtros", () => {
    const onOpenAdvancedFilters = vi.fn()

    render(
      <HorizontalFilterBar
        value={DEFAULT_FILTERS}
        onChange={vi.fn()}
        categories={mockCategories}
        hasGeo={true}
        onOpenAdvancedFilters={onOpenAdvancedFilters}
        activeFiltersCount={2}
        view="list"
        onViewChange={vi.fn()}
      />,
    )

    const moreFiltersBtn = screen.getByText("Mais Filtros").closest("button")!
    fireEvent.click(moreFiltersBtn)

    expect(onOpenAdvancedFilters).toHaveBeenCalledTimes(1)
    expect(screen.getByText("2")).toBeInTheDocument()
  })

  it("switches view mode between list and map", () => {
    const onViewChange = vi.fn()

    render(
      <HorizontalFilterBar
        value={DEFAULT_FILTERS}
        onChange={vi.fn()}
        categories={mockCategories}
        hasGeo={true}
        onOpenAdvancedFilters={vi.fn()}
        activeFiltersCount={0}
        view="list"
        onViewChange={onViewChange}
      />,
    )

    const mapBtn = screen.getByText("Mapa").closest("button")!
    fireEvent.click(mapBtn)

    expect(onViewChange).toHaveBeenCalledWith("map")
  })
})
