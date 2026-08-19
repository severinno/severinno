import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "../sheet"

describe("Sheet", () => {
  it("renders content when open (default side right)", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>Ajuste sua busca.</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <SheetClose>Fechar</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByText("Filtros")).toBeInTheDocument()
    expect(screen.getByText("Ajuste sua busca.")).toBeInTheDocument()
    expect(screen.getByText("Fechar")).toBeInTheDocument()
  })

  it("handles each side variant", () => {
    for (const side of ["left", "top", "bottom"] as const) {
      const { unmount } = render(
        <Sheet open>
          <SheetContent side={side}>{side}</SheetContent>
        </Sheet>,
      )
      const content = document.querySelector("[data-slot='sheet-content']")
      expect(content?.className).toContain(`slide-in-from-${side}`)
      unmount()
    }
  })

  it("renders trigger when closed", () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <button type="button">abrir painel</button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Oculto</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByText("abrir painel")).toBeInTheDocument()
  })

  it("applies className to content", () => {
    render(
      <Sheet open>
        <SheetContent className="custom-sheet">
          <SheetTitle>X</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    const content = document.querySelector("[data-slot='sheet-content']")
    expect(content?.className).toContain("custom-sheet")
  })
})
